/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getOrCreateSettings, parseJson } from "./settings.server";
import { decryptSecret, encryptSecret } from "./crypto.server";
import { sendEmail } from "./email.server";
import { emailRecipientFor, isTestShop, liveLabelBlockedReason } from "./test-mode.server";
import { RETRYABLE_LABEL_STATUSES } from "./label-status";

const DEFAULT_SHIPPYPRO_URL = "https://api.shippypro.com/v1";
const LEGACY_SHIPPYPRO_URL = "https://www.shippypro.com/api";

// `uncertain` = the request may have reached ShippyPro but we have no usable
// answer (network error, timeout, unreadable body). For `Ship` that means a
// shipment may exist, so it must never be re-sent automatically.
export type ShippyProResult = { ok: boolean; data?: any; error?: string; uncertain?: boolean };

function retryAfterMs(value: string | null, attempt: number): number {
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 1000 * 2 ** attempt;
}

export async function resolveShippyProApiKey(shop?: string | null): Promise<string> {
  if (shop) {
    try {
      const settings = await getOrCreateSettings(shop);
      const decrypted = decryptSecret(settings.shippyproApiKeyEncrypted);
      if (decrypted) return decrypted;
    } catch {
      // fall back to env
    }
  }
  // A test store must use its own saved key, never the shared env key.
  if (isTestShop(shop)) return "";
  return process.env.SHIPPYPRO_API_KEY || "";
}

async function resolveShippyProApiUrl(shop?: string | null): Promise<string> {
  if (shop) {
    try {
      const settings = await getOrCreateSettings(shop);
      if (settings.shippyproApiUrl) {
        const savedUrl = settings.shippyproApiUrl.trim().replace(/\/+$/, "");
        return savedUrl === LEGACY_SHIPPYPRO_URL ? DEFAULT_SHIPPYPRO_URL : savedUrl;
      }
    } catch {
      // fall back to env
    }
  }
  const envUrl = process.env.SHIPPYPRO_API_URL?.trim().replace(/\/+$/, "");
  return envUrl === LEGACY_SHIPPYPRO_URL ? DEFAULT_SHIPPYPRO_URL : envUrl || DEFAULT_SHIPPYPRO_URL;
}

export async function shippyproCall(method: string, params: Record<string, unknown> = {}, shop?: string | null): Promise<ShippyProResult> {
  const apiKey = await resolveShippyProApiKey(shop);
  if (!apiKey) {
    return { ok: false, error: "SHIPPYPRO_API_KEY not configured" };
  }
  try {
    const apiUrl = await resolveShippyProApiUrl(shop);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${apiUrl}/${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ Method: method, Params: params }),
      });
      if (res.status === 429 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs(res.headers.get("Retry-After"), attempt)));
        continue;
      }
      const json = await res.json();
      const resultOk = String(json?.Result ?? "").toUpperCase() === "OK";
      // Some ShippyPro errors carry only ErrorMessage, with no Result field.
      const errorMessageOnly = !resultOk && typeof json?.ErrorMessage === "string" && json.ErrorMessage.trim() !== "";
      if (json?.error || errorMessageOnly || (json?.Result && !resultOk)) {
        return {
          ok: false,
          error: String(json.ErrorMessage || json.error || json.Result),
          data: json,
        };
      }
      if (!res.ok) return { ok: false, error: `ShippyPro HTTP ${res.status}`, data: json };
      return { ok: true, data: json };
    }
    return { ok: false, error: "ShippyPro rate limit exceeded" };
  } catch (e) {
    return { ok: false, uncertain: true, error: e instanceof Error ? e.message : "Network error" };
  }
}

