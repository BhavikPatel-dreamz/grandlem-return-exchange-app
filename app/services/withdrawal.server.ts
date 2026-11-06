/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { lookupAndValidateOrder } from "./portal.server";
import { createReturnRequest } from "./returns.server";
import { sendEventEmail } from "./email.server";

export async function createWithdrawal(shop: string, orderNumber: string, email: string, lang: "en" | "sv" = "en") {
  const result = await lookupAndValidateOrder(shop, orderNumber, email, "return");
  if (!result.ok) throw new Error(result.code);

  const items = result.order.lineItems
    .filter((li: any) => !li.excluded)
    .map((li: any) => ({
      shopifyLineItemId: li.id,
      productId: li.productId,
      variantId: li.variantId,
      title: li.title,
      quantity: li.quantity,
      reasonId: null,
      comment: "EU withdrawal",
      photos: [] as any[],
    }));

  if (items.length === 0) throw new Error("NO_ELIGIBLE_ITEMS");

  const request = await createReturnRequest({
    shop,
    shopifyOrderId: result.order.id,
    orderNumber: result.order.name,
    market: null,
    customerEmail: result.order.email || email,
    customerName: null,
    type: "return",
    items,
  });

  await prisma.returnRequest.update({
    where: { id: request.id },
    data: {
      isWithdrawal: true,
      requestedResolution: "refund",
    },
  });

  const receivedAt = new Date();
  const content = `Withdrawal received ${receivedAt.toISOString()} for order ${result.order.name} by ${result.order.email || email}.`;
  await prisma.withdrawalNotice.create({
    data: {
      shop,
      orderNumber: result.order.name,
      customerEmail: result.order.email || email,
      content,
      returnRequestId: request.id,
      withdrawnAt: receivedAt,
    },
  });

  await prisma.returnRequest.update({
    where: { id: request.id },
    data: { acknowledgementContent: content, status: "Submitted" },
  });

  await sendEventEmail(shop, "received", lang, result.order.email || email, {
    customerName: result.order.email || "customer",
    orderNumber: result.order.name,
    items: items.map((it) => it.title).join(", "),
  }).catch(() => null);

  return { requestId: request.id, orderName: result.order.name, receivedAt, content, lang };
}