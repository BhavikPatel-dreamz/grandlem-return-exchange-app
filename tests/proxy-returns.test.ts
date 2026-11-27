/* eslint-disable @typescript-eslint/no-explicit-any */
// Step 7 checks from docs/storefront-return-proxy.md, run against the real
// proxy route and services with Shopify and the database faked in memory.
// These complement, not replace, the manual check on a dev store.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fake world: two shops, their orders, and an in-memory database
// ---------------------------------------------------------------------------

const world = vi.hoisted(() => {
  type Order = {
    id: string;
    name: string;
    email: string;
    createdAt: string;
    displayFulfillmentStatus: string;
    cancelledAt: string | null;
    customerId: string | null;
    lineItems: { id: string; title: string; quantity: number; variantId: string; productId: string }[];
  };
  const state = {
    orders: {} as Record<string, Order[]>,
    settings: {} as Record<string, Record<string, unknown>>,
    reasons: [] as Record<string, unknown>[],
    returnRequests: [] as Record<string, any>[],
    labelAttempts: [] as string[],
    sentEmails: [] as { shop: string; event: string; to: string }[],
  };
  return { state };
});

const { state } = world;

const SETTINGS_DEFAULTS = {
  returnDeadlineDays: 30,
  exchangeDeadlineDays: 30,
  complaintDeadlineDays: 60,
  autoApproveRequests: false,
  deflectionEnabled: false,
  storeCreditEnabled: true,
  storeCreditBonusPercent: 10,
  complaintResolutionMode: "customer_chooses",
  complaintRequireItemReturn: true,
  claimRequiresPhoto: true,
  claimMinPhotos: 1,
  claimMinCommentLength: 20,
};

vi.mock("../app/db.server", () => {
  const prisma = {
    settings: {
      findUnique: async ({ where }: any) =>
        state.settings[where.shop] ? { shop: where.shop, ...SETTINGS_DEFAULTS, ...state.settings[where.shop] } : null,
      create: async ({ data }: any) => {
        state.settings[data.shop] = {};
        return { shop: data.shop, ...SETTINGS_DEFAULTS };
      },
    },
    deadlineExtension: { findUnique: async () => null },
    exclusionRule: { findMany: async () => [] },
    returnReason: {
      findMany: async ({ where }: any) => state.reasons.filter((r) => r.shop === where.shop && r.active),
    },
    returnRequest: {
      findMany: async ({ where }: any) =>
        state.returnRequests.filter(
          (r) => r.shop === where.shop && (where.shopifyOrderId?.in ?? [where.shopifyOrderId]).includes(r.shopifyOrderId),
        ),
      count: async ({ where }: any) => state.returnRequests.filter((r) => r.shop === where.shop).length,
      findFirst: async ({ where }: any) =>
        state.returnRequests.find((r) => r.shop === where.shop && r.requestNumber === where.requestNumber) ?? null,
      create: async ({ data }: any) => {
        const row = {
          id: `rr_${state.returnRequests.length + 1}`,
          ...data,
          requestedResolution: null,
          items: data.items.create.map((it: any) => ({ ...it, photos: it.photos.create })),
        };
        state.returnRequests.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.returnRequests.find((r) => r.id === where.id);
        Object.assign(row!, data);
        return row;
      },
    },
  };
  return { default: prisma };
});

vi.mock("../app/services/email.server", () => ({
  sendEventEmail: async (shop: string, event: string, _lang: string, to: string) => {
    state.sentEmails.push({ shop, event, to });
    return { ok: true };
  },
}));

vi.mock("../app/services/shippypro.server", () => ({
  createReturnLabel: async (returnRequestId: string) => {
    state.labelAttempts.push(returnRequestId);
    return { ok: false, error: "No carrier in test" };
  },
}));

