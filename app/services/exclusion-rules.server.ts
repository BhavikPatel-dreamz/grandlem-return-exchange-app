import prisma from "../db.server";

export type ExclusionRuleInput = {
  targetType: "collection" | "product" | "variant";
  targetId: string;
  appliesToReturns?: boolean;
  appliesToExchanges?: boolean;
};

export async function listExclusionRules(shop: string) {
  return prisma.exclusionRule.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });
}

export async function createExclusionRule(shop: string, input: ExclusionRuleInput) {
  return prisma.exclusionRule.upsert({
    where: { shop_targetType_targetId: { shop, targetType: input.targetType, targetId: input.targetId } },
    create: {
      shop,
      targetType: input.targetType,
      targetId: input.targetId,
      appliesToReturns: input.appliesToReturns ?? true,
      appliesToExchanges: input.appliesToExchanges ?? true,
    },
    update: {
      appliesToReturns: input.appliesToReturns ?? true,
      appliesToExchanges: input.appliesToExchanges ?? true,
    },
  });
}

export async function updateExclusionRule(shop: string, id: string, input: Partial<ExclusionRuleInput>) {
  const existing = await prisma.exclusionRule.findFirst({ where: { shop, id } });
  if (!existing) throw new Error("Exclusion rule not found");
  return prisma.exclusionRule.update({
    where: { id },
    data: {
      ...(input.targetType !== undefined && { targetType: input.targetType }),
      ...(input.targetId !== undefined && { targetId: input.targetId }),
      ...(input.appliesToReturns !== undefined && { appliesToReturns: input.appliesToReturns }),
      ...(input.appliesToExchanges !== undefined && { appliesToExchanges: input.appliesToExchanges }),
    },
  });
}

export async function deleteExclusionRule(shop: string, id: string) {
  const existing = await prisma.exclusionRule.findFirst({ where: { shop, id } });
  if (!existing) throw new Error("Exclusion rule not found");
  return prisma.exclusionRule.delete({ where: { id } });
}
