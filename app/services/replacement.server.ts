/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

export async function createReplacementOrder(shop: string, returnRequestId: string): Promise<{ ok: boolean; error?: string; orderId?: string }> {
  const rr = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, shop },
    include: { items: true },
  });
  if (!rr || !rr.shopifyOrderId) return { ok: false, error: "Request not found" };

  const firstItem = rr.items[0];
  if (!firstItem?.variantId) return { ok: false, error: "No variant to replace" };

  try {
    const { admin } = await unauthenticated.admin(shop);
    const variantId = firstItem.variantId.startsWith("gid://") ? firstItem.variantId : `gid://shopify/ProductVariant/${firstItem.variantId}`;
    // Create a draft order with a 100% discount.
    const res = await admin.graphql(
      `#graphql
      mutation DraftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id name }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            lineItems: [{ variantId, quantity: firstItem.quantity }],
            appliedDiscount: { title: "Free replacement", valueType: "PERCENTAGE", value: 100 },
            note: `Replacement for return ${returnRequestId}`,
          },
        },
      },
    );
    const json: any = await res.json();
    const errs = json?.data?.draftOrderCreate?.userErrors;
    if (errs && errs.length) throw new Error(errs.map((e: any) => e.message).join(", "));
    const orderId = json?.data?.draftOrderCreate?.draftOrder?.id;
    if (!orderId) throw new Error("Draft order id missing");

    // Complete the draft order (mark paid/fulfilled at zero).
    await admin.graphql(
      `#graphql
      mutation DraftOrderComplete($id: ID!) {
        draftOrderComplete(id: $id) {
          draftOrder { id }
          userErrors { field message }
        }
      }`,
      { variables: { id: orderId } },
    );

    await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: { replacementOrderId: orderId, finalResolution: "REPLACEMENT" },
    });

    return { ok: true, orderId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Replacement failed" };
  }
}
