import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getEffectiveDeadline, isExpired, isItemExcluded } from "./validation.server";
import { getOrCreateSettings } from "./settings.server";
import { listReturnReasons } from "./return-reasons.server";

export type PortalErrorCode =
  | "SHOP_REQUIRED"
  | "RATE_LIMITED"
  | "ORDER_NOT_FOUND"
  | "EMAIL_MISMATCH"
  | "NOT_FULFILLED"
  | "DEADLINE_EXPIRED"
  | "ALL_ITEMS_EXCLUDED_OR_RETURNED"
  | "ALREADY_REQUESTED"
  | "INVALID_INPUT";

export type PortalLineItem = {
  id: string;
  title: string;
  // Quantity that can still be requested: fulfilled quantity minus quantities
  // already in non-rejected requests. `purchasedQuantity` is the original.
  quantity: number;
  purchasedQuantity: number;
  variantId: string | null;
  productId: string | null;
  collectionIds: string[];
  excluded: boolean;
  variantPrice?: string | null;
  variantImage?: { url: string; altText: string | null } | null;
};

export type PortalOrderResult = {
  ok: true;
  shop: string;
  order: {
    id: string;
    name: string;
    email: string | null;
    customerName: string | null;
    createdAt: string;
    fulfillmentStatus: string | null;
    lineItems: PortalLineItem[];
    market?: string | null;
    fulfillmentLocationId?: string | null;
  };
  eligibleLineItemIds: string[];
  deadline: string;
  requestType: "return" | "exchange" | "complaint";
  reasons: { id: string; labelEn: string; parentLabel?: string; appliesTo: string }[];
};

export type PortalError = { ok: false; code: PortalErrorCode; message: string };

// Very small in-memory rate limiter for lookup attempts.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 5 * 60 * 1000;

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

