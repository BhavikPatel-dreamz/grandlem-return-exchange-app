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
  | "INVALID_INPUT";

export type PortalLineItem = {
  id: string;
  title: string;
  quantity: number;
  variantId: string | null;
  productId: string | null;
  collectionIds: string[];
  excluded: boolean;
};

export type PortalOrderResult = {
  ok: true;
  shop: string;
  order: {
    id: string;
    name: string;
    email: string | null;
    createdAt: string;
    fulfillmentStatus: string | null;
    lineItems: PortalLineItem[];
  };
  eligibleLineItemIds: string[];
  deadline: string;
  requestType: "return" | "exchange" | "complaint";
  reasons: { id: string; labelEn: string; labelSv: string; appliesTo: string }[];
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

const ORDER_QUERY = `#graphql
  query portalOrderLookup($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          name
          email
          createdAt
          fulfillmentStatus
          displayFulfillmentStatus
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                quantity
                variant {
                  id
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

  const fulfillmentStatus = node.displayFulfillmentStatus || node.fulfillmentStatus;
  const fulfilled = ["FULFILLED", "IN_PROGRESS", "PARTIALLY_FULFILLED"].includes(fulfillmentStatus);
  if (!fulfilled) {
    return { ok: false, code: "NOT_FULFILLED", message: "Order has not been fulfilled yet." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineItems: PortalLineItem[] = (node.lineItems?.edges ?? []).map((e: any) => {
    const n = e.node;
    return {
      id: n.id,
      title: n.title,
      quantity: n.quantity,
      variantId: n.variant?.id ?? null,
      productId: n.variant?.product?.id ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      collectionIds: (n.variant?.product?.collections?.edges ?? []).map((c: any) => c.node.id),
      excluded: false,
    };
  });

  const shopifyOrderId = String(node.id).split("/").pop() || node.id;

  // Fetch already-returned line items for this order.
  const existingRequests = await prisma.returnRequest.findMany({
    where: { shop, shopifyOrderId },
    include: { items: true },
  });
  const returnedLineItemIds = new Set<string>();
  for (const r of existingRequests) {
    for (const it of r.items) {
      if (it.shopifyLineItemId) returnedLineItemIds.add(it.shopifyLineItemId);
    }
  }

  // Apply exclusion + already-returned flags.
  let eligibleCount = 0;
  const eligibleLineItemIds: string[] = [];
  for (const item of lineItems) {
    const excluded = await isItemExcluded(shop, {
      productId: item.productId ?? undefined,
      variantId: item.variantId ?? undefined,
      collectionIds: item.collectionIds,
    }, requestType);
    item.excluded = excluded || returnedLineItemIds.has(item.id);
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
    return { ok: false, code: "DEADLINE_EXPIRED", message: "Return/exchange/complaint deadline has expired." };
  }

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
      createdAt: node.createdAt,
      fulfillmentStatus,
      lineItems,
    },
    eligibleLineItemIds,
    deadline: deadline.toISOString(),
    requestType,
    reasons,
  };
}

export function portalErrorCodeToMessage(code: PortalErrorCode, lang: "en" | "sv" = "en"): string {
  const messages: Record<PortalErrorCode, { en: string; sv: string }> = {
    SHOP_REQUIRED: { en: "Shop is required.", sv: "Butik krävs." },
    RATE_LIMITED: { en: "Too many attempts. Please try again later.", sv: "För många försök. Försök igen senare." },
    ORDER_NOT_FOUND: { en: "Order not found.", sv: "Ordern hittades inte." },
    EMAIL_MISMATCH: { en: "Email does not match the order.", sv: "E-post matchar inte ordern." },
    NOT_FULFILLED: { en: "Order has not been fulfilled yet.", sv: "Ordern har inte levererats ännu." },
    DEADLINE_EXPIRED: { en: "Return deadline has expired.", sv: "Returfristen har löpt ut." },
    ALL_ITEMS_EXCLUDED_OR_RETURNED: { en: "All items are excluded or already returned.", sv: "Alla artiklar är undantagna eller redan returnerade." },
    INVALID_INPUT: { en: "Please fill in all required fields.", sv: "Fyll i alla obligatoriska fält." },
  };
  return messages[code][lang];
}
