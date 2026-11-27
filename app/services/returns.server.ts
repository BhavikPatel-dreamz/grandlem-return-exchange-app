import prisma from "../db.server";

export type CreateReturnItemInput = {
  shopifyLineItemId: string;
  productId?: string | null;
  variantId?: string | null;
  title?: string | null;
  quantity: number;
  reasonId?: string | null;
  comment?: string | null;
  photos?: { url: string; fileName?: string; mimeType?: string; size?: number }[];
};

export type CreateReturnRequestInput = {
  shop: string;
  shopifyOrderId: string;
  orderNumber?: string | null;
  market?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  type: "return" | "exchange" | "complaint";
  autoApprove?: boolean;
  items: CreateReturnItemInput[];
  fulfillmentLocationId?: string | null;
};

/**
 * Next free GLM-#### number for the shop. Counting rows alone can repeat a
 * number after a deletion or when two requests arrive together, so the
 * candidate is checked and bumped until unused.
 * TODO: add a unique index on (shop, requestNumber) once the live data has
 * been checked for existing duplicates.
 */
async function nextRequestNumber(shop: string): Promise<string> {
  let n = 1001 + (await prisma.returnRequest.count({ where: { shop } }));
  for (let i = 0; i < 50; i++, n++) {
    const candidate = `GLM-${n}`;
    const taken = await prisma.returnRequest.findFirst({ where: { shop, requestNumber: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `GLM-${n}-${Date.now().toString(36)}`;
}

export async function createReturnRequest(input: CreateReturnRequestInput) {
  if (input.items.length === 0) throw new Error("No items selected.");

  const requestNumber = await nextRequestNumber(input.shop);

  const request = await prisma.returnRequest.create({
    data: {
      shop: input.shop,
      shopifyOrderId: input.shopifyOrderId,
      orderNumber: input.orderNumber ?? null,
      requestNumber,
      market: input.market ?? null,
      customerEmail: input.customerEmail ?? null,
      customerName: input.customerName ?? null,
      type: input.type,
      status: input.autoApprove ? "Approved" : "Submitted",
      approvedAt: input.autoApprove ? new Date() : null,
      fulfillmentLocationId: input.fulfillmentLocationId ?? null,
      items: {
        create: input.items.map((it) => ({
          shopifyLineItemId: it.shopifyLineItemId,
          productId: it.productId ?? null,
          variantId: it.variantId ?? null,
          title: it.title ?? null,
          quantity: it.quantity,
          returnedQuantity: it.quantity,
          reasonId: it.reasonId ?? null,
          comment: it.comment ?? null,
          photos: {
            create: (it.photos ?? []).map((p) => ({
              url: p.url,
              fileName: p.fileName ?? null,
              mimeType: p.mimeType ?? null,
              size: p.size ?? null,
            })),
          },
        })),
      },
    },
    include: { items: { include: { photos: true } } },
  });

  return request;
}
