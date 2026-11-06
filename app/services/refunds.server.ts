/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getOrCreateSettings } from "./settings.server";
import { sendEventEmail } from "./email.server";

export type RefundPreview = {
  currency: string;
  items: { returnItemId: string; title: string | null; quantity: number; unitAmount: number; lineAmount: number }[];
  subtotal: number;
  shipping: number;
  total: number;
};

async function getAdmin(shop: string) {
  return unauthenticated.admin(shop);
}

export async function calculateRefundPreview(shop: string, returnRequestId: string): Promise<RefundPreview | null> {
  const rr = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, shop },
    include: { items: { include: { inspection: true } } },
  });
  if (!rr || !rr.shopifyOrderId) return null;

  const settings = await getOrCreateSettings(shop);
  const { admin } = await getAdmin(shop);
  const res = await admin.graphql(
    `#graphql
    query OrderForRefund($id: ID!) {
      order(id: $id) {
        currencyCode
        totalShippingPriceSet { shopMoney { amount } }
        lineItems(first: 100) {
          edges {
            node {
              id
              quantity
              discountedUnitPriceSet { shopMoney { amount } }
              title
            }
          }
        }
      }
    }`,
    { variables: { id: rr.shopifyOrderId } },
  );
  const json: any = await res.json();
  const order = json?.data?.order;
  if (!order) return null;

  const orderLines = new Map<string, any>(order.lineItems.edges.map((e: any) => [e.node.id, e.node]));
  const items: RefundPreview["items"] = [];
  let subtotal = 0;

  for (const it of rr.items) {
    const line = it.shopifyLineItemId ? orderLines.get(it.shopifyLineItemId) : null;
    const approvedQty = it.inspection?.approvedQuantity && it.inspection?.condition === "OK"
      ? it.inspection.approvedQuantity
      : (it.returnedQuantity || it.quantity);
    if (!approvedQty || approvedQty <= 0) continue;
    const unitAmount = line ? Number(line.discountedUnitPriceSet?.shopMoney?.amount || 0) : 0;
    const lineAmount = Math.round(unitAmount * approvedQty * 100) / 100;
    items.push({
      returnItemId: it.id,
      title: it.title || line?.title || null,
      quantity: approvedQty,
      unitAmount,
      lineAmount,
    });
    subtotal += lineAmount;
  }

  const shipping = settings.refundShippingCost ? Number(order.totalShippingPriceSet?.shopMoney?.amount || 0) : 0;
  // Only include shipping if all original items are being refunded is too strict; use setting as provided.
  const total = Math.round((subtotal + shipping) * 100) / 100;

  return {
    currency: order.currencyCode,
    items,
    subtotal: Math.round(subtotal * 100) / 100,
    shipping: Math.round(shipping * 100) / 100,
    total,
  };
}

export async function issueRefund(
  shop: string,
  returnRequestId: string,
  amountOverride?: number,
  note?: string,
): Promise<{ ok: boolean; error?: string; refundId?: string; amount?: number }> {
  const rr = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, shop },
    include: { items: { include: { inspection: true } }, refunds: true },
  });
  if (!rr) return { ok: false, error: "Request not found" };

  const existing = rr.refunds.find((r) => r.status === "refunded" || r.status === "pending");
  if (existing?.status === "refunded") {
    return { ok: false, error: "This request has already been refunded" };
  }

  const preview = await calculateRefundPreview(shop, returnRequestId);
  if (!preview) return { ok: false, error: "Could not calculate refund" };

  const finalAmount = amountOverride !== undefined && Number.isFinite(amountOverride)
    ? Math.min(amountOverride, preview.total)
    : preview.total;
  if (finalAmount < 0) return { ok: false, error: "Invalid refund amount" };

  const refundRecord = await prisma.refundRecord.create({
    data: {
      returnRequestId,
      amount: finalAmount,
      currency: preview.currency,
      status: "pending",
      note: note || null,
    },
  });

  try {
    const { admin } = await getAdmin(shop);
    const res = await admin.graphql(
      `#graphql
      mutation RefundCreate($input: RefundInput!) {
        refundCreate(input: $input) {
          refund { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            orderId: rr.shopifyOrderId,
            note: note || "Return refund",
            refundLineItems: preview.items.map((it) => {
              const rrItem = rr.items.find((i) => i.id === it.returnItemId);
              return {
                lineItemId: rrItem?.shopifyLineItemId,
                quantity: it.quantity,
                restockType: "NO_RESTOCK",
              };
            }).filter((li) => li.lineItemId),
            shipping: { fullRefund: false, amount: preview.shipping > 0 ? String(preview.shipping) : undefined },
          },
        },
      },
    );
    const json: any = await res.json();
    const errs = json?.data?.refundCreate?.userErrors;
    if (errs && errs.length) throw new Error(errs.map((e: any) => e.message).join(", "));
    const refundId = json?.data?.refundCreate?.refund?.id;
    if (!refundId) throw new Error("Refund id missing");

    await prisma.refundRecord.update({
      where: { id: refundRecord.id },
      data: { status: "refunded", shopifyRefundId: refundId },
    });

    await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: { status: "Refunded" },
    });

    if (rr.customerEmail) {
      await sendEventEmail(shop, "refund_issued", "en", rr.customerEmail, {
        customerName: rr.customerEmail,
        orderNumber: rr.orderNumber,
        amount: finalAmount.toFixed(2),
      }).catch(() => null);
    }

    return { ok: true, refundId, amount: finalAmount };
  } catch (e) {
    await prisma.refundRecord.update({
      where: { id: refundRecord.id },
      data: { status: "failed", errorMessage: e instanceof Error ? e.message : "Refund failed" },
    });
    return { ok: false, error: e instanceof Error ? e.message : "Refund failed" };
  }
}

export async function autoRefundIfEligible(shop: string, returnRequestId: string): Promise<void> {
  const settings = await getOrCreateSettings(shop);
  if (!settings.autoRefundOnInspection) return;
  const rr = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, shop },
    include: { items: { include: { inspection: true } } },
  });
  if (!rr) return;
  const allApproved = rr.items.every((it) => it.inspection?.condition === "OK");
  if (!allApproved) return;
  await issueRefund(shop, returnRequestId).catch(() => null);
}