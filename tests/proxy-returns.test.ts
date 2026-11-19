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
    sentEmails: [] as { shop: string; event: string; to: string }[],
  };
  return { state };
});

const { state } = world;

const SETTINGS_DEFAULTS = {
  returnDeadlineDays: 30,
  exchangeDeadlineDays: 30,
  complaintDeadlineDays: 60,
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
  it("correct order number and email shows the items", async () => {
    const { html } = await post(SHOP_A, {
      _stage: "lookup",
      requestType: "return",
      orderNumber: "1001",
      email: "Alice@Example.com",
    });
    expect(html).toContain("Wool Sweater");
    expect(tokenFrom(html)).toBeTruthy();
  });

  it("wrong email gives the generic error and no items", async () => {
    const { html } = await post(SHOP_A, {
      _stage: "lookup",
      requestType: "return",
      orderNumber: "1001",
      email: "mallory@example.com",
    });
    expect(html).toContain("We couldn’t find that order.");
    expect(html).not.toContain("Email does not match");
    expect(html).not.toContain("Wool Sweater");
  });

  it("unknown order number gives the same generic error", async () => {
    const { html } = await post(SHOP_A, {
      _stage: "lookup",
      requestType: "return",
      orderNumber: "7777",
      email: "alice@example.com",
    });
    expect(html).toContain("We couldn’t find that order.");
  });

  it("unfulfilled order keeps its specific message", async () => {
    const { html } = await post(SHOP_A, {
      _stage: "lookup",
      requestType: "return",
      orderNumber: "1003",
      email: "alice@example.com",
    });
    expect(html).toContain("Order has not been fulfilled yet.");
  });

  it("escapes Liquid/HTML in echoed input", async () => {
    const { html } = await post(SHOP_A, {
      _stage: "lookup",
      requestType: "return",
      orderNumber: "{{ shop.email }}<b>",
      email: "x@example.com",
    });
    expect(html).not.toContain("{{ shop.email }}");
    expect(html).not.toContain("<b>");
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

  it("rejects another customer's order id posted in the form", async () => {
    const { html } = await post(
      SHOP_A,
      { _stage: "select_order", requestType: "return", orderId: "gid://shopify/Order/1002" },
      { customerId: "501" },
    );
    expect(html).toContain("We couldn’t find that order.");
    expect(html).not.toContain("Linen Shirt");
    expect(tokenFrom(html)).toBeNull();
  });

  it("selecting their own order shows the items", async () => {
    const { html } = await post(
      SHOP_A,
      { _stage: "select_order", requestType: "return", orderId: "gid://shopify/Order/1001" },
      { customerId: "501" },
    );
    expect(html).toContain("Wool Sweater");
    expect(tokenFrom(html)).toBeTruthy();
  });

  it("customer with no orders gets the empty state and guest form", async () => {
    const html = await ((await get(SHOP_A, { customerId: "999" })) as Response).text();
    expect(html).toContain("We couldn’t find any orders on your account.");
    expect(html).toContain('name="orderNumber"');
  });
});

describe("submit", () => {
  async function guestToken(orderNumber = "1001", requestType = "return", email = "alice@example.com") {
    const { html } = await post(SHOP_A, { _stage: "lookup", requestType, orderNumber, email });
    const token = tokenFrom(html);
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
    expect(html).toContain("Choose how you’d like this settled.");
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
    const { html: listHtml } = await post(
      SHOP_A,
      { _stage: "select_order", requestType: "return", orderId: "gid://shopify/Order/1001" },
      { customerId: "501" },
    );
    const token = tokenFrom(listHtml)!;
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
    const { html } = await post(
      SHOP_B,
      { _stage: "lookup", requestType: "return", orderNumber: "1001", email: "carol@example.com" },
      { postedShop: SHOP_A },
    );
    expect(html).toContain("Shop B Jacket");
    expect(html).not.toContain("Wool Sweater");
  });

  it("a token from shop A is not accepted on shop B", async () => {
    const { html: found } = await post(SHOP_A, {
      _stage: "lookup",
      requestType: "return",
      orderNumber: "1001",
      email: "alice@example.com",
    });
    const { html } = await post(SHOP_B, {
      _stage: "submit",
      orderToken: tokenFrom(found)!,
      resolution: "refund",
      selected: ["gid://shopify/LineItem/1"],
      "qty_gid://shopify/LineItem/1": "1",
    });
    expect(html).toContain("Your session has expired.");
    expect(state.returnRequests).toHaveLength(0);
  });
});