vi.mock("../app/services/portal.server", () => {
  const { state } = world;

  async function basicValidate(shop: string, orderNumber: string, email: string) {
    const orders = state.orders[shop] ?? [];
    const o = orders.find((x) => x.name === `#${orderNumber.replace(/^#/, "")}`);
    if (!o) return { ok: false as const, code: "ORDER_NOT_FOUND" as const, message: "Order not found." };
    if (!o.email || o.email.toLowerCase() !== email.toLowerCase()) {
      return { ok: false as const, code: "EMAIL_MISMATCH" as const, message: "Email does not match the order." };
    }
    const fulfilled = ["FULFILLED", "IN_PROGRESS", "PARTIALLY_FULFILLED"].includes(o.displayFulfillmentStatus);
    if (!fulfilled) return { ok: false as const, code: "NOT_FULFILLED" as const, message: "Order has not been fulfilled yet." };
    return {
      ok: true as const,
      shop,
      order: { id: o.id, name: o.name, email: o.email, createdAt: o.createdAt, fulfillmentStatus: o.displayFulfillmentStatus, lineItems: o.lineItems.map((li) => ({ ...li, collectionIds: [], excluded: false })) },
      eligibleLineItemIds: o.lineItems.map((li) => li.id),
      deadline: new Date().toISOString(),
      requestType: "return" as const,
      reasons: [],
    };
  }

  async function basicValidateCustomer(shop: string, orderId: string, customerId: string) {
    const orders = state.orders[shop] ?? [];
    const o = orders.find((x) => x.id === orderId);
    if (!o) return { ok: false as const, code: "ORDER_NOT_FOUND" as const, message: "Order not found." };
    if (o.customerId !== customerId) return { ok: false as const, code: "ORDER_NOT_FOUND" as const, message: "Order not found." };
    const fulfilled = ["FULFILLED", "IN_PROGRESS", "PARTIALLY_FULFILLED"].includes(o.displayFulfillmentStatus);
    if (!fulfilled) return { ok: false as const, code: "NOT_FULFILLED" as const, message: "Order has not been fulfilled yet." };
    return {
      ok: true as const,
      shop,
      order: { id: o.id, name: o.name, email: o.email, createdAt: o.createdAt, fulfillmentStatus: o.displayFulfillmentStatus, lineItems: o.lineItems.map((li) => ({ ...li, collectionIds: [], excluded: false })) },
      eligibleLineItemIds: o.lineItems.map((li) => li.id),
      deadline: new Date().toISOString(),
      requestType: "return" as const,
      reasons: [],
    };
  }

  // Full validation (used after request type selection)
  async function fullValidate(shop: string, orderNumber: string, email: string, requestType: string) {
    const basic = await basicValidate(shop, orderNumber, email);
    if (!basic.ok) return basic;
    // Check exclusions based on requestType
    const orders = state.orders[shop] ?? [];
    const o = orders.find((x) => x.name === `#${orderNumber.replace(/^#/, "")}`);
    if (!o) return { ok: false as const, code: "ORDER_NOT_FOUND" as const, message: "Order not found." };
    // For simplicity, no exclusions in test
    return {
      ...basic,
      requestType: requestType as "return" | "exchange" | "complaint",
      reasons: state.reasons.filter((r) => r.shop === shop && r.active).map((r) => ({
        id: r.id,
        labelEn: r.labelEn,
        labelSv: r.labelSv,
        appliesTo: r.appliesTo,
      })),
    };
  }

  async function fullValidateCustomer(shop: string, orderId: string, customerId: string, requestType: string) {
    const basic = await basicValidateCustomer(shop, orderId, customerId);
    if (!basic.ok) return basic;
    const orders = state.orders[shop] ?? [];
    const o = orders.find((x) => x.id === orderId);
    if (!o) return { ok: false as const, code: "ORDER_NOT_FOUND" as const, message: "Order not found." };
    return {
      ...basic,
      requestType: requestType as "return" | "exchange" | "complaint",
      reasons: state.reasons.filter((r) => r.shop === shop && r.active).map((r) => ({
        id: r.id,
        labelEn: r.labelEn,
        labelSv: r.labelSv,
        appliesTo: r.appliesTo,
      })),
    };
  }

  // Revalidate by order ID (used at submit time)
  async function revalidateById(shop: string, orderId: string, requestType: string) {
    const orders = state.orders[shop] ?? [];
    const o = orders.find((x) => x.id === orderId);
    if (!o) return { ok: false as const, code: "ORDER_NOT_FOUND" as const, message: "Order not found." };
    const fulfilled = ["FULFILLED", "IN_PROGRESS", "PARTIALLY_FULFILLED"].includes(o.displayFulfillmentStatus);
    if (!fulfilled) return { ok: false as const, code: "NOT_FULFILLED" as const, message: "Order has not been fulfilled yet." };

    // Check already-returned line items (simulate prisma.returnRequest.findMany)
    const returnedLineItemIds = new Set<string>();
    for (const r of state.returnRequests) {
      if (r.shop === shop && (r.shopifyOrderId === orderId || r.shopifyOrderId === o.id)) {
        for (const it of r.items) {
          if (it.shopifyLineItemId) returnedLineItemIds.add(it.shopifyLineItemId);
        }
      }
    }

    const lineItems = o.lineItems.map((li) => ({
      ...li,
      collectionIds: [],
      excluded: returnedLineItemIds.has(li.id),
    }));

    const eligibleLineItemIds = lineItems.filter((li) => !li.excluded).map((li) => li.id);
    if (eligibleLineItemIds.length === 0) {
      return { ok: false as const, code: "ALL_ITEMS_EXCLUDED_OR_RETURNED" as const, message: "All items are excluded or already returned." };
    }

    return {
      ok: true as const,
      shop,
      order: { id: o.id, name: o.name, email: o.email, createdAt: o.createdAt, fulfillmentStatus: o.displayFulfillmentStatus, lineItems },
      eligibleLineItemIds,
      deadline: new Date().toISOString(),
      requestType: requestType as "return" | "exchange" | "complaint",
      reasons: state.reasons.filter((r) => r.shop === shop && r.active).map((r) => ({
        id: r.id,
        labelEn: r.labelEn,
        labelSv: r.labelSv,
        appliesTo: r.appliesTo,
      })),
    };
  }

  const ERROR_MESSAGES: Record<string, string> = {
    ORDER_NOT_FOUND: "We couldn't find that order.",
    EMAIL_MISMATCH: "Email does not match the order.",
    SHOP_REQUIRED: "Shop is required.",
    NOT_FULFILLED: "Order has not been fulfilled yet.",
    DEADLINE_EXPIRED: "Return deadline has expired.",
    ALL_ITEMS_EXCLUDED_OR_RETURNED: "All items are excluded or already returned.",
    INVALID_INPUT: "Please fill in all required fields.",
    RATE_LIMITED: "Too many attempts. Please try again later.",
  };

  return {
    lookupAndValidateOrderBasic: basicValidate,
    lookupOrderForCustomerBasic: basicValidateCustomer,
    lookupAndValidateOrder: fullValidate,
    lookupOrderForCustomer: fullValidateCustomer,
    revalidateOrderById: revalidateById,
    checkRateLimit: () => true,
    listCustomerOrders: async (shop: string, customerId: string) => {
      const orders = state.orders[shop] ?? [];
      return orders.filter((o) => o.customerId === customerId && !o.cancelledAt).map((o) => ({
        id: o.id,
        name: o.name,
        createdAt: o.createdAt,
        fulfillmentStatus: o.displayFulfillmentStatus,
      }));
    },
    portalErrorCodeToMessage: (code: string) => ERROR_MESSAGES[code] || code,
  };
});