export async function syncCarriers(shop: string): Promise<ShippyProResult> {
  const result = await shippyproCall("GetCarriers", {}, shop);
  if (!result.ok) return result;

  const responseData = result.data?.result ?? result.data?.data ?? result.data;
  const carrierData = responseData?.Carriers?.additionalProperty
    ?? responseData?.Carriers?.additionalProperties
    ?? responseData?.Carriers
    ?? responseData?.carriers
    ?? responseData?.result
    ?? responseData;
  const carriers = Array.isArray(carrierData)
    ? carrierData
    : carrierData && typeof carrierData === "object"
      ? "CarrierID" in carrierData || "id" in carrierData || "carrier_id" in carrierData
        ? [carrierData]
        : Object.values(carrierData).flatMap((entries) =>
            Array.isArray(entries) ? entries : entries && typeof entries === "object" ? [entries] : [],
          )
      : [];
  const syncedCarriers = [];
  for (const c of carriers) {
    const connectionId = String(c.CarrierID ?? c.id ?? c.carrier_id ?? "");
    if (!connectionId) continue;
    const services = Array.from(new Set([
      c.CarrierService,
      ...(Array.isArray(c.ServiceList) ? c.ServiceList : []),
      ...(Array.isArray(c.ServicesList) ? c.ServicesList : []),
      c.Service,
      c.service,
    ].filter(Boolean).map(String)));
    const primaryService = services[0] ?? null;
    const carrierName = String(c.Label ?? c.CarrierName ?? c.name ?? connectionId);
    await prisma.carrier.upsert({
      where: { shop_shippyproCarrierId: { shop, shippyproCarrierId: connectionId } },
      create: {
        shop,
        shippyproCarrierId: connectionId,
        name: carrierName,
        service: primaryService,
        meta: JSON.stringify(c),
        syncedAt: new Date(),
      },
      update: {
        name: carrierName,
        service: primaryService,
        meta: JSON.stringify(c),
        syncedAt: new Date(),
      },
    });

    for (const service of services) {
      await prisma.courierService.upsert({
        where: { shop_shippyproCarrierId_service: { shop, shippyproCarrierId: connectionId, service } },
        create: {
          shop,
          shippyproCarrierId: connectionId,
          service,
          supportsReturns: true,
          supportsPickup: Boolean(c.Pickup ?? c.pickup ?? c.supportsPickup),
          supportsQr: Boolean(c.QR ?? c.qr ?? c.supportsQr),
          supportsDropoff: Boolean(c.Dropoff ?? c.dropoff ?? true),
          meta: JSON.stringify(c),
          syncedAt: new Date(),
        },
        update: {
          supportsPickup: Boolean(c.Pickup ?? c.pickup ?? c.supportsPickup),
          supportsQr: Boolean(c.QR ?? c.qr ?? c.supportsQr),
          supportsDropoff: Boolean(c.Dropoff ?? c.dropoff ?? true),
          meta: JSON.stringify(c),
          syncedAt: new Date(),
        },
      });
    }
    syncedCarriers.push({ ...c, CarrierID: connectionId });
  }
  if (syncedCarriers.length === 0) {
    return {
      ok: false,
      error: "ShippyPro returned no carriers with a CarrierID. Connect a carrier in ShippyPro, then re-sync.",
      data: result.data,
    };
  }
  return { ok: true, data: syncedCarriers };
}

export type Parcel = { weight: number; length: number; width: number; height: number };

// ShippyPro's report field names are not confirmed against the official docs
// (the API reference is JS-rendered). Several spellings are accepted; anything
// unreadable falls back to Settings and flags the request for review.
function readParcels(shipment: any): Parcel[] {
  const raw = shipment.Parcels ?? shipment.parcels ?? shipment.ParcelList ?? null;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const num = (v: unknown) => Number(String(v ?? "").replace(",", "."));
  const parcels = list.map((p: any) => ({
    weight: num(p.weight ?? p.Weight),
    length: num(p.length ?? p.Length),
    width: num(p.width ?? p.Width),
    height: num(p.height ?? p.Height),
  }));
  return parcels.length > 0 && parcels.every((p) => Object.values(p).every((v) => Number.isFinite(v) && v > 0)) ? parcels : [];
}

function readAddress(address: any): Record<string, string> {
  if (!address || typeof address !== "object") return {};
  const pick = (...keys: string[]) => String(keys.map((k) => address[k]).find((v) => v !== undefined && v !== null && v !== "") ?? "");
  return {
    name: pick("Name", "name"),
    company: pick("Company", "company"),
    address1: pick("Address1", "address1", "street1", "Street1"),
    address2: pick("Address2", "address2", "street2", "Street2"),
    city: pick("City", "city"),
    state: pick("State", "state", "Province", "province"),
    zip: pick("ZIP", "Zip", "zip"),
    country: pick("Country", "country"),
    phone: pick("Phone", "phone"),
    email: pick("Email", "email"),
  };
}

