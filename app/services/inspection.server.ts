import prisma from "../db.server";
import { performRestock } from "./restock.server";
import { autoRefundIfEligible } from "./refunds.server";
import { sendEventEmail } from "./email.server";

export type InspectionInput = {
  returnItemId: string;
  condition: "OK" | "DAMAGED" | "WRONG_ITEM" | "MISSING";
  approvedQuantity: number;
  note?: string;
};

export async function saveInspection(
  shop: string,
  returnRequestId: string,
  inspections: InspectionInput[],
): Promise<{ ok: boolean; error?: string }> {
  const rr = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, shop },
    include: { items: { include: { reason: true } } },
  });
  if (!rr) return { ok: false, error: "Request not found" };

  for (const insp of inspections) {
    const item = rr.items.find((it) => it.id === insp.returnItemId);
    if (!item) continue;

    await prisma.inspectionResult.upsert({
      where: { returnItemId: insp.returnItemId },
      create: {
        returnItemId: insp.returnItemId,
        condition: insp.condition,
        approvedQuantity: Math.max(0, Math.min(insp.approvedQuantity, item.returnedQuantity || item.quantity)),
        note: insp.note || null,
      },
      update: {
        condition: insp.condition,
        approvedQuantity: Math.max(0, Math.min(insp.approvedQuantity, item.returnedQuantity || item.quantity)),
        note: insp.note || null,
      },
    });

    // Update returnedQuantity to approved quantity for later refund/restock flow bookkeeping.
    await prisma.returnItem.update({
      where: { id: item.id },
      data: { returnedQuantity: Math.max(0, Math.min(insp.approvedQuantity, item.returnedQuantity || item.quantity)) },
    });

    // Restock only approved, undamaged items.
    if (insp.condition === "OK" && item.reason?.autoRestock) {
      await performRestock(shop, item.id, null, insp.approvedQuantity).catch(() => null);
    }
  }

  await prisma.returnRequest.update({
    where: { id: returnRequestId },
    data: { status: "Inspected" },
  });

  if (rr.customerEmail) {
    void sendEventEmail(shop, "item_received", "en", rr.customerEmail, {
      orderNumber: rr.orderNumber,
    }).catch(() => null);
  }

  void autoRefundIfEligible(shop, returnRequestId).catch(() => null);

  return { ok: true };
}

export function isRestockable(condition: string): boolean {
  return condition === "OK";
}