function orderNode(o: (typeof state.orders)[string][number]) {
  return {
    id: o.id,
    name: o.name,
    email: o.email,
    createdAt: o.createdAt,
    fulfillmentStatus: o.displayFulfillmentStatus,
    displayFulfillmentStatus: o.displayFulfillmentStatus,
    cancelledAt: o.cancelledAt,
    customer: o.customerId ? { id: `gid://shopify/Customer/${o.customerId}` } : null,
    lineItems: {
      edges: o.lineItems.map((li) => ({
        node: {
          id: li.id,
          title: li.title,
          quantity: li.quantity,
          variant: { id: li.variantId, product: { id: li.productId, collections: { edges: [] } } },
        },
      })),
    },
  };
}

vi.mock("../app/shopify.server", () => {
  const graphqlFor = (shop: string) => async (query: string, opts: { variables: Record<string, string> }) => {
    const orders = state.orders[shop] ?? [];
    const v = opts.variables;
    let data: unknown;
    if (query.includes("portalOrderLookup")) {
      const name = v.query.replace(/^name:/, "");
      const o = orders.find((x) => x.name === name);
      data = { orders: { edges: o ? [{ node: orderNode(o) }] : [] } };
    } else if (query.includes("proxyCustomerOrders")) {
      const id = v.customerId.split("/").pop();
      data = {
        customer: { id: v.customerId, orders: { nodes: orders.filter((o) => o.customerId === id).map(orderNode) } },
      };
    } else if (query.includes("proxyOrderById")) {
      const o = orders.find((x) => x.id === v.id);
      data = { order: o ? orderNode(o) : null };
    } else {
      throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    }
    return { json: async () => ({ data }) };
  };

  return {
    authenticate: {
      public: {
        // Stand-in for the real HMAC check: only signature=ok passes.
        appProxy: async (request: Request) => {
          if (new URL(request.url).searchParams.get("signature") !== "ok") {
            throw new Response("Bad signature", { status: 400 });
          }
          return {
            liquid: (body: string, init?: ResponseInit) =>
              new Response(body, {
                ...(init ?? {}),
                headers: { ...((init?.headers as Record<string, string>) ?? {}), "Content-Type": "application/liquid" },
              }),
          };
        },
      },
    },
    unauthenticated: {
      admin: async (shop: string) => {
        if (!state.orders[shop]) throw new Error("no session");
        return { admin: { graphql: graphqlFor(shop) } };
      },
    },
  };
});