function normalizeOrderNumber(input: string): string {
  return input.trim().replace(/^#/, "");
}

function getOrderCustomerName(
  customer: { firstName?: string | null; lastName?: string | null } | null | undefined,
  shippingName?: string | null,
) {
  return [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || shippingName || null;
}

// Requests in these statuses no longer hold their quantities.
const RELEASED_STATUSES = ["Rejected", "Cancelled"];

/** Quantity per line item already in open (not rejected) requests for this order. */
async function requestedQuantities(shop: string, orderId: string): Promise<Map<string, number>> {
  const numericId = orderId.split("/").pop() || orderId;
  const requests = await prisma.returnRequest.findMany({
    where: { shop, shopifyOrderId: { in: [numericId, orderId] }, status: { notIn: RELEASED_STATUSES } },
    include: { items: true },
  });
  const totals = new Map<string, number>();
  for (const r of requests) {
    for (const it of r.items) {
      if (!it.shopifyLineItemId) continue;
      totals.set(it.shopifyLineItemId, (totals.get(it.shopifyLineItemId) ?? 0) + (it.quantity || 0));
    }
  }
  return totals;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLineItems(node: any, requested: Map<string, number>): PortalLineItem[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (node.lineItems?.edges ?? []).map((e: any) => {
    const n = e.node;
    const purchased = Number(n.quantity) || 0;
    // Removed/refunded units drop out of currentQuantity; unfulfilled units were never shipped.
    const shipped = (Number.isFinite(n.currentQuantity) ? n.currentQuantity : purchased)
      - (Number.isFinite(n.unfulfilledQuantity) ? n.unfulfilledQuantity : 0);
    const remaining = Math.max(0, shipped - (requested.get(n.id) ?? 0));
    return {
      id: n.id,
      title: n.title,
      quantity: remaining,
      purchasedQuantity: purchased,
      variantId: n.variant?.id ?? null,
      productId: n.variant?.product?.id ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      collectionIds: (n.variant?.product?.collections?.edges ?? []).map((c: any) => c.node.id),
      excluded: remaining === 0,
      variantPrice: n.variant?.price ?? null,
      variantImage: n.variant?.image ? { url: n.variant.image.url, altText: n.variant.image.altText } : null,
    };
  });
}

const ORDER_QUERY = `#graphql
  query portalOrderLookup($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          name
          email
          customer { firstName lastName }
          createdAt
          displayFulfillmentStatus
          shippingAddress { name countryCodeV2 }
          fulfillmentOrders(first: 10) {
            edges {
              node {
                assignedLocation { location { id } }
              }
            }
          }
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                quantity
                currentQuantity
                unfulfilledQuantity
                variant {
                  id
                  price
                  image { id url altText }
                  product {
                    id
                    collections(first: 20) {
                      edges { node { id } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function lookupAndValidateOrder(
  shop: string,
  orderNumberInput: string,
  emailInput: string,
  requestType: "return" | "exchange" | "complaint" = "return",
): Promise<PortalOrderResult | PortalError> {
  const orderNumber = normalizeOrderNumber(orderNumberInput);
  const email = emailInput.trim().toLowerCase();
  if (!shop || !orderNumber || !email) {
    return { ok: false, code: "INVALID_INPUT", message: "Shop, order number and email are required." };
  }

  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch {
    return { ok: false, code: "SHOP_REQUIRED", message: "This shop is not available." };
  }

  const q = `name:#${orderNumber}`;
  const response = await admin.graphql(ORDER_QUERY, { variables: { query: q } });
  const json = await response.json();
  const node = json?.data?.orders?.edges?.[0]?.node;

  if (!node) {
    return { ok: false, code: "ORDER_NOT_FOUND", message: "Order not found." };
  }

  if (!node.email || node.email.toLowerCase() !== email) {
    return { ok: false, code: "EMAIL_MISMATCH", message: "Email does not match the order." };
  }

  return validateOrderNode(shop, node, requestType);
}

/**
 * Shared checks after an order has been fetched and its owner confirmed:
 * fulfillment, exclusions / already returned, and the deadline for `requestType`.
 * Used by the guest lookup and the logged-in storefront path.
 */
async function validateOrderNode(
  shop: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  requestType: "return" | "exchange" | "complaint",
): Promise<PortalOrderResult | PortalError> {
  const fulfillmentStatus = node.displayFulfillmentStatus;
  const fulfilled = ["FULFILLED", "IN_PROGRESS", "PARTIALLY_FULFILLED"].includes(fulfillmentStatus);
  if (!fulfilled) {
    return { ok: false, code: "NOT_FULFILLED", message: "Order has not been fulfilled yet." };
  }

  const lineItems = mapLineItems(node, await requestedQuantities(shop, String(node.id)));
  const shopifyOrderId = String(node.id).split("/").pop() || node.id;

  // Apply exclusion + already-returned flags.
  let eligibleCount = 0;
  const eligibleLineItemIds: string[] = [];
  for (const item of lineItems) {
    const excluded = await isItemExcluded(shop, {
      productId: item.productId ?? undefined,
      variantId: item.variantId ?? undefined,
      collectionIds: item.collectionIds,
    }, requestType);
    item.excluded = excluded || item.quantity === 0;
    if (!item.excluded) {
      eligibleCount += 1;
      eligibleLineItemIds.push(item.id);
    }
  }

  if (eligibleCount === 0) {
    return { ok: false, code: "ALL_ITEMS_EXCLUDED_OR_RETURNED", message: "All items are excluded or already returned." };
  }

  const deadline = await getEffectiveDeadline(shop, shopifyOrderId, requestType, new Date(node.createdAt));
  if (isExpired(deadline)) {
    return { ok: false, code: "DEADLINE_EXPIRED", message: "Request deadline has expired." };
  }

  const fulfillmentLocationId = node.fulfillmentOrders?.edges?.[0]?.node?.assignedLocation?.location?.id ?? null;

  // ensure settings exist for shop (side effect ok)
  await getOrCreateSettings(shop);
  const reasons = await listReturnReasons(shop, true);

  return {
    ok: true,
    shop,
    order: {
      id: node.id,
      name: node.name,
      email: node.email,
      customerName: getOrderCustomerName(node.customer, node.shippingAddress?.name),
      createdAt: node.createdAt,
      fulfillmentStatus,
      lineItems,
      market: node.shippingAddress?.countryCodeV2 ?? null,
      fulfillmentLocationId,
    },
    eligibleLineItemIds,
    deadline: deadline.toISOString(),
    requestType,
    reasons,
  };
}

const CUSTOMER_ORDERS_QUERY = `#graphql
  query proxyCustomerOrders($customerId: ID!) {
    customer(id: $customerId) {
      id
      orders(first: 20, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          createdAt
          displayFulfillmentStatus
          cancelledAt
        }
      }
    }
  }
`;

const ORDER_BY_ID_QUERY = `#graphql
  query proxyOrderById($id: ID!) {
    order(id: $id) {
      id
      name
      email
      customer { id firstName lastName }
      createdAt
      displayFulfillmentStatus
      shippingAddress { name countryCodeV2 }
      lineItems(first: 50) {
        edges {
          node {
            id
            title
            quantity
            currentQuantity
            unfulfilledQuantity
            variant {
              id
              price
              image { id url altText }
              product {
                id
                collections(first: 20) { edges { node { id } } }
              }
            }
          }
        }
      }
    }
  }
`;

export type CustomerOrderSummary = {
  id: string;
  name: string;
  createdAt: string;
  fulfillmentStatus: string | null;
};

const ORDER_GID = /^gid:\/\/shopify\/Order\/\d+$/;
const NUMERIC_ID = /^\d+$/;

function customerGid(customerId: string): string | null {
  return NUMERIC_ID.test(customerId) ? `gid://shopify/Customer/${customerId}` : null;
}

/**
 * Recent, non-cancelled orders for a logged-in storefront customer.
 * `customerId` must come from the signed app-proxy `logged_in_customer_id`.
 */
export async function listCustomerOrders(shop: string, customerId: string): Promise<CustomerOrderSummary[]> {
  const gid = customerGid(customerId);
  if (!shop || !gid) return [];
  const { admin } = await unauthenticated.admin(shop);
  const response = await admin.graphql(CUSTOMER_ORDERS_QUERY, { variables: { customerId: gid } });
  const json = await response.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: any[] = json?.data?.customer?.orders?.nodes ?? [];
  return nodes
    .filter((n) => !n.cancelledAt)
    .map((n) => ({
      id: n.id,
      name: n.name,
      createdAt: n.createdAt,
      fulfillmentStatus: n.displayFulfillmentStatus ?? null,
    }));
}

/**
 * Logged-in equivalent of `lookupAndValidateOrder`: loads the order by id,
 * requires `order.customer.id` to match the signed `logged_in_customer_id`,
 * then runs the same fulfillment / exclusion / deadline checks.
 * A missing order and someone else's order both return ORDER_NOT_FOUND.
 */
export async function lookupOrderForCustomer(
  shop: string,
  orderId: string,
  customerId: string,
  requestType: "return" | "exchange" | "complaint",
): Promise<PortalOrderResult | PortalError> {
  const gid = customerGid(customerId);
  if (!gid) {
    return { ok: false, code: "ORDER_NOT_FOUND", message: "Order not found." };
  }

  const node = await fetchOrderNodeById(shop, orderId);
  if ("ok" in node) return node;
  if (node.customer?.id !== gid) {
    return { ok: false, code: "ORDER_NOT_FOUND", message: "Order not found." };
  }

  return validateOrderNode(shop, node, requestType);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchOrderNodeById(shop: string, orderId: string): Promise<any | PortalError> {
  if (!shop || !ORDER_GID.test(orderId)) {
    return { ok: false, code: "ORDER_NOT_FOUND", message: "Order not found." };
  }
  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch {
    return { ok: false, code: "SHOP_REQUIRED", message: "This shop is not available." };
  }
  const response = await admin.graphql(ORDER_BY_ID_QUERY, { variables: { id: orderId } });
  const json = await response.json();
  const node = json?.data?.order;
  if (!node) return { ok: false, code: "ORDER_NOT_FOUND", message: "Order not found." };
  return node;
}

/**
 * Re-runs the fulfillment / exclusion / deadline checks for an order whose
 * ownership was already proven (the caller holds a verified signed order token).
 * Used again at submit time so a stale page can't bypass the rules.
 */
export async function revalidateOrderById(
  shop: string,
  orderId: string,
  requestType: "return" | "exchange" | "complaint",
): Promise<PortalOrderResult | PortalError> {
  const node = await fetchOrderNodeById(shop, orderId);
  if ("ok" in node) return node;
  return validateOrderNode(shop, node, requestType);
}

/**
 * Basic validation: only checks order exists, email matches, and order is fulfilled.
 * Does NOT check exclusions, deadlines, or reasons (those depend on requestType).
 * Used for initial order lookup before request type is selected.
 */
export async function lookupAndValidateOrderBasic(
  shop: string,
  orderNumberInput: string,
  emailInput: string,
): Promise<PortalOrderResult | PortalError> {
  const orderNumber = normalizeOrderNumber(orderNumberInput);
  const email = emailInput.trim().toLowerCase();
  if (!shop || !orderNumber || !email) {
    return { ok: false, code: "INVALID_INPUT", message: "Shop, order number and email are required." };
  }

  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch {
    return { ok: false, code: "SHOP_REQUIRED", message: "This shop is not available." };
  }

  const q = `name:#${orderNumber}`;
  const response = await admin.graphql(ORDER_QUERY, { variables: { query: q } });
  const json = await response.json();
  const node = json?.data?.orders?.edges?.[0]?.node;

  if (!node) {
    return { ok: false, code: "ORDER_NOT_FOUND", message: "Order not found." };
  }

  if (!node.email || node.email.toLowerCase() !== email) {
    return { ok: false, code: "EMAIL_MISMATCH", message: "Email does not match the order." };
  }

  const fulfillmentStatus = node.displayFulfillmentStatus;
  const fulfilled = ["FULFILLED", "IN_PROGRESS", "PARTIALLY_FULFILLED"].includes(fulfillmentStatus);
  if (!fulfilled) {
    return { ok: false, code: "NOT_FULFILLED", message: "Order has not been fulfilled yet." };
  }

  const lineItems = mapLineItems(node, await requestedQuantities(shop, String(node.id)));
  if (lineItems.length > 0 && lineItems.every((li) => li.quantity === 0)) {
    return { ok: false, code: "ALREADY_REQUESTED", message: portalErrorCodeToMessage("ALREADY_REQUESTED") };
  }

  const allReasons = await listReturnReasons(shop, true);

  return {
    ok: true,
    shop,
    order: {
      id: node.id,
      name: node.name,
      email: node.email,
      customerName: getOrderCustomerName(node.customer, node.shippingAddress?.name),
      createdAt: node.createdAt,
      fulfillmentStatus,
      lineItems,
      market: node.shippingAddress?.countryCodeV2 ?? null,
    },
    eligibleLineItemIds: lineItems.filter((li) => li.quantity > 0).map((li) => li.id),
    deadline: new Date().toISOString(),
    requestType: "return",
    reasons: allReasons.map((r) => ({
      id: r.id,
      labelEn: r.labelEn,
      appliesTo: r.appliesTo,
    })),
  };
}

/**
 * Basic validation for logged-in customer: checks order exists, belongs to customer, and is fulfilled.
 * Does NOT check exclusions, deadlines, or reasons (those depend on requestType).
 */
export async function lookupOrderForCustomerBasic(
  shop: string,
  orderId: string,
  customerId: string,
): Promise<PortalOrderResult | PortalError> {
  const gid = customerGid(customerId);
  if (!gid) {
    return { ok: false, code: "ORDER_NOT_FOUND", message: "Order not found." };
  }

  const node = await fetchOrderNodeById(shop, orderId);
  if ("ok" in node) return node;
  if (node.customer?.id !== gid) {
    return { ok: false, code: "ORDER_NOT_FOUND", message: "Order not found." };
  }

  const fulfillmentStatus = node.displayFulfillmentStatus;
  const fulfilled = ["FULFILLED", "IN_PROGRESS", "PARTIALLY_FULFILLED"].includes(fulfillmentStatus);
  if (!fulfilled) {
    return { ok: false, code: "NOT_FULFILLED", message: "Order has not been fulfilled yet." };
  }

  const lineItems = mapLineItems(node, await requestedQuantities(shop, String(node.id)));
  if (lineItems.length > 0 && lineItems.every((li) => li.quantity === 0)) {
    return { ok: false, code: "ALREADY_REQUESTED", message: portalErrorCodeToMessage("ALREADY_REQUESTED") };
  }

  const allReasons = await listReturnReasons(shop, true);

  return {
    ok: true,
    shop,
    order: {
      id: node.id,
      name: node.name,
      email: node.email,
      customerName: getOrderCustomerName(node.customer, node.shippingAddress?.name),
      createdAt: node.createdAt,
      fulfillmentStatus,
      lineItems,
      market: node.shippingAddress?.countryCodeV2 ?? null,
    },
    eligibleLineItemIds: lineItems.filter((li) => li.quantity > 0).map((li) => li.id),
    deadline: new Date().toISOString(),
    requestType: "return",
    reasons: allReasons.map((r) => ({
      id: r.id,
      labelEn: r.labelEn,
      appliesTo: r.appliesTo,
    })),
  };
}

export function portalErrorCodeToMessage(code: PortalErrorCode): string {
  const messages: Record<PortalErrorCode, string> = {
    SHOP_REQUIRED: "Shop is required.",
    RATE_LIMITED: "Too many attempts. Please try again later.",
    ORDER_NOT_FOUND: "Order not found.",
    EMAIL_MISMATCH: "Email does not match the order.",
    NOT_FULFILLED: "Order has not been fulfilled yet.",
    DEADLINE_EXPIRED: "Return deadline has expired.",
    ALL_ITEMS_EXCLUDED_OR_RETURNED: "All items are excluded or already returned.",
    ALREADY_REQUESTED: "Every item in this order is already part of a return or exchange request.",
    INVALID_INPUT: "Please fill in all required fields.",
  };
  return messages[code];
}