export async function findOriginalShipment(
  shop: string,
  orderNumber: string | null,
  submittedAt: Date,
  lookbackDays: number,
) {
  if (!orderNumber) return null;
  const dateMax = Math.floor(Date.now() / 1000);
  const dateMin = Math.floor((submittedAt.getTime() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);
  const result = await shippyproCall("GetShipmentsReport", {
    DateMin: dateMin,
    DateMax: dateMax,
    IncludeItems: false,
    Return: false,
  }, shop);
  if (!result.ok) return null;
  const responseData = result.data?.result ?? result.data?.data ?? result.data;
  const shipmentData = responseData?.Shipments?.additionalProperty
    ?? responseData?.Shipments
    ?? responseData?.shipments
    ?? [];
  const shipments = Array.isArray(shipmentData) ? shipmentData : [shipmentData];
  const normalizeRef = (value: unknown) => String(value ?? "").trim().replace(/^#/, "").toLowerCase();
  const targetOrderNumber = normalizeRef(orderNumber);
  const shipment = shipments.find((candidate: any) => [
    candidate.TransactionID,
    candidate.transactionId,
    candidate.CustomerReference,
    candidate.customerReference,
  ].some((reference) => normalizeRef(reference) === targetOrderNumber)) ?? null;
  if (!shipment) return null;
  const fromAddress = shipment.FromAddress ?? shipment.fromAddress ?? shipment.from_address
    ?? shipment.WarehouseAddress ?? shipment.warehouseAddress ?? shipment.warehouse_address ?? {};
  let carrierId = shipment.CarrierID ?? shipment.carrierId ?? shipment.carrier_id;
  const carrierName = shipment.CarrierName ?? shipment.carrierName ?? shipment.carrier_name;
  if (!carrierId && carrierName) {
    const syncedCarriers = await prisma.carrier.findMany({ where: { shop } });
    carrierId = syncedCarriers.find(
      (carrier) => carrier.name.trim().toLowerCase() === String(carrierName).trim().toLowerCase(),
    )?.shippyproCarrierId;
  }
  return {
    ...shipment,
    CarrierID: carrierId,
    CarrierName: carrierName,
    Service: shipment.CarrierService ?? shipment.Service ?? shipment.service,
    warehouseAddress: {
      name: fromAddress.Name ?? fromAddress.name ?? shipment.WarehouseName ?? shipment.warehouseName ?? "",
      company: fromAddress.Company ?? fromAddress.company ?? "",
      address1: fromAddress.Address1 ?? fromAddress.address1 ?? fromAddress.street1 ?? shipment.warehouseAddress1 ?? shipment.warehouse_address1 ?? "",
      address2: fromAddress.Address2 ?? fromAddress.address2 ?? fromAddress.street2 ?? shipment.warehouseAddress2 ?? shipment.warehouse_address2 ?? "",
      city: fromAddress.City ?? fromAddress.city ?? shipment.warehouseCity ?? shipment.warehouse_city ?? "",
      zip: fromAddress.ZIP ?? fromAddress.Zip ?? fromAddress.zip ?? shipment.warehouseZip ?? shipment.warehouse_zip ?? "",
      country: fromAddress.Country ?? fromAddress.country ?? shipment.warehouseCountry ?? shipment.warehouse_country ?? shipment.warehouseCountryCode ?? "",
    },
    // The original recipient becomes the sender of the return.
    customerAddress: readAddress(shipment.ToAddress ?? shipment.toAddress ?? shipment.to_address),
    parcels: readParcels(shipment),
    warehouseCountry: shipment.warehouseCountry || shipment.warehouse_country || shipment.warehouseCountryCode || null,
    warehouseCity: shipment.warehouseCity || shipment.warehouse_city || null,
  };
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
            name address1 address2 city zip country countryCodeV2 province provinceCode phone
          }
          email
        }
      }`,
      { variables: { id } },
    );
    const json = await response.json();
    const address = json?.data?.order?.shippingAddress;
    return address
      ? { ...address, country: address.countryCodeV2 || address.country, state: address.provinceCode || address.province }
      : null;
  } catch {
    return null;
  }
}

async function fetchOrderLineItemValues(shop: string, shopifyOrderId: string): Promise<{ values: Map<string, number>; currencyCode: string | null }> {
  const values = new Map<string, number>();
  try {
    const { admin } = await unauthenticated.admin(shop);
    const id = shopifyOrderId.startsWith("gid://") ? shopifyOrderId : `gid://shopify/Order/${shopifyOrderId}`;
    const response = await admin.graphql(
      `#graphql
      query getReturnItemValues($id: ID!) {
        order(id: $id) {
          currencyCode
          lineItems(first: 250) {
            edges {
              node {
                id
                discountedUnitPriceSet { shopMoney { amount } }
              }
            }
          }
        }
      }`,
      { variables: { id } },
    );
    const order = (await response.json())?.data?.order;
    const lines = order?.lineItems?.edges ?? [];
    for (const edge of lines) {
      const lineId = edge.node?.id;
      const amount = Number(edge.node?.discountedUnitPriceSet?.shopMoney?.amount);
      if (lineId && Number.isFinite(amount)) values.set(lineId, amount);
    }
    return { values, currencyCode: order?.currencyCode ?? lines[0]?.node?.discountedUnitPriceSet?.shopMoney?.currencyCode ?? null };
  } catch {
    return { values, currencyCode: null };
  }
}

