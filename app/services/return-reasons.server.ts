import prisma from "../db.server";

export type ReturnReasonInput = {
  labelEn: string;
  parentLabel?: string;
  appliesTo?: string;
  autoRestock?: boolean;
  active?: boolean;
  sortOrder?: number;
};

const SUB_REASON_PREFIX = "__glr_sub__:";
type ReturnReasonRecord = Awaited<ReturnType<typeof prisma.returnReason.findMany>>[number];
type ListedReturnReason = ReturnReasonRecord & { parentLabel?: string };

function encodeSubReasonLabel(parentLabel: string, labelEn: string) {
  return `${SUB_REASON_PREFIX}${encodeURIComponent(parentLabel)}:${labelEn}`;
}

export function decodeReason(reason: ReturnReasonRecord): ListedReturnReason {
  if (!reason.labelEn.startsWith(SUB_REASON_PREFIX)) return reason;
  const separator = reason.labelEn.indexOf(":", SUB_REASON_PREFIX.length);
  if (separator < 0) return reason;

  try {
    return {
      ...reason,
      labelEn: reason.labelEn.slice(separator + 1),
      parentLabel: decodeURIComponent(reason.labelEn.slice(SUB_REASON_PREFIX.length, separator)),
    };
  } catch {
    return reason;
  }
}

export const DEFAULT_RETURN_REASONS = [
  { labelEn: "Wrong size", appliesTo: "return,exchange", active: true, autoRestock: true, sortOrder: 1 },
  { labelEn: "Item is too big", appliesTo: "return,exchange", active: true, autoRestock: true, sortOrder: 2 },
  { labelEn: "Item is too small", appliesTo: "return,exchange", active: true, autoRestock: true, sortOrder: 3 },
  { labelEn: "Item is not as expected", appliesTo: "return,exchange", active: true, autoRestock: true, sortOrder: 4 },
  { labelEn: "I've changed my mind", appliesTo: "return,exchange", active: true, autoRestock: true, sortOrder: 5 },
  { labelEn: "Quality not as expected", appliesTo: "return,exchange", active: false, autoRestock: false, sortOrder: 6 },
  { labelEn: "Item did not match description on the website", appliesTo: "return,exchange", active: false, autoRestock: false, sortOrder: 7 },
  { labelEn: "Color not as expected", appliesTo: "return,exchange", active: false, autoRestock: false, sortOrder: 8 },
  { labelEn: "Fit not as expected", appliesTo: "return,exchange", active: false, autoRestock: false, sortOrder: 9 },
  { labelEn: "Measurements not as expected", appliesTo: "return,exchange", active: false, autoRestock: false, sortOrder: 10 },
  { labelEn: "I bought the wrong item", appliesTo: "return,exchange", active: false, autoRestock: false, sortOrder: 11 },
  { labelEn: "I intentionally ordered more than one item", appliesTo: "return,exchange", active: false, autoRestock: false, sortOrder: 12 },
  { labelEn: "Received item I didn't order", appliesTo: "return,exchange", active: false, autoRestock: false, sortOrder: 13 },
  { labelEn: "Item didn't arrive by estimated delivery date", appliesTo: "return,exchange", active: false, autoRestock: false, sortOrder: 14 },
  { labelEn: "Item arrived damaged/defective", appliesTo: "complaint", active: false, autoRestock: false, sortOrder: 15 },
  { labelEn: "Missing part or accessories", appliesTo: "complaint", active: false, autoRestock: false, sortOrder: 16 },
];

export async function deduplicateReturnReasons(shop: string) {
  const all = await prisma.returnReason.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
  });
  const seen = new Map<string, string>();
  const toDelete: string[] = [];
  for (const r of all) {
    const key = r.labelEn.toLowerCase().trim();
    if (seen.has(key)) {
      const keeperId = seen.get(key)!;
      await prisma.returnItem.updateMany({
        where: { reasonId: r.id },
        data: { reasonId: keeperId },
      });
      toDelete.push(r.id);
    } else {
      seen.set(key, r.id);
    }
  }
  if (toDelete.length > 0) {
    await prisma.returnReason.deleteMany({
      where: { id: { in: toDelete } },
    });
  }
}

export async function ensureDefaultReturnReasons(shop: string) {
  await deduplicateReturnReasons(shop);
  const count = await prisma.returnReason.count({ where: { shop } });
  if (count > 0) return;

  for (const r of DEFAULT_RETURN_REASONS) {
    await prisma.returnReason.create({
      data: {
        shop,
        labelEn: r.labelEn,
        appliesTo: r.appliesTo,
        active: r.active,
        autoRestock: r.autoRestock,
        sortOrder: r.sortOrder,
      },
    });
  }
}

export async function listReturnReasons(shop: string, activeOnly = false) {
  const all = await prisma.returnReason.findMany({
    where: { shop, ...(activeOnly ? { active: true } : {}) },
    orderBy: [{ sortOrder: "asc" }, { labelEn: "asc" }, { id: "asc" }],
  });
  const seen = new Set<string>();
  const unique = all.map(decodeReason).filter((r) => {
    const key = `${r.parentLabel ?? ""}\u0000${r.labelEn.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const parents = unique.filter((r) => !r.parentLabel);
  const children = unique.filter((r) => r.parentLabel);
  const ordered = parents.flatMap((parent) => [
    parent,
    ...children.filter((child) => child.parentLabel === parent.labelEn),
  ]);
  const parentLabels = new Set(parents.map((r) => r.labelEn));
  return [...ordered, ...children.filter((child) => !parentLabels.has(child.parentLabel!))];
}

export async function getReturnReason(shop: string, id: string) {
  return prisma.returnReason.findFirst({ where: { shop, id } });
}

export async function createReturnReason(shop: string, input: ReturnReasonInput) {
  return prisma.returnReason.create({
    data: {
      shop,
      labelEn: input.parentLabel
        ? encodeSubReasonLabel(input.parentLabel, input.labelEn)
        : input.labelEn,
      appliesTo: input.appliesTo ?? "return,exchange,complaint",
      autoRestock: input.autoRestock ?? false,
      active: input.active ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

export async function updateReturnReason(shop: string, id: string, input: Partial<ReturnReasonInput>) {
  const existing = await getReturnReason(shop, id);
  if (!existing) throw new Error("Return reason not found");
  return prisma.returnReason.update({
    where: { id },
    data: {
      ...(input.labelEn !== undefined && { labelEn: input.labelEn }),
      ...(input.appliesTo !== undefined && { appliesTo: input.appliesTo }),
      ...(input.autoRestock !== undefined && { autoRestock: input.autoRestock }),
      ...(input.active !== undefined && { active: input.active }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    },
  });
}

export async function deleteReturnReason(shop: string, id: string) {
  const existing = await getReturnReason(shop, id);
  if (!existing) throw new Error("Return reason not found");
  return prisma.returnReason.delete({ where: { id } });
}
