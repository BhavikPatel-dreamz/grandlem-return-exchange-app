// Which settlement options a storefront customer may pick, built on the server
// from the shop's "Resolution & store credit" settings.
// See docs/storefront-return-proxy.md, Step 5 "Resolution".

import type { ProxyRequestType } from "./proxy-order-token.server";

export type Resolution = "refund" | "store_credit" | "exchange" | "replacement";

export type ResolutionSettings = {
  deflectionEnabled: boolean;
  storeCreditEnabled: boolean;
  storeCreditBonusPercent: number;
  complaintResolutionMode: string;
  complaintRequireItemReturn: boolean;
};

export type ResolutionChoices = {
  /** Options the customer may pick. Empty when `fixed` is set. */
  options: Resolution[];
  /** Set when the customer has no choice; this value is saved. */
  fixed: Resolution | null;
  /** Refund was replaced by store credit (show an explanation). */
  refundDeflected: boolean;
  /** Bonus percent shown next to store credit (0 = none). */
  storeCreditBonusPercent: number;
};

export function resolutionChoices(
  settings: ResolutionSettings,
  requestType: ProxyRequestType,
  exchangeOpen: boolean,
): ResolutionChoices {
  const storeCredit = settings.storeCreditEnabled;
  // Deflection means "refund becomes store credit". Without store credit there
  // is nothing to deflect to, so refund stays available.
  const deflect = settings.deflectionEnabled && storeCredit;
  const bonus = storeCredit ? Math.max(0, settings.storeCreditBonusPercent || 0) : 0;
  const base = { refundDeflected: false, storeCreditBonusPercent: bonus };

  if (requestType === "exchange") {
    return { ...base, options: [], fixed: "exchange" };
  }

  if (requestType === "return") {
    const options: Resolution[] = [];
    if (!deflect) options.push("refund");
    if (storeCredit) options.push("store_credit");
    if (exchangeOpen) options.push("exchange");
    return { ...base, options, fixed: null, refundDeflected: deflect };
  }

  // complaint
  switch (settings.complaintResolutionMode) {
    case "always_replacement":
      return { ...base, options: [], fixed: "replacement" };
    case "always_refund":
      return { ...base, options: [], fixed: deflect ? "store_credit" : "refund", refundDeflected: deflect };
    case "customer_chooses":
    default: {
      const options: Resolution[] = ["replacement"];
      if (!deflect) options.push("refund");
      if (storeCredit) options.push("store_credit");
      return { ...base, options, fixed: null, refundDeflected: deflect };
    }
  }
}

/** The value to save, or null if the posted value is not allowed for this shop. */
export function pickResolution(choices: ResolutionChoices, posted: string | null): Resolution | null {
  if (choices.fixed) return choices.fixed;
  if (!posted) return null;
  return (choices.options as string[]).includes(posted) ? (posted as Resolution) : null;
}
