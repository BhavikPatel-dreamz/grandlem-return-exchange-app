/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getOrCreateSettings, parseJson } from "./settings.server";

const SHIPPYPRO_URL = process.env.SHIPPYPRO_API_URL || "https://www.shippypro.com/api";
const SHIPPYPRO_KEY = process.env.SHIPPYPRO_API_KEY || "";

export type ShippyProResult = { ok: boolean; data?: any; error?: string };

export async function shippyproCall(method: string, params: Record<string, unknown> = {}): Promise<ShippyProResult> {
  if (!SHIPPYPRO_KEY) {
    return { ok: false, error: "SHIPPYPRO_API_KEY not configured" };
  }
  try {
    const res = await fetch(SHIPPYPRO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params, key: SHIPPYPRO_KEY }),
    });
    const json = await res.json();
    if (json?.error) return { ok: false, error: String(json.error), data: json };
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

export async function syncCarriers(shop: string): Promise<ShippyProResult> {
  const result = await shippyproCall("GetCarriers", {});
  if (!result.ok) return result;

  const carriers = Array.isArray(result.data?.result) ? result.data.result : result.data?.carriers || [];
  for (const c of carriers) {
    const connectionId = String(c.CarrierID ?? c.id ?? c.carrier_id ?? "");
    if (!connectionId) continue;
    await prisma.carrier.upsert({
      where: { shop_shippyproCarrierId: { shop, shippyproCarrierId: connectionId } },
      create: {
        shop,
        shippyproCarrierId: connectionId,
        name: String(c.CarrierName ?? c.name ?? connectionId),
        service: c.Service ?? c.service ?? null,
        meta: JSON.stringify(c),
        syncedAt: new Date(),
      },
      update: {
        name: String(c.CarrierName ?? c.name ?? connectionId),
        service: c.Service ?? c.service ?? null,
        meta: JSON.stringify(c),
        syncedAt: new Date(),
      },
    });
  }
  return { ok: true, data: carriers };
}

export async function findOriginalShipment(shop: string, orderNumber: string | null) {
  if (!orderNumber) return null;
  const result = await shippyproCall("GetShippedOrders", { OrderID: orderNumber });
  if (!result.ok) return null;
  const list = Array.isArray(result.data?.result) ? result.data.result : result.data?.orders || [];
  return list?.[0] ?? null;
}

export async function fetchOrderShippingAddress(shop: string, shopifyOrderId: string): Promise<Record<string, string> | null> {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const id = shopifyOrderId.startsWith("gid://") ? shopifyOrderId : `gid://shopify/Order/${shopifyOrderId}`;
    const response = await admin.graphql(
      `#graphql
      query getOrderShipping($id: ID!) {
        order(id: $id) {
          shippingAddress {
            name address1 address2 city zip country phone
          }
          email
        }
      }`,
      { variables: { id } },
    );
    const json = await response.json();
    return json?.data?.order?.shippingAddress ?? null;
  } catch {
    return null;
  }
}

function routingDecision(original: any, settings: any, market: string | null) {
  const defaults = parseJson<Record<string, { carrierId?: string; service?: string }>>(settings.defaultReturnMethodPerMarket, {});
  let carrierId: string | null = null;
  let service: string | null = null;
  let flagged = false;
  let reason = "";

  if (original) {
    carrierId = String(original.CarrierID ?? original.carrier_id ?? "") || null;
    service = original.Service ?? original.service ?? null;
    if (!carrierId) {
      flagged = true;
      reason = "Original shipment found but carrier could not be identified";
    }
  } else {
    flagged = true;
    reason = "Original shipment not found; using market default";
    const key = (market || "default").toUpperCase();
    const def = defaults[key] || defaults["DEFAULT"] || Object.values(defaults)[0];
    carrierId = def?.carrierId ?? null;
    service = def?.service ?? null;
  }
  return { carrierId, service, flagged, reason };
}