process.env.SHOPIFY_API_SECRET = "test-secret";

const { loader, action } = await import("../app/routes/proxy._index");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHOP_A = "shop-a.myshopify.com";
const SHOP_B = "shop-b.myshopify.com";
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

function proxyUrl(shop: string, opts: { customerId?: string; signature?: string } = {}) {
  const u = new URL("https://app.test/proxy");
  u.searchParams.set("shop", shop);
  u.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
  u.searchParams.set("signature", opts.signature ?? "ok");
  u.searchParams.set("logged_in_customer_id", opts.customerId ?? "");
  return u.toString();
}

async function get(shop: string, opts: { customerId?: string; signature?: string } = {}) {
  return loader({ request: new Request(proxyUrl(shop, opts)), params: {}, context: {} } as any);
}

async function post(
  shop: string,
  fields: Record<string, string | string[] | File[]>,
  opts: { customerId?: string; postedShop?: string } = {},
) {
  const fd = new FormData();
  fd.set("shop", opts.postedShop ?? shop);
  fd.set("lang", "en");
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const x of v) fd.append(k, x as any);
    else fd.set(k, v);
  }
  const request = new Request(proxyUrl(shop, opts), { method: "POST", body: fd });
  const res = (await action({ request, params: {}, context: {} } as any)) as Response;
  return { res, html: await res.text() };
}

const tokenFrom = (html: string) => html.match(/name="orderToken" value="([^"]+)"/)?.[1] ?? null;

