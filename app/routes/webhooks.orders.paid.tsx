import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const tags = String(payload.tags || "").split(",").map((tag: string) => tag.trim());
  const exchangeTag = tags.find((tag: string) => tag.startsWith("return-exchange:"));
  const returnRequestId = exchangeTag?.slice("return-exchange:".length);
  if (!returnRequestId || String(payload.financial_status || "").toLowerCase() !== "paid") {
    return new Response(null, { status: 200 });
  }

  const orderId = payload.admin_graphql_api_id
    || (payload.id ? `gid://shopify/Order/${payload.id}` : null);
  if (!orderId) {
    console.error("[Exchange payment webhook] Paid order is missing its Shopify ID.");
    return new Response(null, { status: 500 });
  }

  await prisma.returnRequest.updateMany({
    where: {
      id: returnRequestId,
      shop,
      type: "exchange",
      status: "Awaiting Payment",
      draftOrderId: { not: null },
    },
    data: {
      status: "Paid",
      replacementOrderId: orderId,
      finalResolution: "EXCHANGE",
    },
  });

  return new Response(null, { status: 200 });
};