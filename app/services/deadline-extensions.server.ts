import prisma from "../db.server";

export type DeadlineExtensionInput = {
  shopifyOrderId: string;
  type: "return" | "exchange" | "complaint";
  newDeadline: Date;
  note?: string;
};

export async function getDeadlineExtension(shop: string, shopifyOrderId: string, type: string) {
  return prisma.deadlineExtension.findUnique({
    where: { shop_shopifyOrderId_type: { shop, shopifyOrderId, type } },
  });
}

export async function upsertDeadlineExtension(shop: string, input: DeadlineExtensionInput) {
  return prisma.deadlineExtension.upsert({
    where: { shop_shopifyOrderId_type: { shop, shopifyOrderId: input.shopifyOrderId, type: input.type } },
    create: { shop, shopifyOrderId: input.shopifyOrderId, type: input.type, newDeadline: input.newDeadline, note: input.note },
    update: { newDeadline: input.newDeadline, note: input.note },
  });
}

export async function deleteDeadlineExtension(shop: string, id: string) {
  const existing = await prisma.deadlineExtension.findFirst({ where: { shop, id } });
  if (!existing) throw new Error("Deadline extension not found");
  return prisma.deadlineExtension.delete({ where: { id } });
}

export async function listDeadlineExtensions(shop: string) {
  return prisma.deadlineExtension.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });
}