export async function fetchWarehouseAddress(shop: string, locationId: string | null): Promise<Record<string, string> | null> {
  if (!locationId) return null;
  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
      query returnWarehouseAddress($id: ID!) {
        location(id: $id) {
          name
          address {
            address1 address2 city zip country countryCode province provinceCode phone
          }
        }
      }`,
      { variables: { id: locationId } },
    );
    const location = (await response.json())?.data?.location;
    if (!location?.address) return null;
    return {
      name: location.name || "Warehouse",
      ...location.address,
      country: location.address.countryCode || location.address.country,
      state: location.address.provinceCode || location.address.province,
    };
  } catch {
    return null;
  }
}

async function fetchVariantCustoms(shop: string, variantIds: string[]) {
  if (variantIds.length === 0) return new Map<string, { harmonizedSystemCode?: string; countryCodeOfOrigin?: string }>();
  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
      query returnVariantCustoms($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            inventoryItem {
              harmonizedSystemCode
              countryCodeOfOrigin
            }
          }
        }
      }`,
      { variables: { ids: variantIds } },
    );
    const nodes = (await response.json())?.data?.nodes ?? [];
    return new Map(nodes.filter(Boolean).map((node: any) => [node.id, node.inventoryItem || {}]));
  } catch {
    return new Map();
  }
}

async function notifyLabelFailure(shop: string, orderNumber: string | null, error: string) {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(`#graphql
      query LabelFailureRecipient {
        shop {
          email
        }
      }
    `);
    const owner = process.env.SHIPPYPRO_FAILURE_EMAIL || (await response.json())?.data?.shop?.email;
    if (!owner) return;
    const recipient = emailRecipientFor(shop, owner);
    const settings = await getOrCreateSettings(shop);
    await sendEmail(
      recipient,
      `Return label generation failed${orderNumber ? ` for ${orderNumber}` : ""}`,
      `ShippyPro could not generate a return label for ${orderNumber || "a return request"}.\n\nError: ${error}`,
      settings.emailFrom || undefined,
    );
  } catch (e) {
    console.error("[ShippyPro] Admin failure notification could not be sent:", e);
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
    // A market entry may hold only a fallback parcel; then use the Default carrier.
    const def = [defaults[key], defaults["DEFAULT"]].find((d) => d?.carrierId);
    carrierId = def?.carrierId ?? null;
    service = def?.service ?? null;
  }
  return { carrierId, service, flagged, reason };
}

// ---- Label lifecycle (one label per request) ------------------------------
// Statuses are described in ./label-status. Nothing here retries Ship
// automatically; every new attempt is an explicit action.
export { RETRYABLE_LABEL_STATUSES } from "./label-status";

export type CreateLabelResult = { ok: boolean; error?: string };

function blockedLabelMessage(status: string, orderNumber: string | null): string {
  const ref = orderNumber ? ` (order ${orderNumber})` : "";
  switch (status) {
    case "sending":
      return `A shipping label is already being created for this request${ref}.`;
    case "unknown":
      return `The last label request to ShippyPro${ref} has an unknown result, so a shipment may already exist. Check ShippyPro, then confirm "No shipment was created" before trying again.`;
    case "needs_review":
      return `ShippyPro created a shipment${ref} but returned no label file. Void it before creating a new label.`;
    default:
      return `A shipping label already exists for this request${ref}. Void it before creating a new one.`;
  }
}

/** Takes the per-request label lock. Only one caller can win. */
async function claimLabelSlot(returnRequestId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await prisma.returnLabel.findUnique({ where: { returnRequestId } });
  if (!existing) {
    try {
      await prisma.returnLabel.create({ data: { returnRequestId, status: "sending" } });
      return { ok: true };
    } catch {
      // Another request created the row first.
      return { ok: false, error: blockedLabelMessage("sending", null) };
    }
  }
  const claimed = await prisma.returnLabel.updateMany({
    where: { id: existing.id, status: { in: RETRYABLE_LABEL_STATUSES } },
    data: { status: "sending", shippyproOrderId: null, labelUrl: null, trackingNumber: null, trackingUrl: null },
  });
  if (claimed.count === 1) return { ok: true };
  const current = await prisma.returnLabel.findUnique({ where: { returnRequestId } });
  return { ok: false, error: blockedLabelMessage(current?.status ?? existing.status, null) };
}

type LabelRouting = { carrierId: string | null; service: string | null; flagged: boolean };
type ReturnRequestForLabel = NonNullable<Awaited<ReturnType<typeof loadRequestForLabel>>>;

function loadRequestForLabel(returnRequestId: string) {
  return prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    include: { items: true, label: true },
  });
}

export type ReturnShipmentDraft = {
  ok: true;
  params: Record<string, any>;
  customs: unknown[];
  routing: LabelRouting;
  carrierRecordId: string | null;
  // Fields that are empty but may be required by some carriers.
  warnings: string[];
};
export type ReturnShipmentProblem = {
  ok: false;
  error: string;
  routing: LabelRouting | null;
  carrierRecordId: string | null;
};

const REQUIRED_ADDRESS_FIELDS: [string, string][] = [
  ["name", "name"],
  ["street1", "street address"],
  ["city", "city"],
  ["zip", "postal code"],
  ["country", "country"],
];

