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
  items: CreateReturnItemInput[];
};

export async function createReturnRequest(input: CreateReturnRequestInput) {
  if (input.items.length === 0) throw new Error("No items selected.");

  const existingCount = await prisma.returnRequest.count({ where: { shop: input.shop } });
  const requestNumber = `GLM-${1001 + existingCount}`;

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
      status: "Submitted",
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
