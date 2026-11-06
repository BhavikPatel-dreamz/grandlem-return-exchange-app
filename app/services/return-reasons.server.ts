import prisma from "../db.server";

export type ReturnReasonInput = {
  labelEn: string;
  labelSv?: string;
  appliesTo?: string;
  autoRestock?: boolean;
  active?: boolean;
  sortOrder?: number;
};

export async function listReturnReasons(shop: string, activeOnly = false) {
  return prisma.returnReason.findMany({
    where: { shop, ...(activeOnly ? { active: true } : {}) },
    orderBy: [{ sortOrder: "asc" }, { labelEn: "asc" }],
  });
}

export async function getReturnReason(shop: string, id: string) {
  return prisma.returnReason.findFirst({ where: { shop, id } });
}

export async function createReturnReason(shop: string, input: ReturnReasonInput) {
  return prisma.returnReason.create({
    data: {
      shop,
      labelEn: input.labelEn,
      labelSv: input.labelSv ?? "",
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
      ...(input.labelSv !== undefined && { labelSv: input.labelSv }),
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
