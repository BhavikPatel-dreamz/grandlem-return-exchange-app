/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getOrCreateSettings } from "./settings.server";

export async function createExchangeDraftOrder(shop: string, returnRequestId: string): Promise<{ ok: boolean; error?: string; draftOrderId?: string }> {
  const rr = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, shop },
    include: { items: true },
  });
  if (!rr) return { ok: false, error: "Request not found" };
  const settings = await getOrCreateSettings(shop);

  // Replacement variants from exchange items (if saved). Fall back to returned variants.
  const lineItems = rr.items
    .filter((it) => it.replacementVariantId)
    .map((it) => ({
      variantId: it.replacementVariantId!.startsWith("gid://") ? it.replacementVariantId! : `gid://shopify/ProductVariant/${it.replacementVariantId}`,
      quantity: it.quantity,
    }));
  if (lineItems.length === 0) return { ok: false, error: "No replacement variants selected" };

  const reserveUntil = new Date(Date.now() + settings.exchangeReserveDays * 24 * 60 * 60 * 1000);

  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(
      `#graphql
      mutation DraftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            lineItems,
            reserveInventoryUntil: reserveUntil.toISOString(),
            note: `Exchange draft for return ${returnRequestId}`,
          },
        },
      },
    );
    const json: any = await res.json();
    const errs = json?.data?.draftOrderCreate?.userErrors;
    if (errs && errs.length) throw new Error(errs.map((e: any) => e.message).join(", "));
    const draftOrderId = json?.data?.draftOrderCreate?.draftOrder?.id;
    if (!draftOrderId) throw new Error("Draft order id missing");

    await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: { draftOrderId, reservedUntil: reserveUntil },
    });
    return { ok: true, draftOrderId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Draft order failed" };
  }
}

export async function completeExchangeDraftOrder(shop: string, returnRequestId: string): Promise<{ ok: boolean; error?: string }> {
  const rr = await prisma.returnRequest.findFirst({ where: { id: returnRequestId, shop } });
  if (!rr?.draftOrderId) return { ok: false, error: "No draft order" };
  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(
      `#graphql
      mutation DraftOrderComplete($id: ID!) {
        draftOrderComplete(id: $id) { draftOrder { id } userErrors { field message } }
      }`,
      { variables: { id: rr.draftOrderId } },
    );
    const json: any = await res.json();
    const errs = json?.data?.draftOrderComplete?.userErrors;
    if (errs && errs.length) throw new Error(errs.map((e: any) => e.message).join(", "));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Complete failed" };
  }
}