/** Lists missing mandatory fields (errors) and empty optional-but-risky fields (warnings). */
export function validateReturnShipment(params: Record<string, any>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sides: [string, string][] = [["from_address", "Customer (pickup)"], ["to_address", "Return warehouse"]];
  for (const [key, label] of sides) {
    const address = params[key] ?? {};
    for (const [field, fieldLabel] of REQUIRED_ADDRESS_FIELDS) {
      if (!String(address[field] ?? "").trim()) errors.push(`${label} ${fieldLabel} is missing`);
    }
    if (!String(address.phone ?? "").trim()) warnings.push(`${label} phone is empty (some carriers require it)`);
  }
  if (!params.CarrierID) errors.push("Carrier is missing");
  const parcels = Array.isArray(params.parcels) ? params.parcels : [];
  if (parcels.length === 0 || parcels.some((p: any) => !(Number(p.weight) > 0))) errors.push("Parcel weight is missing");
  return { errors, warnings };
}

/**
 * Builds the ShippyPro Ship parameters for a return without calling Ship.
 * Used for the label itself and for the admin preview.
 */
export async function buildReturnShipment(rr: ReturnRequestForLabel): Promise<ReturnShipmentDraft | ReturnShipmentProblem> {
  let routing: LabelRouting | null = null;
  let carrierRecordId: string | null = null;
  try {
    const settings = await getOrCreateSettings(rr.shop);
    const original = await findOriginalShipment(
      rr.shop,
      rr.orderNumber,
      rr.submittedAt,
      Math.max(settings.returnDeadlineDays, settings.exchangeDeadlineDays) + 60,
    );
    routing = routingDecision(original, settings, rr.market);
    if (!routing.carrierId) throw new Error("No carrier available for routing");

    const carrier = await prisma.carrier.findUnique({
      where: { shop_shippyproCarrierId: { shop: rr.shop, shippyproCarrierId: routing.carrierId } },
    });
    carrierRecordId = carrier?.id ?? null;
    const carrierName = carrier?.name || original?.CarrierName || original?.carrierName;
    const carrierId = Number(routing.carrierId);
    if (!Number.isInteger(carrierId) || !carrierName) {
      throw new Error("Sync the selected ShippyPro carrier before generating a return label.");
    }

    const warehouseMap = parseJson<Record<string, Record<string, string>>>(settings.warehouseAddressesPerMarket, {});
    const marketKey = (rr.market || "DEFAULT").toUpperCase();
    let warehouse: Record<string, string>;
    if (original) {
      warehouse = original.warehouseAddress;
      if (!warehouse.address1 || !warehouse.country) {
        throw new Error("Original shipment warehouse address unavailable; label not created to avoid routing to the wrong warehouse");
      }
    } else {
      // No original shipment: the return address configured in Settings wins,
      // the Shopify fulfillment location is only a last resort.
      const configured = [warehouseMap[marketKey], warehouseMap["DEFAULT"]].find((a) => a?.address1);
      warehouse = configured
        || await fetchWarehouseAddress(rr.shop, rr.fulfillmentLocationId)
        || { country: "", city: "" };
    }

    const orderAddress = await fetchOrderShippingAddress(rr.shop, rr.shopifyOrderId || "");
    // Sender = the original shipment's recipient, gaps filled from the Shopify order.
    const originalRecipient: Record<string, string> = original?.customerAddress ?? {};
    const useOriginalRecipient = Boolean(originalRecipient.address1 && originalRecipient.zip && originalRecipient.country);
    const shippingAddress: Record<string, string> | null = useOriginalRecipient
      ? Object.fromEntries(
          ["name", "address1", "address2", "city", "state", "zip", "country", "phone"].map((k) => [k, originalRecipient[k] || orderAddress?.[k] || ""]),
        )
      : orderAddress;

    // Parcel = the original shipment's parcels; else the market's fallback parcel.
    const methods = parseJson<Record<string, { parcel?: Parcel }>>(settings.defaultReturnMethodPerMarket, {});
    let parcels: Parcel[] = original?.parcels ?? [];
    if (parcels.length === 0) {
      routing.flagged = true;
      const fallback = methods[marketKey]?.parcel || methods["DEFAULT"]?.parcel;
      parcels = fallback ? [fallback] : [{ weight: 1, length: 10, width: 10, height: 10 }];
    }
    const { values: itemValues, currencyCode } = await fetchOrderLineItemValues(rr.shop, rr.shopifyOrderId || "");
    const isSweden = ["SE", "SWEDEN"].includes(String(warehouse.country || "").toUpperCase());
    const variantCustoms = isSweden
      ? await fetchVariantCustoms(rr.shop, [...new Set(rr.items.map((item) => item.variantId).filter(Boolean) as string[])])
      : new Map();

    const customsItems = rr.items.map((it) => {
      const unitValue = itemValues.get(it.shopifyLineItemId || "");
      if (unitValue === undefined) throw new Error(`Original value unavailable for ${it.title || "returned item"}`);
      const itemCustoms = it.variantId ? variantCustoms.get(it.variantId) : null;
      return {
        Description: it.title || "Returned item",
        Quantity: it.returnedQuantity || it.quantity,
        Value: unitValue.toFixed(2),
        OriginCountry: itemCustoms?.countryCodeOfOrigin?.trim() || "",
        HSCode: itemCustoms?.harmonizedSystemCode?.trim() || "",
      };
    });
    if (isSweden && customsItems.some((item) => !item.HSCode || !item.OriginCountry)) {
      routing.flagged = true;
      throw new Error("Sweden return customs requires an HS code and country of origin for every item");
    }
    if (isSweden && !currencyCode) {
      throw new Error("Order currency is unavailable for the customs declaration.");
    }

    const params = {
      CarrierID: carrierId,
      CarrierName: carrierName,
      CarrierService: routing.service || carrier?.service || undefined,
      IsReturn: true,
      TransactionID: rr.orderNumber || rr.shopifyOrderId,
      Async: false,
      ContentDescription: rr.items.map((item) => item.title || "Returned item").join(", "),
      to_address: {
        name: (warehouse["name"] as string) || "Warehouse",
        company: warehouse["company"] || "",
        street1: warehouse["address1"] || warehouse["address"] || "",
        street2: warehouse["address2"] || "",
        city: warehouse["city"] || "",
        state: warehouse["state"] || warehouse["province"] || "",
        zip: warehouse["zip"] || "",
        country: warehouse["country"] || "",
        phone: warehouse["phone"] || "",
        email: "",
      },
      from_address: {
        name: shippingAddress?.name || rr.customerName || "Customer",
        company: "",
        street1: shippingAddress?.address1 || "",
        street2: shippingAddress?.address2 || "",
        city: shippingAddress?.city || "",
        state: shippingAddress?.state || "",
        zip: shippingAddress?.zip || "",
        country: shippingAddress?.country || "",
        phone: shippingAddress?.phone || "",
        email: rr.customerEmail || "",
      },
      parcels,
      ...(isSweden ? {
        CN22Info: customsItems.map((item) => ({
          Description: item.Description,
          Weight: 1,
          Quantity: item.Quantity,
          UnitValue: Number(item.Value),
          OriginCountry: item.OriginCountry,
          Currency: currencyCode,
          HSCode: item.HSCode,
        })),
      } : {}),
    };

    const { errors, warnings } = validateReturnShipment(params);
    if (errors.length > 0) {
      throw new Error(`Shipment details incomplete: ${errors.join("; ")}`);
    }
    return { ok: true, params, customs: customsItems, routing, carrierRecordId, warnings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error", routing, carrierRecordId };
  }
}

/** Admin preview of what would be sent to ShippyPro. Never calls Ship. */
export async function previewReturnShipment(returnRequestId: string) {
  const rr = await loadRequestForLabel(returnRequestId);
  if (!rr) return { ok: false as const, error: "Return request not found" };
  const draft = await buildReturnShipment(rr);
  if (!draft.ok) return { ok: false as const, error: draft.error };
  const { params, warnings } = draft;
  return {
    ok: true as const,
    warnings,
    carrier: [params.CarrierName, params.CarrierService].filter(Boolean).join(" · "),
    reference: String(params.TransactionID ?? ""),
    from: params.from_address as Record<string, string>,
    to: params.to_address as Record<string, string>,
    parcels: params.parcels as { weight: number; length: number; width: number; height: number }[],
  };
}

export async function createReturnLabel(returnRequestId: string): Promise<CreateLabelResult> {
  const rr = await loadRequestForLabel(returnRequestId);
  if (!rr) return { ok: false, error: "Return request not found" };

  const blocked = liveLabelBlockedReason(rr.shop);
  if (blocked) return { ok: false, error: blocked };

  const claim = await claimLabelSlot(rr.id);
  if (!claim.ok) {
    const current = await prisma.returnLabel.findUnique({ where: { returnRequestId: rr.id } });
    return { ok: false, error: current ? blockedLabelMessage(current.status, rr.orderNumber) : claim.error };
  }

  let routing: LabelRouting | null = null;
  let carrierRecordId: string | null = null;
  const finish = async (status: string, error: string): Promise<CreateLabelResult> => {
    console.error(`[ShippyPro] Label ${status} for request ${rr.id}: ${error}`);
    await prisma.returnLabel.update({
      where: { returnRequestId: rr.id },
      data: {
        status,
        carrierId: carrierRecordId,
        connectionId: routing?.carrierId ?? null,
        service: routing?.service ?? null,
      },
    }).catch(() => null);
    if (routing?.flagged) {
      await prisma.returnRequest.update({ where: { id: rr.id }, data: { reviewFlagged: true } }).catch(() => null);
    }
    await notifyLabelFailure(rr.shop, rr.orderNumber, error);
    return { ok: false, error };
  };

  // 1. Build and validate the shipment. Nothing has been sent yet.
  const draft = await buildReturnShipment(rr);
  routing = draft.routing;
  carrierRecordId = draft.carrierRecordId;
  if (!draft.ok) return finish("failed", draft.error);
  const { params, customs } = draft;

  // 2. Send exactly one Ship call.
  const shipResult = await shippyproCall("Ship", params, rr.shop);
  if (!shipResult.ok) {
    const reason = shipResult.error || "Ship call failed";
    return finish(
      shipResult.uncertain ? "unknown" : "failed",
      shipResult.uncertain ? `No usable reply from ShippyPro (${reason}); a shipment may exist.` : `ShippyPro refused the shipment: ${reason}`,
    );
  }

  // 3. Save what ShippyPro returned. From here on a shipment exists.
  try {
    const data = shipResult.data?.result || shipResult.data;
    const shippyproOrderId = data?.NewOrderID ? String(data.NewOrderID) : null;
    const labelUrl = firstLabelUrl(data);
    const trackingNumber = data?.TrackingNumber || data?.tracking_number;
    const trackingUrl = data?.TrackingExternalLink || data?.TrackingURL || data?.tracking_url;

    await prisma.returnLabel.update({
      where: { returnRequestId: rr.id },
      data: {
        carrierId: carrierRecordId,
        connectionId: routing!.carrierId,
        shippyproOrderId,
        service: routing!.service ?? null,
        labelUrl: labelUrl ?? null,
        trackingNumber: trackingNumber ?? null,
        trackingUrl: trackingUrl ?? null,
        // No label and no shipment id: we cannot tell whether a shipment exists.
        status: labelUrl ? "created" : shippyproOrderId ? "needs_review" : "unknown",
        customsData: JSON.stringify(customs),
      },
    });
    if (routing!.flagged) {
      await prisma.returnRequest.update({ where: { id: rr.id }, data: { reviewFlagged: true } });
    }
    if (!labelUrl) {
      // Keep ShippyPro's reply so the missing label can be diagnosed (shown under Tracking Events).
      console.error(`[ShippyPro] Ship returned no label URL for request ${rr.id}. Response fields: ${Object.keys(data ?? {}).join(", ")}`);
      await recordShipResponse(rr.id, data);
      await notifyLabelFailure(rr.shop, rr.orderNumber, "ShippyPro's reply contained no label URL");
      return {
        ok: false,
        error: `ShippyPro replied without a label link${shippyproOrderId ? ` (shipment ${shippyproOrderId})` : " or shipment ID"}. ShippyPro's reply: ${summarizeReply(data)}`,
      };
    }
    return { ok: true };
  } catch (e) {
    // The shipment exists but we could not record it.
    return finish("unknown", `Shipment created but not saved: ${e instanceof Error ? e.message : "Unknown error"}`);
  }
}

/**
 * Label link from a Ship response. Every candidate field is checked: ShippyPro
 * can send `PDF` as an empty list while the link is in `LabelURL`.
 */
export function firstLabelUrl(data: any): string | null {
  const candidates = [data?.PDF, data?.LabelURL, data?.LabelUrl, data?.label_url, data?.label, data?.Label];
  for (const value of candidates.flat()) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Short, readable version of a ShippyPro reply for admin error messages. */
export function summarizeReply(data: any): string {
  const text = JSON.stringify(data ?? null);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

async function recordShipResponse(returnRequestId: string, data: any) {
  try {
    const label = await prisma.returnLabel.findUnique({ where: { returnRequestId } });
    await prisma.trackingEvent.create({
      data: {
        returnLabelId: label?.id ?? null,
        returnRequestId,
        status: "label_missing",
        message: `ShippyPro reply had no label link. Fields received: ${Object.keys(data ?? {}).join(", ") || "none"}`,
        raw: JSON.stringify(data ?? null).slice(0, 20_000),
      },
    });
  } catch (e) {
    console.error("[ShippyPro] Could not record the Ship response:", e);
  }
}

/**
 * Admin confirms (after checking ShippyPro) that an `unknown` or stuck
 * `sending` attempt did not create a shipment, which unlocks a new attempt.
 */
export async function confirmNoShipment(returnRequestId: string): Promise<{ ok: boolean; error?: string }> {
  const result = await prisma.returnLabel.updateMany({
    where: {
      returnRequestId,
      OR: [
        { status: { in: ["unknown", "sending"] } },
        // Older attempts were marked needs_review even without a shipment id.
        { status: "needs_review", shippyproOrderId: null },
      ],
    },
    data: { status: "failed" },
  });
  return result.count === 1 ? { ok: true } : { ok: false, error: "There is no unconfirmed label attempt for this request." };
}

export async function voidReturnLabel(returnRequestId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const rr = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: { label: true },
    });
    if (!rr) return { ok: false, error: "Return request not found" };
    if (!rr.label) return { ok: false, error: "No shipping label exists for this request" };

    const shippyproOrderId = Number(rr.label.shippyproOrderId);
    if (!Number.isSafeInteger(shippyproOrderId) || shippyproOrderId <= 0) {
      return { ok: false, error: "ShippyPro order ID is unavailable for this label. Regenerate the label before voiding it." };
    }

    const carrier = rr.label.connectionId
      ? await prisma.carrier.findFirst({ where: { shop: rr.shop, shippyproCarrierId: rr.label.connectionId } })
      : rr.label.carrierId
        ? await prisma.carrier.findFirst({ where: { shop: rr.shop, id: rr.label.carrierId } })
        : null;
    if (!carrier) return { ok: false, error: "The selected carrier is unavailable. Sync carriers and regenerate the label before voiding it." };

    const result = await shippyproCall("VoidShipments", {
      OrderIDS: [shippyproOrderId],
      CarrierName: carrier.name,
    }, rr.shop);
    if (!result.ok) return { ok: false, error: result.error || "ShippyPro could not void this label" };

    const response = result.data?.result || result.data;
    const responseStatus = response?.Result;
    if (responseStatus && String(responseStatus).toUpperCase() !== "OK") {
      return { ok: false, error: String(responseStatus) };
    }

    await prisma.returnLabel.update({ where: { id: rr.label.id }, data: { status: "voided" } });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to void shipping label" };
  }
}


