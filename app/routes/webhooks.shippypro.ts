/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const trackingNumber = payload?.tracking_number || payload?.TrackingNumber || payload?.trackingNumber;
  const orderRef = payload?.order_id || payload?.OrderID || payload?.order_number || payload?.OrderNumber;
  const status = payload?.status || payload?.Status || "updated";
  const message = payload?.message || payload?.Message || null;

  let label = null;
  if (trackingNumber) {
    label = await prisma.returnLabel.findFirst({ where: { trackingNumber: String(trackingNumber) } });
  }
  if (!label && orderRef) {
    const rr = await prisma.returnRequest.findFirst({ where: { OR: [{ orderNumber: String(orderRef) }, { shopifyOrderId: String(orderRef) }] } });
    if (rr) label = await prisma.returnLabel.findUnique({ where: { returnRequestId: rr.id } });
  }

  if (!label) {
    return Response.json({ ok: false, error: "Label not found" }, { status: 404 });
  }

  await prisma.trackingEvent.create({
    data: {
      returnLabelId: label.id,
      returnRequestId: label.returnRequestId,
      status: String(status),
      message: message ? String(message) : null,
      occurredAt: payload?.occurred_at ? new Date(payload.occurred_at) : new Date(),
      raw: JSON.stringify(payload),
    },
  });

  await prisma.returnLabel.update({
    where: { id: label.id },
    data: { status: String(status) },
  });

  // Optionally update parent request status when received/completed
  const normalized = String(status).toLowerCase();
  if (normalized.includes("delivered") || normalized.includes("received")) {
    await prisma.returnRequest.update({
      where: { id: label.returnRequestId },
      data: { status: "Received" },
    }).catch(() => null);
  }

  return Response.json({ ok: true });
};
