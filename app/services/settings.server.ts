import prisma from "../db.server";

export type SettingsInput = {
  returnDeadlineDays?: number;
  exchangeDeadlineDays?: number;
  complaintDeadlineDays?: number;
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
