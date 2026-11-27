/* eslint-disable @typescript-eslint/no-explicit-any */
// Label generation and admin approval with ShippyPro, Shopify and the database
// faked in memory. No network call leaves the test: every ShippyPro request is
// answered by `world.shippypro` and counted in `world.calls`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fake world
// ---------------------------------------------------------------------------

const world = vi.hoisted(() => {
  const SHOP = "dev-test.myshopify.com";
  const ORDER_GID = "gid://shopify/Order/1001";
  const LINE_GID = "gid://shopify/LineItem/1";
  const VARIANT_GID = "gid://shopify/ProductVariant/11";

  const state = {
    settings: {} as Record<string, any>,
    returnRequests: [] as any[],
    returnLabels: [] as any[],
    carriers: [] as any[],
    emails: [] as { to: string; subject?: string; event?: string; vars?: any }[],
    calls: [] as { method: string; params: any }[],
    // ShippyPro method handlers; a test can replace any of them.
    shippypro: {} as Record<string, (params: any) => any>,
    order: null as any,
    location: null as any,
  };

  function reset() {
    state.settings = {
      [SHOP]: {
        shop: SHOP,
        returnDeadlineDays: 30,
        exchangeDeadlineDays: 30,
        autoApproveRequests: false,
        emailFrom: null,
        labelTimingPerMarket: "{}",
        defaultReturnMethodPerMarket: JSON.stringify({ US: { carrierId: "501", service: "Ground" } }),
        warehouseAddressesPerMarket: "{}",
        shippyproApiKeyEncrypted: null,
        shippyproApiUrl: null,
      },
    };
    state.returnRequests = [
      {
        id: "rr_1",
        shop: SHOP,
        shopifyOrderId: ORDER_GID,
        orderNumber: "#1001",
        requestNumber: "GLM-1001",
        market: "US",
        customerEmail: "buyer@example.com",
        customerName: "Test Buyer",
        type: "return",
        status: "Submitted",
        reviewFlagged: false,
        fulfillmentLocationId: "gid://shopify/Location/1",
        submittedAt: new Date("2026-11-20T10:00:00Z"),
        approvedAt: null,
        approvalEmailSentAt: null,
        rejectedAt: null,
        items: [
          {
            id: "ri_1",
            returnRequestId: "rr_1",
            shopifyLineItemId: LINE_GID,
            variantId: VARIANT_GID,
            productId: "gid://shopify/Product/1",
            title: "Linen Shirt - M",
            quantity: 1,
            returnedQuantity: 1,
          },
        ],
      },
    ];
    state.returnLabels = [];
    state.carriers = [{ id: "car_1", shop: SHOP, shippyproCarrierId: "501", name: "UPS", service: "Ground" }];
    state.emails = [];
    state.calls = [];
    state.order = {
      shippingAddress: {
        name: "Test Buyer", address1: "1 Main St", address2: "", city: "New York", zip: "10001",
        country: "United States", countryCodeV2: "US", province: "New York", provinceCode: "NY", phone: "+15555550100",
      },
      email: "buyer@example.com",
      currencyCode: "USD",
      lineItems: { edges: [{ node: { id: LINE_GID, discountedUnitPriceSet: { shopMoney: { amount: "49.00" } } } }] },
    };
    state.location = {
      name: "US Warehouse",
      address: {
        address1: "9 Dock Rd", address2: "", city: "Newark", zip: "07102", country: "United States",
        countryCode: "US", province: "New Jersey", provinceCode: "NJ", phone: "+15555550199",
      },
    };
    state.shippypro = {
      GetShipmentsReport: () => ({ Shipments: [] }),
      Ship: () => ({
        Result: "OK",
        NewOrderID: 777,
        PDF: ["https://labels.example/777.pdf"],
        TrackingNumber: "1Z999",
        TrackingExternalLink: "https://track.example/1Z999",
      }),
      VoidShipments: () => ({ Result: "OK" }),
    };
  }

  return { state, reset, SHOP, ORDER_GID };
});

const { state } = world;

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, cond]) => {
    if (key === "OR") return (cond as any[]).some((c) => matches(row, c));
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in (cond as any)) return (cond as any).in.includes(row[key]);
      return matches(row, cond);
    }
    return row[key] === cond;
  });
}

