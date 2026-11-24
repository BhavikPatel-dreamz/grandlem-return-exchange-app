import prisma from "../db.server";

export type SettingsInput = {
  returnDeadlineDays?: number;
  exchangeDeadlineDays?: number;
  autoApproveRequests?: boolean;
  emailFrom?: string;
  autoRefundOnInspection?: boolean;
  deflectionEnabled?: boolean;
  storeCreditEnabled?: boolean;
  storeCreditMethod?: string;
  storeCreditBonusPercent?: number;
  storeCreditIssueTiming?: string;
  complaintResolutionMode?: string;
  complaintRequireItemReturn?: boolean;
  exchangeShipTiming?: string;
  exchangeReserveDays?: number;
  offerCreditWhenUnavailable?: boolean;
  clawBackFreeItems?: boolean;
  refundShippingCost?: boolean;
  claimRequiresPhoto?: boolean;
  claimMinPhotos?: number;
  claimMinCommentLength?: number;
  labelTimingPerMarket?: Record<string, "immediate" | "after_approval">;
  defaultReturnMethodPerMarket?: Record<string, { carrierId?: string; service?: string }>;
  warehouseAddressesPerMarket?: Record<string, Record<string, string>>;
};

export async function getOrCreateSettings(shop: string) {
  let settings = await prisma.settings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.settings.create({ data: { shop } });
  }
  return settings;
}

export async function updateSettings(shop: string, input: SettingsInput) {
  const data: Record<string, unknown> = {};
  if (input.returnDeadlineDays !== undefined) data.returnDeadlineDays = input.returnDeadlineDays;
  if (input.exchangeDeadlineDays !== undefined) data.exchangeDeadlineDays = input.exchangeDeadlineDays;
  if (input.autoApproveRequests !== undefined) data.autoApproveRequests = input.autoApproveRequests;
  if (input.emailFrom !== undefined) data.emailFrom = input.emailFrom;
  if (input.autoRefundOnInspection !== undefined) data.autoRefundOnInspection = input.autoRefundOnInspection;
  if (input.deflectionEnabled !== undefined) data.deflectionEnabled = input.deflectionEnabled;
  if (input.storeCreditEnabled !== undefined) data.storeCreditEnabled = input.storeCreditEnabled;
  if (input.storeCreditMethod !== undefined) data.storeCreditMethod = input.storeCreditMethod;
  if (input.storeCreditBonusPercent !== undefined) data.storeCreditBonusPercent = input.storeCreditBonusPercent;
  if (input.storeCreditIssueTiming !== undefined) data.storeCreditIssueTiming = input.storeCreditIssueTiming;
  if (input.complaintResolutionMode !== undefined) data.complaintResolutionMode = input.complaintResolutionMode;
  if (input.complaintRequireItemReturn !== undefined) data.complaintRequireItemReturn = input.complaintRequireItemReturn;
  if (input.exchangeShipTiming !== undefined) data.exchangeShipTiming = input.exchangeShipTiming;
  if (input.exchangeReserveDays !== undefined) data.exchangeReserveDays = input.exchangeReserveDays;
  if (input.offerCreditWhenUnavailable !== undefined) data.offerCreditWhenUnavailable = input.offerCreditWhenUnavailable;
  if (input.clawBackFreeItems !== undefined) data.clawBackFreeItems = input.clawBackFreeItems;
  if (input.refundShippingCost !== undefined) data.refundShippingCost = input.refundShippingCost;
  if (input.claimRequiresPhoto !== undefined) data.claimRequiresPhoto = input.claimRequiresPhoto;
  if (input.claimMinPhotos !== undefined) data.claimMinPhotos = input.claimMinPhotos;
  if (input.claimMinCommentLength !== undefined) data.claimMinCommentLength = input.claimMinCommentLength;
  if (input.labelTimingPerMarket !== undefined)
    data.labelTimingPerMarket = JSON.stringify(input.labelTimingPerMarket);
  if (input.defaultReturnMethodPerMarket !== undefined)
    data.defaultReturnMethodPerMarket = JSON.stringify(input.defaultReturnMethodPerMarket);
  if (input.warehouseAddressesPerMarket !== undefined)
    data.warehouseAddressesPerMarket = JSON.stringify(input.warehouseAddressesPerMarket);

  return prisma.settings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export type ReturnImageCommentConfig = {
  enabled: boolean;
  imageUploadMode: "optional" | "mandatory" | "disabled";
  maxPhotos: number;
  includeInstructions: boolean;
  instructions: string;
  commentMode: "optional" | "mandatory" | "disabled";
};

export function getReturnImageCommentConfig(settings?: { labelTimingPerMarket?: string | null } | null): ReturnImageCommentConfig {
  const timings = parseJson<Record<string, string>>(settings?.labelTimingPerMarket, {});
  const raw = timings["__return_image_comment"];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        enabled: Boolean(parsed.enabled),
        imageUploadMode: parsed.imageUploadMode || "optional",
        maxPhotos: Number(parsed.maxPhotos) || 1,
        includeInstructions: Boolean(parsed.includeInstructions),
        instructions: String(parsed.instructions || ""),
        commentMode: parsed.commentMode || "optional",
      };
    } catch {}
  }
  return {
    enabled: false,
    imageUploadMode: "optional",
    maxPhotos: 1,
    includeInstructions: false,
    instructions: "",
    commentMode: "optional",
  };
}