function seed() {
  state.returnRequests = [];
  state.labelAttempts = [];
  state.sentEmails = [];
  state.settings = {};
  state.reasons = [
    { id: "r_size", shop: SHOP_A, labelEn: "Wrong size", labelSv: "Fel storlek", appliesTo: "return,exchange", active: true },
    { id: "r_broken", shop: SHOP_A, labelEn: "Damaged", labelSv: "Skadad", appliesTo: "complaint", active: true },
  ];
  state.orders = {
    [SHOP_A]: [
      {
        id: "gid://shopify/Order/1001",
        name: "#1001",
        email: "alice@example.com",
        createdAt: daysAgo(5),
        displayFulfillmentStatus: "FULFILLED",
        cancelledAt: null,
        customerId: "501",
        lineItems: [
          { id: "gid://shopify/LineItem/1", title: "Wool Sweater", quantity: 2, variantId: "v1", productId: "p1" },
        ],
      },
      {
        id: "gid://shopify/Order/1002",
        name: "#1002",
        email: "bob@example.com",
        createdAt: daysAgo(3),
        displayFulfillmentStatus: "FULFILLED",
        cancelledAt: null,
        customerId: "502",
        lineItems: [{ id: "gid://shopify/LineItem/2", title: "Linen Shirt", quantity: 1, variantId: "v2", productId: "p2" }],
      },
      {
        id: "gid://shopify/Order/1003",
        name: "#1003",
        email: "alice@example.com",
        createdAt: daysAgo(1),
        displayFulfillmentStatus: "UNFULFILLED",
        cancelledAt: null,
        customerId: "501",
        lineItems: [{ id: "gid://shopify/LineItem/3", title: "Scarf", quantity: 1, variantId: "v3", productId: "p3" }],
      },
    ],
    [SHOP_B]: [
      {
        id: "gid://shopify/Order/9001",
        name: "#1001",
        email: "carol@example.com",
        createdAt: daysAgo(2),
        displayFulfillmentStatus: "FULFILLED",
        cancelledAt: null,
        customerId: "901",
        lineItems: [{ id: "gid://shopify/LineItem/9", title: "Shop B Jacket", quantity: 1, variantId: "v9", productId: "p9" }],
      },
    ],
  };
}