function withRelations(rr: any) {
  return rr ? { ...rr, label: state.returnLabels.find((l) => l.returnRequestId === rr.id) ?? null } : null;
}

vi.mock("../app/db.server", () => {
  const prisma = {
    settings: {
      findUnique: async ({ where }: any) => state.settings[where.shop] ?? null,
      create: async ({ data }: any) => (state.settings[data.shop] = { ...data }),
    },
    returnRequest: {
      findUnique: async ({ where }: any) => withRelations(state.returnRequests.find((r) => r.id === where.id)),
      findFirst: async ({ where }: any) => withRelations(state.returnRequests.find((r) => matches(r, where))),
      update: async ({ where, data }: any) => {
        const row = state.returnRequests.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        return Object.assign(row, data);
      },
      updateMany: async ({ where, data }: any) => {
        const rows = state.returnRequests.filter((r) => matches(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    returnLabel: {
      findUnique: async ({ where }: any) => state.returnLabels.find((l) => l.returnRequestId === where.returnRequestId) ?? null,
      findFirst: async ({ where }: any) => state.returnLabels.find((l) => matches(l, where)) ?? null,
      create: async ({ data }: any) => {
        if (state.returnLabels.some((l) => l.returnRequestId === data.returnRequestId)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const row = { id: `lbl_${state.returnLabels.length + 1}`, ...data };
        state.returnLabels.push(row);
        return row;
      },
      upsert: async ({ where, create, update }: any) => {
        const row = state.returnLabels.find((l) => l.returnRequestId === where.returnRequestId);
        if (row) return Object.assign(row, update);
        const created = { id: `lbl_${state.returnLabels.length + 1}`, ...create };
        state.returnLabels.push(created);
        return created;
      },
      update: async ({ where, data }: any) => {
        const row = state.returnLabels.find((l) => matches(l, where));
        if (!row) throw new Error("not found");
        return Object.assign(row, data);
      },
      updateMany: async ({ where, data }: any) => {
        const rows = state.returnLabels.filter((l) => matches(l, where));
        rows.forEach((l) => Object.assign(l, data));
        return { count: rows.length };
      },
    },
    carrier: {
      findUnique: async ({ where }: any) => {
        const key = where.shop_shippyproCarrierId;
        return state.carriers.find((c) => c.shop === key.shop && c.shippyproCarrierId === key.shippyproCarrierId) ?? null;
      },
      findFirst: async ({ where }: any) => state.carriers.find((c) => matches(c, where)) ?? null,
      findMany: async ({ where }: any) => state.carriers.filter((c) => matches(c, where)),
    },
  };
  return { default: prisma };
});

vi.mock("../app/shopify.server", () => {
  const graphql = async (query: string) => {
    let data: any = {};
    if (query.includes("getOrderShipping")) data = { order: { shippingAddress: state.order.shippingAddress, email: state.order.email } };
    else if (query.includes("getReturnItemValues")) data = { order: { currencyCode: state.order.currencyCode, lineItems: state.order.lineItems } };
    else if (query.includes("returnWarehouseAddress")) data = { location: state.location };
    else if (query.includes("returnVariantCustoms")) data = { nodes: [] };
    else if (query.includes("LabelFailureRecipient")) data = { shop: { email: "owner@example.com" } };
    return { json: async () => ({ data }) };
  };
  return {
    unauthenticated: { admin: async () => ({ admin: { graphql } }) },
    authenticate: { admin: async () => ({ session: { shop: world.SHOP }, admin: { graphql } }) },
  };
});

vi.mock("../app/services/email.server", () => ({
  sendEmail: async (to: string, subject: string) => {
    state.emails.push({ to, subject });
    return { ok: true, provider: "test" };
  },
  sendEventEmail: async (_shop: string, event: string, _lang: string, to: string, vars: any) => {
    state.emails.push({ to, event, vars });
    return { ok: true };
  },
}));

// The route module imports these; they are not exercised here.
vi.mock("../app/services/exchanges.server", () => ({ applyReplacementVariants: vi.fn(), createExchangePaymentLink: vi.fn() }));
vi.mock("../app/services/restock.server", () => ({ performRestock: vi.fn() }));
vi.mock("../app/services/refunds.server", () => ({ issueRefund: vi.fn() }));
vi.mock("../app/services/replacement.server", () => ({ createReplacementOrder: vi.fn() }));
vi.mock("@shopify/shopify-app-react-router/server", () => ({ boundary: { headers: () => ({}), error: () => null } }));

const realFetch = globalThis.fetch;

beforeEach(() => {
  world.reset();
  process.env.SHIPPYPRO_API_KEY = "test-key";
  // Fake ShippyPro: answer by method name and record every call.
  globalThis.fetch = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    state.calls.push({ method: body.Method, params: body.Params });
    const handler = state.shippypro[body.Method];
    if (!handler) throw new Error(`Unexpected ShippyPro method ${body.Method}`);
    const json = await handler(body.Params);
    return { status: 200, ok: true, headers: new Headers(), json: async () => json } as any;
  }) as any;
  // Skip the retry back-off delays.
  vi.stubGlobal("setTimeout", (fn: () => void) => {
    fn();
    return 0;
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
  delete process.env.SHIPPYPRO_API_KEY;
});

function world_okShip() {
  return {
    Result: "OK",
    NewOrderID: 777,
    PDF: ["https://labels.example/777.pdf"],
    TrackingNumber: "1Z999",
    TrackingExternalLink: "https://track.example/1Z999",
  };
}

const shipCalls = () => state.calls.filter((c) => c.method === "Ship");

async function adminAction(intent: string, extra: Record<string, string> = {}, id = "rr_1") {
  const { action } = await import("../app/routes/app.returns_.$id");
  const body = new URLSearchParams({ _action: intent, ...extra });
  const request = new Request("https://app.test/app/returns/" + id, { method: "POST", body });
  return action({ request, params: { id }, context: {} } as any) as Promise<any>;
}

// ---------------------------------------------------------------------------
// Label service
// ---------------------------------------------------------------------------

describe("createReturnLabel", () => {
  it("creates one label, saving the shipment id, label URL and tracking", async () => {
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");

    expect(result).toEqual({ ok: true });
    expect(shipCalls()).toHaveLength(1);
    expect(state.returnLabels[0]).toMatchObject({
      shippyproOrderId: "777",
      labelUrl: "https://labels.example/777.pdf",
      trackingNumber: "1Z999",
      status: "created",
    });
  });

  it("sends the customer as sender and the warehouse as receiver", async () => {
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    await createReturnLabel("rr_1");

    const params = shipCalls()[0].params;
    expect(params.IsReturn).toBe(true);
    expect(params.TransactionID).toBe("#1001");
    expect(params.from_address).toMatchObject({ name: "Test Buyer", street1: "1 Main St", zip: "10001", country: "US" });
    expect(params.to_address).toMatchObject({ name: "US Warehouse", street1: "9 Dock Rd", zip: "07102", country: "US" });
  });

  it("marks the label failed and alerts the shop when ShippyPro rejects the shipment", async () => {
    state.shippypro.Ship = () => ({ Result: "ERROR", ErrorMessage: "Invalid ZIP" });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid ZIP");
    expect(state.returnLabels[0].status).toBe("failed");
    expect(state.emails.some((e) => e.to === "owner@example.com")).toBe(true);
  });

  it("does not call ShippyPro when no API key is configured", async () => {
    delete process.env.SHIPPYPRO_API_KEY;
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");

    expect(result.ok).toBe(false);
    expect(shipCalls()).toHaveLength(0);
  });

  it("sends Ship only once when ShippyPro rejects the shipment", async () => {
    state.shippypro.Ship = () => ({ Result: "ERROR", ErrorMessage: "Invalid ZIP" });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    await createReturnLabel("rr_1");
    expect(shipCalls()).toHaveLength(1);
  });

  it("marks a timeout as unknown and does not send Ship again", async () => {
    state.shippypro.Ship = () => {
      throw new Error("network timeout");
    };
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const first = await createReturnLabel("rr_1");
    expect(first.ok).toBe(false);
    expect(state.returnLabels[0].status).toBe("unknown");

    state.shippypro.Ship = world_okShip;
    const second = await createReturnLabel("rr_1");
    expect(second.ok).toBe(false);
    expect(second.error).toContain("unknown result");
    expect(shipCalls()).toHaveLength(1);
  });

  it("allows a new attempt only after the admin confirms no shipment was created", async () => {
    state.shippypro.Ship = () => {
      throw new Error("network timeout");
    };
    const { createReturnLabel, confirmNoShipment } = await import("../app/services/shippypro.server");
    await createReturnLabel("rr_1");

    state.shippypro.Ship = world_okShip;
    expect((await confirmNoShipment("rr_1")).ok).toBe(true);
    expect((await createReturnLabel("rr_1")).ok).toBe(true);
    expect(shipCalls()).toHaveLength(2);
    expect(state.returnLabels[0].status).toBe("created");
  });

  it("refuses to create a second label while one already exists", async () => {
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    await createReturnLabel("rr_1");
    const second = await createReturnLabel("rr_1");
    expect(second.ok).toBe(false);
    expect(second.error).toContain("already exists");
    expect(shipCalls()).toHaveLength(1);
  });

  it("sends only one Ship when two requests race", async () => {
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const results = await Promise.all([createReturnLabel("rr_1"), createReturnLabel("rr_1")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(shipCalls()).toHaveLength(1);
  });

  it("keeps the shipment id for voiding when no label file comes back", async () => {
    state.shippypro.Ship = () => ({ Result: "OK", NewOrderID: 888 });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");
    expect(result.ok).toBe(false);
    expect(state.returnLabels[0]).toMatchObject({ status: "needs_review", shippyproOrderId: "888" });
    expect((await createReturnLabel("rr_1")).ok).toBe(false);
    expect(shipCalls()).toHaveLength(1);
  });

  it("allows a new label after the old one is voided", async () => {
    const { createReturnLabel, voidReturnLabel } = await import("../app/services/shippypro.server");
    await createReturnLabel("rr_1");
    expect((await voidReturnLabel("rr_1")).ok).toBe(true);
    expect((await createReturnLabel("rr_1")).ok).toBe(true);
    expect(shipCalls()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Admin approval
// ---------------------------------------------------------------------------

describe("admin approval", () => {
  it("approves, creates the label and emails the customer the label link", async () => {
    const result = await adminAction("approve");

    expect(result.ok).toBe(true);
    expect(state.returnRequests[0].status).toBe("Approved");
    expect(state.returnRequests[0].approvalEmailSentAt).toBeInstanceOf(Date);
    expect(shipCalls()).toHaveLength(1);
    const email = state.emails.find((e) => e.event === "approved");
    expect(email?.to).toBe("buyer@example.com");
    expect(email?.vars.labelLink).toBe("https://labels.example/777.pdf");
  });

  it("keeps the request approved but sends no email when the label fails", async () => {
    state.shippypro.Ship = () => ({ Result: "ERROR", ErrorMessage: "Carrier down" });
    const result = await adminAction("approve");

    expect(result.ok).toBe(false);
    expect(state.returnRequests[0].status).toBe("Approved");
    expect(state.returnRequests[0].approvalEmailSentAt).toBeNull();
    expect(state.emails.some((e) => e.event === "approved")).toBe(false);
  });

  it("rejects with a reason and emails the customer", async () => {
    const result = await adminAction("reject", { rejectionReason: "Worn item" });

    expect(result.ok).toBe(true);
    expect(state.returnRequests[0]).toMatchObject({ status: "Rejected", rejectionReason: "Worn item" });
    expect(state.emails.find((e) => e.event === "rejected")?.to).toBe("buyer@example.com");
  });

  // Known defects (D5). Fixed in roadmap step A1.
  it.fails("ignores a second approve of an already-approved request", async () => {
    await adminAction("approve");
    state.returnLabels[0].status = "failed"; // second click after a failure must still not re-ship
    await adminAction("approve");
    expect(shipCalls()).toHaveLength(1);
  });

  it.fails("refuses to approve a rejected request", async () => {
    await adminAction("reject", { rejectionReason: "Worn item" });
    await adminAction("approve");
    expect(state.returnRequests[0].status).toBe("Rejected");
  });
});