export async function requestPickup(
  returnRequestId: string,
  preferredDate: Date,
  timeWindow: string,
  address: Record<string, unknown>,
): Promise<{ ok: boolean; status: string; error?: string }> {
  const rr = await prisma.returnRequest.findUnique({ where: { id: returnRequestId } });
  if (!rr) return { ok: false, status: "failed", error: "Request not found" };

  // ShippyPro pickup booking APIs vary by carrier and are not verified here.
  // The request is recorded and flagged for manual/admin booking.
  await prisma.returnPickup.create({
    data: {
      returnRequestId,
      status: "needs_manual_booking",
      preferredDate,
      timeWindow,
      address: JSON.stringify(address),
      errorMessage: "Pickup booking not automated; admin must book manually",
    },
  });
  await prisma.returnRequest.update({ where: { id: returnRequestId }, data: { reviewFlagged: true } });
  return { ok: true, status: "needs_manual_booking" };
}


/** Placeholder shown in the settings form instead of the saved key. */
export const SHIPPYPRO_KEY_MASK_PREFIX = "••••••••••••";

export function maskShippyproKey(hint: string | null | undefined): string {
  return `${SHIPPYPRO_KEY_MASK_PREFIX}${hint || ""}`;
}

/**
 * Saves the connection from the settings form. An empty or still-masked key
 * field keeps the saved key, so changing only the URL never erases it.
 */
