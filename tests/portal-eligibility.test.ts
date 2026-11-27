/* eslint-disable @typescript-eslint/no-explicit-any */
// Quantity-aware eligibility in app/services/portal.server.ts, with Shopify and
// the database faked. Owner rule: a customer who bought 10 and returned 5 can
// still request the other 5; rejected requests release their quantities.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  order: null as any,
  requests: [] as any[],
}));

vi.mock("../app/db.server", () => ({
  default: {
    returnRequest: {
      findMany: async ({ where }: any) =>
        state.requests.filter(
          (r) => r.shop === where.shop
            && where.shopifyOrderId.in.includes(r.shopifyOrderId)
            && !(where.status?.notIn ?? []).includes(r.status),
        ),
    },
  },
}));

vi.mock("../app/shopify.server", () => ({
  unauthenticated: {
    admin: async () => ({
      admin: {
        graphql: async () => ({ json: async () => ({ data: { order: state.order } }) }),
      },
    }),
  },
}));

vi.mock("../app/services/validation.server", () => ({
  getEffectiveDeadline: async () => new Date(Date.now() + 86_400_000),
  isExpired: () => false,
  isItemExcluded: async () => false,
}));
vi.mock("../app/services/settings.server", () => ({ getOrCreateSettings: async () => ({}) }));
vi.mock("../app/services/return-reasons.server", () => ({ listReturnReasons: async () => [] }));

const SHOP = "dev-test.myshopify.com";
const ORDER = "gid://shopify/Order/1001";
const LINE_A = "gid://shopify/LineItem/1";
const LINE_B = "gid://shopify/LineItem/2";

function line(id: string, quantity: number, extra: Record<string, unknown> = {}) {
  return { node: { id, title: id.endsWith("1") ? "Shirt" : "Socks", quantity, variant: { id: `${id}-v`, product: { id: `${id}-p` } }, ...extra } };
}

function request(status: string, items: [string, number][]) {
  return {
    shop: SHOP,
    shopifyOrderId: ORDER,
    status,
    items: items.map(([shopifyLineItemId, quantity]) => ({ shopifyLineItemId, quantity })),
  };
}

beforeEach(() => {
  state.requests = [];
  state.order = {
    id: ORDER,
    name: "#1001",
    email: "buyer@example.com",
    createdAt: new Date().toISOString(),
    displayFulfillmentStatus: "FULFILLED",
    lineItems: { edges: [line(LINE_A, 10), line(LINE_B, 2)] },
  };
});

async function lookup(type: "return" | "exchange" = "return") {
  const { revalidateOrderById } = await import("../app/services/portal.server");
  return revalidateOrderById(SHOP, ORDER, type);
}

function qty(result: any, id: string) {
  return result.order.lineItems.find((li: any) => li.id === id);
}

describe("quantity-aware eligibility", () => {
  it("offers the full fulfilled quantity when nothing was requested", async () => {
    const result: any = await lookup();
    expect(result.ok).toBe(true);
    expect(qty(result, LINE_A)).toMatchObject({ quantity: 10, purchasedQuantity: 10, excluded: false });
  });

  it("after returning 5 of 10, the other 5 are still returnable", async () => {
    state.requests.push(request("Approved", [[LINE_A, 5]]));
    const result: any = await lookup();
    expect(result.ok).toBe(true);
    expect(qty(result, LINE_A)).toMatchObject({ quantity: 5, purchasedQuantity: 10, excluded: false });
  });

  it("a fully returned line is excluded but other lines stay eligible", async () => {
    state.requests.push(request("Submitted", [[LINE_A, 10]]));
    const result: any = await lookup();
    expect(qty(result, LINE_A).excluded).toBe(true);
    expect(result.eligibleLineItemIds).toEqual([LINE_B]);
  });

  it("a rejected request releases its quantity", async () => {
    state.requests.push(request("Rejected", [[LINE_A, 10]]));
    const result: any = await lookup();
    expect(qty(result, LINE_A).quantity).toBe(10);
  });

  it("an earlier return no longer blocks the whole order", async () => {
    state.requests.push(request("Approved", [[LINE_A, 3]]));
    const result: any = await lookup("return");
    expect(result.ok).toBe(true);
  });

  it("everything requested gives the all-returned error", async () => {
    state.requests.push(request("Approved", [[LINE_A, 10], [LINE_B, 2]]));
    const result: any = await lookup();
    expect(result).toMatchObject({ ok: false, code: "ALL_ITEMS_EXCLUDED_OR_RETURNED" });
  });

  it("unfulfilled and removed units cannot be returned", async () => {
    state.order.displayFulfillmentStatus = "PARTIALLY_FULFILLED";
    state.order.lineItems.edges = [line(LINE_A, 10, { currentQuantity: 8, unfulfilledQuantity: 3 })];
    const result: any = await lookup();
    expect(qty(result, LINE_A).quantity).toBe(5); // 10 bought, 2 removed, 3 not shipped
  });
});

describe("request numbers", () => {
  it("skips a number that is already taken", async () => {
    vi.resetModules();
    vi.doMock("../app/db.server", () => ({
      default: {
        returnRequest: {
          count: async () => 1,
          findFirst: async ({ where }: any) => (where.requestNumber === "GLM-1002" ? { id: "x" } : null),
          create: async ({ data }: any) => ({ id: "new", ...data, items: [] }),
        },
      },
    }));
    const { createReturnRequest } = await import("../app/services/returns.server");
    const created = await createReturnRequest({
      shop: SHOP,
      shopifyOrderId: ORDER,
      type: "return",
      items: [{ shopifyLineItemId: LINE_A, quantity: 1 }],
    });
    expect(created.requestNumber).toBe("GLM-1003");
    vi.doUnmock("../app/db.server");
  });
});

describe("legacy /portal route", () => {
  it("redirects a valid shop to the storefront return page", async () => {
    const { loader } = await import("../app/routes/portal");
    const response = await loader({ request: new Request("https://app.test/portal?shop=dev-test.myshopify.com") } as any);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://dev-test.myshopify.com/apps/returns");
  });

  it("does not accept posted forms or arbitrary hosts", async () => {
    const { loader, action } = await import("../app/routes/portal");
    await expect(loader({ request: new Request("https://app.test/portal?shop=evil.example.com") } as any)).rejects.toMatchObject({ status: 404 });
    await expect(action({ request: new Request("https://app.test/portal", { method: "POST" }) } as any)).rejects.toMatchObject({ status: 410 });
  });
});
