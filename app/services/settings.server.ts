import prisma from "../db.server";

export type SettingsInput = {
  returnDeadlineDays?: number;
  exchangeDeadlineDays?: number;
  complaintDeadlineDays?: number;
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
  if (input.complaintDeadlineDays !== undefined) data.complaintDeadlineDays = input.complaintDeadlineDays;
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