export async function updateReturnImageCommentConfig(shop: string, config: ReturnImageCommentConfig) {
  const current = await getOrCreateSettings(shop);
  const timings = parseJson<Record<string, string>>(current.labelTimingPerMarket, {});
  timings["__return_image_comment"] = JSON.stringify(config);
  return updateSettings(shop, {
    labelTimingPerMarket: timings as Record<string, "immediate" | "after_approval">,
  });
}

export type ReturnFormCustomization = {
  primaryColor: string;
  primaryTextColor: string;
  textColor: string;
  secondaryBgColor: string;
  showLogo: boolean;
  showStoreName: boolean;
  logoUrl?: string;
  storeName?: string;
};

export const DEFAULT_RETURN_FORM_CUSTOMIZATION: ReturnFormCustomization = {
  primaryColor: "#de4066",
  primaryTextColor: "#121212",
  textColor: "#ffffff",
  secondaryBgColor: "#fff7f8",
  showLogo: true,
  showStoreName: true,
  logoUrl: "",
  storeName: "Grand Le Mar",
};

export function getReturnFormCustomization(settings?: { labelTimingPerMarket?: string | null } | null): ReturnFormCustomization {
  const timings = parseJson<Record<string, string>>(settings?.labelTimingPerMarket, {});
  const raw = timings["__form_customization"];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        primaryColor: typeof parsed.primaryColor === "string" && parsed.primaryColor ? parsed.primaryColor : DEFAULT_RETURN_FORM_CUSTOMIZATION.primaryColor,
        primaryTextColor: typeof parsed.primaryTextColor === "string" && parsed.primaryTextColor ? parsed.primaryTextColor : DEFAULT_RETURN_FORM_CUSTOMIZATION.primaryTextColor,
        textColor: typeof parsed.textColor === "string" && parsed.textColor ? parsed.textColor : DEFAULT_RETURN_FORM_CUSTOMIZATION.textColor,
        secondaryBgColor: typeof parsed.secondaryBgColor === "string" && parsed.secondaryBgColor ? parsed.secondaryBgColor : DEFAULT_RETURN_FORM_CUSTOMIZATION.secondaryBgColor,
        showLogo: Boolean(parsed.showLogo),
        showStoreName: Boolean(parsed.showStoreName),
        logoUrl: typeof parsed.logoUrl === "string" ? parsed.logoUrl : "",
        storeName: typeof parsed.storeName === "string" ? parsed.storeName : "",
      };
    } catch {}
  }
  return { ...DEFAULT_RETURN_FORM_CUSTOMIZATION };
}

export async function updateReturnFormCustomization(shop: string, config: Partial<ReturnFormCustomization>) {
  const current = await getOrCreateSettings(shop);
  const timings = parseJson<Record<string, string>>(current.labelTimingPerMarket, {});
  const existing = getReturnFormCustomization(current);
  const updated: ReturnFormCustomization = {
    ...existing,
    ...config,
  };
  timings["__form_customization"] = JSON.stringify(updated);
  return updateSettings(shop, {
    labelTimingPerMarket: timings as Record<string, "immediate" | "after_approval">,
  });
}

export function getLabelTimingForMarket(value: string | null | undefined, market: string | null | undefined) {
  const timings = parseJson<Record<string, string>>(value, {});
  const marketKey = market?.toUpperCase() || "DEFAULT";
  return (timings[marketKey] ?? timings.DEFAULT) === "immediate" ? "immediate" : "after_approval";
}
