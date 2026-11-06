/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

export type PriceComparison = {
  originalPrice: number;
  replacementPrice: number;
  difference: number; // replacement - original (per unit)
};

async function fetchVariantPrices(shop: string, variantIds: string[]) {
  const { admin } = await unauthenticated.admin(shop);
  const ids = variantIds.map((id) => (id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`));
  const query = `#graphql
    query variants($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          price
          title
          product { title }
        }
      }
    }
  `;
  const res = await admin.graphql(query, { variables: { ids } });
  const json = await res.json();
  const map = new Map<string, { price: number; title: string }>();
  for (const n of json?.data?.nodes || []) {
    if (n?.id) map.set(n.id, { price: Number(n.price), title: n.title });
  }
  return map;
}

export async function calculateExchangeDifference(
  shop: string,
  originalVariantId: string,
  replacementVariantId: string,
  quantity: number,
) {
  const ids = [originalVariantId, replacementVariantId];
  const map = await fetchVariantPrices(shop, ids);
  const originalPrice = map.get(originalVariantId.startsWith("gid://") ? originalVariantId : `gid://shopify/ProductVariant/${originalVariantId}`)?.price ?? 0;
  const replacementPrice = map.get(replacementVariantId.startsWith("gid://") ? replacementVariantId : `gid://shopify/ProductVariant/${replacementVariantId}`)?.price ?? 0;
  const diffPerUnit = replacementPrice - originalPrice;
  return {
    originalPrice,
    replacementPrice,
    difference: diffPerUnit * quantity,
  } as { originalPrice: number; replacementPrice: number; difference: number };
}

export async function applyReplacementVariants(
  returnRequestId: string,
  replacements: { returnItemId: string; replacementVariantId: string }[],
) {
  let totalDifference = 0;
  const rr = await prisma.returnRequest.findUnique({ where: { id: returnRequestId }, include: { items: true } });
  if (!rr) throw new Error("Return request not found");

  for (const r of replacements) {
    const item = rr.items.find((it: any) => it.id === r.returnItemId);
    if (!item) continue;
    const comp = await calculateExchangeDifference(rr.shop, item.variantId || "", r.replacementVariantId, item.returnedQuantity);
    totalDifference += comp.difference;
    await prisma.returnItem.update({
      where: { id: item.id },
      data: {
        replacementVariantId: r.replacementVariantId,
        priceDifferenceStr: comp.difference.toFixed(2),
      },
    });
  }

  return totalDifference;
}

export async function createExchangePaymentLink(shop: string, returnRequestId: string, email: string | null) {
  const rr = await prisma.returnRequest.findUnique({ where: { id: returnRequestId }, include: { items: true } });
  if (!rr) throw new Error("Return request not found");
  const total = rr.items.reduce((sum: number, it: any) => sum + (Number(it.priceDifferenceStr || 0)), 0);
  if (total <= 0) return { required: false, total };

  const { admin } = await unauthenticated.admin(shop);
  const createRes = await admin.graphql(
    `#graphql
    mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id invoiceUrl totalPrice }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          email: email || undefined,
          lineItems: [
            {
              title: "Exchange price difference",
              originalUnitPrice: total.toFixed(2),
              quantity: 1,
            },
          ],
        },
      },
    },
  );
  const json = await createRes.json();
  const errors = json?.data?.draftOrderCreate?.userErrors;
  if (errors && errors.length) throw new Error(errors.map((e: any) => e.message).join(", "));
  const draft = json?.data?.draftOrderCreate?.draftOrder;
  const invoiceUrl = draft?.invoiceUrl;

  await prisma.returnRequest.update({
    where: { id: returnRequestId },
    data: { status: "Awaiting Payment" },
  });

  return { required: true, total, invoiceUrl, draftOrderId: draft?.id };
}

export async function markExchangePaid(returnRequestId: string) {
  await prisma.returnRequest.update({
    where: { id: returnRequestId },
    data: { status: "Paid", approvedAt: new Date() },
  });
}
