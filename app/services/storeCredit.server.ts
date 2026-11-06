/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getOrCreateSettings } from "./settings.server";

export async function calculateStoreCreditAmount(shop: string, returnRequestId: string): Promise<number> {
  const rr = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, shop },
    include: { items: { include: { inspection: true } } },
  });
  if (!rr) return 0;
  const settings = await getOrCreateSettings(shop);
  // Base: approved quantities treated as refunded item values; reuse refunds preview concept lightly
  const approvedItems = rr.items.filter((it) => (it.inspection?.condition || "OK") === "OK");
  const base = approvedItems.reduce((sum, it) => sum + (it.returnedQuantity || it.quantity), 0) * 1; // placeholder unit value
  const bonus = base * (settings.storeCreditBonusPercent / 100);
  return Math.round((base + bonus) * 100) / 100;
}

export async function issueStoreCredit(
  shop: string,
  returnRequestId: string,
  amount?: number,
): Promise<{ ok: boolean; error?: string; code?: string; amount?: number }> {
  const rr = await prisma.returnRequest.findFirst({ where: { id: returnRequestId, shop } });
  if (!rr) return { ok: false, error: "Request not found" };
  if (rr.storeCreditIssuedAt) return { ok: false, error: "Store credit already issued" };

  const settings = await getOrCreateSettings(shop);
  if (!settings.storeCreditEnabled) return { ok: false, error: "Store credit disabled" };

  const finalAmount = amount && amount > 0 ? amount : Math.max(0, (rr.storeCreditAmount || 0));
  if (finalAmount <= 0) return { ok: false, error: "No credit amount to issue" };

  try {
    if (settings.storeCreditMethod === "gift_card") {
      const { admin } = await unauthenticated.admin(shop);
      const currency = "SEK"; // TODO: derive from order; default until Phase 18
      const res = await admin.graphql(
        `#graphql
        mutation GiftCardCreate($input: GiftCardCreateInput!) {
          giftCardCreate(input: $input) {
            giftCard { id lastCharacters }
            userErrors { field message }
          }
        }`,
        { variables: { input: { initialValue: { amount: String(finalAmount), currencyCode: currency } } } },
      );
      const json: any = await res.json();
      const errs = json?.data?.giftCardCreate?.userErrors;
      if (errs && errs.length) throw new Error(errs.map((e: any) => e.message).join(", "));
      const code = json?.data?.giftCardCreate?.giftCard?.id;
      // We cannot retrieve full code from masked response; store id as reference.
      await prisma.returnRequest.update({
        where: { id: returnRequestId },
        data: {
          requestedResolution: "store_credit",
          storeCreditAmount: finalAmount,
          storeCreditIssuedAt: new Date(),
        },
      });
      return { ok: true, code: code || undefined, amount: finalAmount };
    }

    // Shopify store credit method requires customer account plumbing; record-only fallback.
    await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: {
        requestedResolution: "store_credit",
        storeCreditAmount: finalAmount,
        storeCreditIssuedAt: new Date(),
      },
    });
    return { ok: true, amount: finalAmount };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Store credit issuance failed" };
  }
}

export async function autoIssueStoreCreditIfNeeded(shop: string, returnRequestId: string): Promise<void> {
  const settings = await getOrCreateSettings(shop);
  if (!settings.storeCreditEnabled) return;
  const rr = await prisma.returnRequest.findFirst({ where: { id: returnRequestId, shop } });
  if (!rr || rr.storeCreditIssuedAt) return;
  if (settings.storeCreditIssueTiming !== "on_inspection") return;
  await issueStoreCredit(shop, returnRequestId, rr.storeCreditAmount || undefined).catch(() => null);
}