// checkRateLimit is in-memory module state (10 per 5 min). Move the clock
// 6 minutes forward before each test so buckets reset between tests.
vi.useFakeTimers({ toFake: ["Date"] });
beforeEach(() => {
  vi.setSystemTime(Date.now() + 6 * 60 * 1000);
  seed();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proxy signature and theme rendering", () => {
  it("renders the guest form as Liquid inside the theme", async () => {
    const res = (await get(SHOP_A)) as Response;
    expect(res.headers.get("Content-Type")).toBe("application/liquid");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain('name="orderNumber"');
    expect(html).toContain('name="email"');
    expect(html).not.toMatch(/<s-page|<html/);
  });

  it("rejects a request without a valid proxy signature", async () => {
    await expect(get(SHOP_A, { signature: "forged" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("guest lookup", () => {
  async function lookupAndSelectType(shop: string, orderNumber: string, email: string, requestType: string) {
    // Step 1: lookup order (no requestType)
    const { html: lookupHtml } = await post(shop, {
      _stage: "lookup",
      orderNumber,
      email,
    });
    // Step 2: select request type
    const { html } = await post(shop, {
      _stage: "select_request_type",
      requestType,
      orderNumber,
      email,
      selected: "gid://shopify/LineItem/1",
    });
    return { lookupHtml, html };
  }

  it("correct order number and email shows the items", async () => {
    const { lookupHtml, html } = await lookupAndSelectType(SHOP_A, "1001", "Alice@Example.com", "return");
    expect(lookupHtml).toContain('name="selected" value="gid://shopify/LineItem/1"');
    expect(lookupHtml).toContain('aria-label="Select Wool Sweater" checked required');
    expect(lookupHtml).toContain("request a return or exchange (0 days).");
    expect(html).toContain("Wool Sweater");
    expect(tokenFrom(html)).toBeTruthy();
  });

  it("leaves multi-item orders unselected until the customer chooses", async () => {
    state.orders[SHOP_A][0].lineItems.push({
      id: "gid://shopify/LineItem/11",
      title: "Cotton Tee",
      quantity: 1,
      variantId: "v11",
      productId: "p11",
    });
    const { html } = await post(SHOP_A, {
      _stage: "lookup",
      orderNumber: "1001",
      email: "alice@example.com",
    });
    expect(html).toContain('name="selected" value="gid://shopify/LineItem/1"');
    expect(html).toContain('name="selected" value="gid://shopify/LineItem/11"');
    const itemCheckboxes = html.match(/<input type="checkbox" name="selected"[^>]*>/g) ?? [];
    expect(itemCheckboxes).toHaveLength(2);
    expect(itemCheckboxes.every((input) => !input.includes("checked"))).toBe(true);
  });

  it("wrong email gives the generic error and no items", async () => {
    const { html: lookupHtml } = await post(SHOP_A, {
      _stage: "lookup",
      orderNumber: "1001",
      email: "mallory@example.com",
    });
    expect(lookupHtml).toContain("It seems like the order number and/or email you have entered did not match our records. Please double-check and try again.");
    expect(lookupHtml).toContain('<span class="glr-error-icon" aria-hidden="true">!</span>');
    expect(lookupHtml).not.toContain("Email does not match");
    expect(lookupHtml).not.toContain("Wool Sweater");
  });

  it("unknown order number gives the same generic error", async () => {
    const { html: lookupHtml } = await post(SHOP_A, {
      _stage: "lookup",
      orderNumber: "7777",
      email: "alice@example.com",
    });
    expect(lookupHtml).toContain("It seems like the order number and/or email you have entered did not match our records. Please double-check and try again.");
  });

  it("unfulfilled order keeps its specific message", async () => {
    const { html: lookupHtml } = await post(SHOP_A, {
      _stage: "lookup",
      orderNumber: "1003",
      email: "alice@example.com",
    });
    expect(lookupHtml).toContain("Order has not been fulfilled yet.");
  });

  it("escapes Liquid/HTML in echoed input", async () => {
    const { html: lookupHtml } = await post(SHOP_A, {
      _stage: "lookup",
      orderNumber: "{{ shop.email }}<b>",
      email: "x@example.com",
    });
    expect(lookupHtml).not.toContain("{{ shop.email }}");
    expect(lookupHtml).not.toContain("<b>");
  });
});

describe("logged-in customer", () => {
  it("lists only that customer's orders", async () => {
    const html = await ((await get(SHOP_A, { customerId: "501" })) as Response).text();
    expect(html).toContain("#1001");
    expect(html).toContain("#1003");
    expect(html).not.toContain("#1002");
    expect(html).not.toContain("gid://shopify/Order/1002");
  });

  async function selectOrderAndType(shop: string, customerId: string, orderId: string, requestType: string) {
    // Step 1: select order (no requestType)
    const { html: selectHtml } = await post(
      shop,
      { _stage: "select_order", orderId },
      { customerId },
    );
    // Step 2: select request type
    const { html } = await post(
      shop,
      { _stage: "select_request_type", requestType, orderId, selected: "gid://shopify/LineItem/1" },
      { customerId },
    );
    return { selectHtml, html };
  }

  it("rejects another customer's order id posted in the form", async () => {
    const { html: selectHtml } = await post(
      SHOP_A,
      { _stage: "select_order", orderId: "gid://shopify/Order/1002" },
      { customerId: "501" },
    );
    expect(selectHtml).toContain("It seems like the order number and/or email you have entered did not match our records. Please double-check and try again.");
    expect(selectHtml).not.toContain("Linen Shirt");
    expect(tokenFrom(selectHtml)).toBeNull();
  });

  it("selecting their own order shows the items", async () => {
    const { html } = await selectOrderAndType(SHOP_A, "501", "gid://shopify/Order/1001", "return");
    expect(html).toContain("Wool Sweater");
    expect(tokenFrom(html)).toBeTruthy();
  });

  it("customer with no orders gets the empty state and guest form", async () => {
    const html = await ((await get(SHOP_A, { customerId: "999" })) as Response).text();
    expect(html).toContain("We couldn\u2019t find any orders on your account.");
    expect(html).toContain('name="orderNumber"');
  });
});

describe("submit", () => {
  async function guestToken(orderNumber = "1001", requestType = "return", email = "alice@example.com") {
    await post(SHOP_A, { _stage: "lookup", orderNumber, email });
    const { html: typeHtml } = await post(SHOP_A, { _stage: "select_request_type", requestType, orderNumber, email });
    const token = tokenFrom(typeHtml);
    expect(token).toBeTruthy();
    return token!;
  }

  it("creates a return with the chosen resolution and sends the email", async () => {
    const token = await guestToken();
    const { html } = await post(SHOP_A, {
      _stage: "submit",
      orderToken: token,
      resolution: "store_credit",
      selected: ["gid://shopify/LineItem/1"],
      "qty_gid://shopify/LineItem/1": "2",
      "reason_gid://shopify/LineItem/1": "r_size",
    });
    expect(html).toContain("Request received");
    expect(state.returnRequests).toHaveLength(1);
    const rr = state.returnRequests[0];
    expect(rr).toMatchObject({
      shop: SHOP_A,
      shopifyOrderId: "gid://shopify/Order/1001",
      type: "return",
      requestedResolution: "store_credit",
    });
    expect(rr.items[0]).toMatchObject({ quantity: 2, reasonId: "r_size" });
    expect(html).toContain(rr.requestNumber);
    expect(state.sentEmails).toEqual([{ shop: SHOP_A, event: "received", to: "alice@example.com" }]);
  });

  it("automatically approves requests and attempts a label when enabled", async () => {
    state.settings[SHOP_A] = { autoApproveRequests: true };
    const token = await guestToken();
    await post(SHOP_A, {
      _stage: "submit",
      orderToken: token,
      resolution: "store_credit",
      selected: ["gid://shopify/LineItem/1"],
      "qty_gid://shopify/LineItem/1": "1",
      "reason_gid://shopify/LineItem/1": "r_size",
    });

    expect(state.returnRequests).toHaveLength(1);
    expect(state.returnRequests[0].status).toBe("Approved");
    expect(state.returnRequests[0].approvedAt).toBeInstanceOf(Date);
    expect(state.labelAttempts).toEqual(["rr_1"]);
    expect(state.sentEmails).toEqual([{ shop: SHOP_A, event: "approved", to: "alice@example.com" }]);
  });

  it("a second submit for the same items is rejected (already returned)", async () => {
    const token = await guestToken();
    const fields = {
      _stage: "submit",
      orderToken: token,
      resolution: "refund",
      selected: ["gid://shopify/LineItem/1"],
      "qty_gid://shopify/LineItem/1": "1",
      "reason_gid://shopify/LineItem/1": "r_size",
    };
    await post(SHOP_A, fields);
    const { html } = await post(SHOP_A, fields);
    expect(state.returnRequests).toHaveLength(1);
    expect(html).toContain("All items are excluded or already returned.");
  });

  it("rejects a resolution the shop does not allow (refund under deflection)", async () => {
    state.settings[SHOP_A] = { deflectionEnabled: true };
    const token = await guestToken();
    const { html } = await post(SHOP_A, {
      _stage: "submit",
      orderToken: token,
      resolution: "refund",
      selected: ["gid://shopify/LineItem/1"],
      "qty_gid://shopify/LineItem/1": "1",
      "reason_gid://shopify/LineItem/1": "r_size",
    });
    expect(html).toContain("Choose how you\u2019d like this settled.");
    expect(state.returnRequests).toHaveLength(0);
  });

  it("rejects a reason that does not apply to the request type", async () => {
    const token = await guestToken();
    const { html } = await post(SHOP_A, {
      _stage: "submit",
      orderToken: token,
      resolution: "refund",
      selected: ["gid://shopify/LineItem/1"],
      "qty_gid://shopify/LineItem/1": "1",
      "reason_gid://shopify/LineItem/1": "r_broken", // complaint-only
    });
    expect(html).toContain("Choose a reason for Wool Sweater.");
    expect(state.returnRequests).toHaveLength(0);
  });

  it("complaint without a photo is rejected", async () => {
    const token = await guestToken("1001", "complaint");
    const { html } = await post(SHOP_A, {
      _stage: "submit",
      orderToken: token,
      resolution: "replacement",
      selected: ["gid://shopify/LineItem/1"],
      "qty_gid://shopify/LineItem/1": "1",
      "reason_gid://shopify/LineItem/1": "r_broken",
      "comment_gid://shopify/LineItem/1": "The seam came apart after one wash.",
    });
    expect(html).toContain("Add at least 1 photo(s) for Wool Sweater.");
    expect(state.returnRequests).toHaveLength(0);
  });

  it("complaint with photo and comment saves resolution replacement", async () => {
    const token = await guestToken("1001", "complaint");
    const photo = new File([new Uint8Array([137, 80, 78, 71])], "seam.png", { type: "image/png" });
    const { html } = await post(SHOP_A, {
      _stage: "submit",
      orderToken: token,
      resolution: "replacement",
      selected: ["gid://shopify/LineItem/1"],
      "qty_gid://shopify/LineItem/1": "1",
      "reason_gid://shopify/LineItem/1": "r_broken",
      "comment_gid://shopify/LineItem/1": "The seam came apart after one wash.",
      "photo_gid://shopify/LineItem/1": [photo],
    });
    expect(html).toContain("Request received");
    expect(state.returnRequests[0]).toMatchObject({ type: "complaint", requestedResolution: "replacement" });
    expect(state.returnRequests[0].items[0].photos).toHaveLength(1);
  });

  it("a tampered token is rejected", async () => {
    const token = await guestToken();
    const [body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.orderId = "gid://shopify/Order/1002";
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    const { html } = await post(SHOP_A, {
      _stage: "submit",
      orderToken: forged,
      resolution: "refund",
      selected: ["gid://shopify/LineItem/2"],
      "qty_gid://shopify/LineItem/2": "1",
      "reason_gid://shopify/LineItem/2": "r_size",
    });
    expect(html).toContain("Your session has expired.");
    expect(state.returnRequests).toHaveLength(0);
  });

  it("a logged-in token cannot be used by a different logged-in customer", async () => {
    await post(
      SHOP_A,
      { _stage: "select_order", orderId: "gid://shopify/Order/1001" },
      { customerId: "501" },
    );
    const { html: typeHtml } = await post(
      SHOP_A,
      { _stage: "select_request_type", requestType: "return", orderId: "gid://shopify/Order/1001" },
      { customerId: "501" },
    );
    const token = tokenFrom(typeHtml)!;
    const { html } = await post(
      SHOP_A,
      {
        _stage: "submit",
        orderToken: token,
        resolution: "refund",
        selected: ["gid://shopify/LineItem/1"],
        "qty_gid://shopify/LineItem/1": "1",
        "reason_gid://shopify/LineItem/1": "r_size",
      },
      { customerId: "502" },
    );
    expect(html).toContain("Your session has expired.");
    expect(state.returnRequests).toHaveLength(0);
  });
});

describe("second shop", () => {
  it("uses the signed shop's orders, not a posted shop field", async () => {
    // Same order number #1001 exists on both shops with different emails.
    await post(
      SHOP_B,
      { _stage: "lookup", orderNumber: "1001", email: "carol@example.com" },
      { postedShop: SHOP_A },
    );
    const { html } = await post(
      SHOP_B,
      { _stage: "select_request_type", requestType: "return", orderNumber: "1001", email: "carol@example.com", selected: "gid://shopify/LineItem/9" },
      { postedShop: SHOP_A },
    );
    expect(html).toContain("Shop B Jacket");
    expect(html).not.toContain("Wool Sweater");
  });

  it("a token from shop A is not accepted on shop B", async () => {
    await post(SHOP_A, {
      _stage: "lookup",
      orderNumber: "1001",
      email: "alice@example.com",
    });
    const { html: typeHtml } = await post(SHOP_A, {
      _stage: "select_request_type",
      requestType: "return",
      orderNumber: "1001",
      email: "alice@example.com",
    });
    const { html } = await post(SHOP_B, {
      _stage: "submit",
      orderToken: tokenFrom(typeHtml)!,
      resolution: "refund",
      selected: ["gid://shopify/LineItem/1"],
      "qty_gid://shopify/LineItem/1": "1",
    });
    expect(html).toContain("Your session has expired.");
    expect(state.returnRequests).toHaveLength(0);
  });
});