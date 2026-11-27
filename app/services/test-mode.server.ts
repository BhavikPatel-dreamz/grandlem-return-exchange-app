// Test-store isolation. The dev store and the live client store share one
// deployment and one database, so test behaviour is keyed on the shop domain.
//
//   SHIPPING_TEST_SHOPS          comma list of test shop domains (never the live store)
//   SHIPPING_LIVE_TEST_ENABLED   "true" lets a test shop send a real ShippyPro Ship call
//   TEST_EMAIL_RECIPIENT         if set, every email for a test shop goes here instead
//
// Shops not in SHIPPING_TEST_SHOPS behave exactly as before.

function normalizeShop(shop: string): string {
  return shop.trim().toLowerCase();
}

export function testShops(): string[] {
  return (process.env.SHIPPING_TEST_SHOPS || "")
    .split(",")
    .map(normalizeShop)
    .filter(Boolean);
}

export function isTestShop(shop: string | null | undefined): boolean {
  return Boolean(shop) && testShops().includes(normalizeShop(shop!));
}

export function liveTestLabelsEnabled(): boolean {
  return process.env.SHIPPING_LIVE_TEST_ENABLED === "true";
}

/** Refusal message when a test shop may not create a real label right now, else null. */
export function liveLabelBlockedReason(shop: string): string | null {
  if (!isTestShop(shop) || liveTestLabelsEnabled()) return null;
  return "Real ShippyPro labels are switched off for this test store (SHIPPING_LIVE_TEST_ENABLED is not \"true\"). No shipment was sent.";
}

/** Where an email for this shop should really go. */
export function emailRecipientFor(shop: string | null | undefined, to: string): string {
  const override = process.env.TEST_EMAIL_RECIPIENT?.trim();
  return override && isTestShop(shop) ? override : to;
}