export async function saveShippyproConnection(shop: string, submittedKey: string, submittedUrl: string | null): Promise<void> {
  const key = submittedKey.trim();
  // The form pre-fills the default endpoint; storing it would override SHIPPYPRO_API_URL.
  const cleanUrl = submittedUrl?.trim().replace(/\/+$/, "") || null;
  const apiUrl = cleanUrl === DEFAULT_SHIPPYPRO_URL ? null : cleanUrl;
  if (!key || key.startsWith(SHIPPYPRO_KEY_MASK_PREFIX)) {
    await prisma.settings.upsert({
      where: { shop },
      create: { shop, shippyproApiUrl: apiUrl },
      update: { shippyproApiUrl: apiUrl },
    });
    return;
  }
  await setShippyproApiKey(shop, key, apiUrl);
}

export async function setShippyproApiKey(shop: string, apiKey: string, apiUrl?: string | null): Promise<void> {
  const trimmed = apiKey.trim();
  const hint = trimmed.length >= 4 ? trimmed.slice(-4) : (trimmed || null);
  const encrypted = trimmed ? encryptSecret(trimmed) : null;
  await prisma.settings.upsert({
    where: { shop },
    create: {
      shop,
      shippyproApiKeyEncrypted: encrypted,
      shippyproApiKeyHint: hint,
      shippyproApiUrl: apiUrl || null,
    },
    update: {
      shippyproApiKeyEncrypted: encrypted,
      shippyproApiKeyHint: hint,
      shippyproApiUrl: apiUrl === undefined ? undefined : (apiUrl || null),
    },
  });
}

export async function getShippyproConnection(shop: string): Promise<{ hasKey: boolean; hint: string | null; apiUrl: string | null }> {
  const settings = await getOrCreateSettings(shop);
  return {
    hasKey: Boolean(settings.shippyproApiKeyEncrypted),
    hint: settings.shippyproApiKeyHint ?? null,
    apiUrl: settings.shippyproApiUrl ?? null,
  };
}
