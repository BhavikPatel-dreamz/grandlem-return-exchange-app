import prisma from "../db.server";
import { getOrCreateSettings, parseJson } from "./settings.server";

export type RequestType = "return" | "exchange" | "complaint";

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export async function getDeadlineDays(shop: string, type: RequestType): Promise<number> {
  const settings = await getOrCreateSettings(shop);
  switch (type) {
    case "exchange":
      return settings.exchangeDeadlineDays;
    case "complaint":
      return settings.complaintDeadlineDays;
    default:
      return settings.returnDeadlineDays;
  }
}

export async function getEffectiveDeadline(
  shop: string,
  shopifyOrderId: string,
  type: RequestType,
  orderCreatedAt: Date,
): Promise<Date> {
  const days = await getDeadlineDays(shop, type);
  const base = addDays(orderCreatedAt, days);
  const ext = await prisma.deadlineExtension.findUnique({
    where: { shop_shopifyOrderId_type: { shop, shopifyOrderId, type } },
  });
  if (ext && ext.newDeadline > base) return ext.newDeadline;
  return ext ? ext.newDeadline : base;
}

export function isExpired(deadline: Date, now: Date = new Date()): boolean {
  return now.getTime() > deadline.getTime();
}

export async function isItemExcluded(
  shop: string,
  ctx: { productId?: string; variantId?: string; collectionIds?: string[] },
  mode: RequestType,
): Promise<boolean> {
  const appliesField = mode === "exchange" ? "appliesToExchanges" : "appliesToReturns";
  const rules = await prisma.exclusionRule.findMany({ where: { shop } });
  for (const rule of rules) {
    if (!rule[appliesField as keyof typeof rule]) continue;
    if (rule.targetType === "collection" && ctx.collectionIds?.includes(rule.targetId)) return true;
    if (rule.targetType === "product" && ctx.productId === rule.targetId) return true;
    if (rule.targetType === "variant" && ctx.variantId === rule.targetId) return true;
  }
  return false;
}

export async function reasonAppliesTo(reason: { appliesTo: string }, type: RequestType): Promise<boolean> {
  return reason.appliesTo.split(",").map((s) => s.trim()).includes(type) || reason.appliesTo.includes("any");
}

export { parseJson };