export async function createReturnLabel(returnRequestId: string, maxAttempts = 3): Promise<{ ok: boolean; error?: string }> {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const rr = await prisma.returnRequest.findUnique({
        where: { id: returnRequestId },
        include: { items: true, label: true },
      });
      if (!rr) throw new Error("Return request not found");

      const settings = await getOrCreateSettings(rr.shop);
      const original = await findOriginalShipment(rr.shop, rr.orderNumber);
      const routing = routingDecision(original, settings, rr.market);
      if (!routing.carrierId) throw new Error("No carrier available for routing");

      // Ensure carrier record exists in DB (best effort)
      const carrier = await prisma.carrier.findUnique({
        where: { shop_shippyproCarrierId: { shop: rr.shop, shippyproCarrierId: routing.carrierId } },
      });

      const warehouseMap = parseJson<Record<string, Record<string, string>>>(settings.warehouseAddressesPerMarket, {});
      const marketKey = (rr.market || "DEFAULT").toUpperCase();
      const warehouse = warehouseMap[marketKey] || warehouseMap["DEFAULT"] || Object.values(warehouseMap)[0] || {};

      const shippingAddress = await fetchOrderShippingAddress(rr.shop, rr.shopifyOrderId || "");

      const customs = rr.items.map((it) => ({
        Description: it.title || "Returned item",
        Quantity: it.quantity,
        Value: it.priceDifferenceStr || "0",
        OriginCountry: warehouse["country"] || "",
        HSCode: "",
      }));

      const params = {
        CarrierID: routing.carrierId,
        Service: routing.service,
        IsReturn: true,
        OrderID: rr.orderNumber || rr.shopifyOrderId,
        ToAddress: {
          Name: (warehouse["name"] as string) || "Warehouse",
          Company: warehouse["company"] || "",
          Address1: warehouse["address1"] || warehouse["address"] || "",
          Address2: warehouse["address2"] || "",
          City: warehouse["city"] || "",
          ZIP: warehouse["zip"] || "",
          Country: warehouse["country"] || "",
        },
        FromAddress: {
          Name: shippingAddress?.name || rr.customerName || "Customer",
          Address1: shippingAddress?.address1 || "",
          Address2: shippingAddress?.address2 || "",
          City: shippingAddress?.city || "",
          ZIP: shippingAddress?.zip || "",
          Country: shippingAddress?.country || "",
          Phone: shippingAddress?.phone || "",
          Email: rr.customerEmail || "",
        },
        Parcels: [{ Weight: 1, Length: 10, Width: 10, Height: 10 }],
        Customs: customs,
      };

      const shipResult = await shippyproCall("Ship", params);
      if (!shipResult.ok) throw new Error(shipResult.error || "Ship call failed");

      const data = shipResult.data?.result || shipResult.data;
      const labelUrl = data?.LabelURL || data?.label_url || data?.label;
      const trackingNumber = data?.TrackingNumber || data?.tracking_number;
      const trackingUrl = data?.TrackingURL || data?.tracking_url;

      await prisma.returnLabel.upsert({
        where: { returnRequestId: rr.id },
        create: {
          returnRequestId: rr.id,
          carrierId: carrier?.id ?? null,
          connectionId: routing.carrierId,
          service: routing.service ?? null,
          labelUrl: labelUrl ?? null,
          trackingNumber: trackingNumber ?? null,
          trackingUrl: trackingUrl ?? null,
          status: "created",
          customsData: JSON.stringify(customs),
        },
        update: {
          carrierId: carrier?.id ?? null,
          connectionId: routing.carrierId,
          service: routing.service ?? null,
          labelUrl: labelUrl ?? null,
          trackingNumber: trackingNumber ?? null,
          trackingUrl: trackingUrl ?? null,
          status: "created",
          customsData: JSON.stringify(customs),
        },
      });

      if (routing.flagged) {
        await prisma.returnRequest.update({ where: { id: rr.id }, data: { reviewFlagged: true } });
      }

      return { ok: true };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Unknown error";
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Notify admin on failure
  console.error(`[ShippyPro] Label generation failed for request ${returnRequestId}: ${lastError}`);
  try {
    const rr = await prisma.returnRequest.findUnique({ where: { id: returnRequestId } });
    if (rr) {
      await prisma.returnLabel.upsert({
        where: { returnRequestId },
        create: { returnRequestId, status: "failed" },
        update: { status: "failed" },
      });
    }
  } catch {
    // ignore
  }
  return { ok: false, error: lastError };
}
