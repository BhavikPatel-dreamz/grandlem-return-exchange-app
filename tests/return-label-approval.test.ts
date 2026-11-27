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
    events: [] as any[],
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
    state.events = [];
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
      upsert: async ({ where, create, update }: any) =>
        (state.settings[where.shop] = state.settings[where.shop]
          ? Object.assign(state.settings[where.shop], update)
          : { ...create }),
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
    trackingEvent: {
      create: async ({ data }: any) => {
        state.events.push(data);
        return data;
      },
    },
    carrier: {
      findUnique: async ({ where }: any) => {
        const key = where.shop_shippyproCarrierId;
        return state.carriers.find((c) => c.shop === key.shop && c.shippyproCarrierId === key.shippyproCarrierId) ?? null;
      },
      findFirst: async ({ where }: any) => state.carriers.find((c) => matches(c, where)) ?? null,
      findMany: async ({ where }: any) => state.carriers.filter((c) => matches(c, where)),
      upsert: async ({ where, create, update }: any) => {
        const key = where.shop_shippyproCarrierId;
        const row = state.carriers.find((c) => c.shop === key.shop && c.shippyproCarrierId === key.shippyproCarrierId);
        if (row) return Object.assign(row, update);
        const created = { id: `car_${state.carriers.length + 1}`, ...create };
        state.carriers.push(created);
        return created;
      },
    },
    courierService: { upsert: async ({ create }: any) => create },
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
  delete process.env.SHIPPING_TEST_SHOPS;
  delete process.env.SHIPPING_LIVE_TEST_ENABLED;
  delete process.env.TEST_EMAIL_RECIPIENT;
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

  it("finds the label in LabelURL when PDF is an empty list", async () => {
    state.shippypro.Ship = () => ({ Result: "OK", NewOrderID: 999, PDF: [], LabelURL: "https://labels.example/999.pdf" });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    expect((await createReturnLabel("rr_1")).ok).toBe(true);
    expect(state.returnLabels[0]).toMatchObject({ status: "created", labelUrl: "https://labels.example/999.pdf" });
  });

  it("records ShippyPro's reply when no label link is found", async () => {
    state.shippypro.Ship = () => ({ Result: "OK", NewOrderID: 888, PDF: [] });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    await createReturnLabel("rr_1");
    expect(state.events[0]).toMatchObject({ status: "label_missing", returnRequestId: "rr_1" });
    expect(state.events[0].message).toContain("NewOrderID");
  });

  it("treats a reply with only an ErrorMessage as a failure, so a retry is allowed", async () => {
    state.shippypro.Ship = () => ({ ErrorMessage: "Carrier service not enabled" });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");
    expect(result.error).toContain("Carrier service not enabled");
    expect(state.returnLabels[0].status).toBe("failed");
  });

  it("marks a reply with neither label nor shipment id as unknown, not void-able", async () => {
    state.shippypro.Ship = () => ({ Result: "OK" });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");
    expect(result.error).toContain('ShippyPro\'s reply: {"Result":"OK"}');
    expect(state.returnLabels[0]).toMatchObject({ status: "unknown", shippyproOrderId: null });
  });

  it("unblocks an older needs_review label that has no shipment id", async () => {
    state.returnLabels.push({ id: "lbl_old", returnRequestId: "rr_1", status: "needs_review", shippyproOrderId: null });
    const { confirmNoShipment, createReturnLabel } = await import("../app/services/shippypro.server");
    expect((await confirmNoShipment("rr_1")).ok).toBe(true);
    expect((await createReturnLabel("rr_1")).ok).toBe(true);
  });

  it("does not unblock a needs_review label that has a shipment id (it must be voided)", async () => {
    state.returnLabels.push({ id: "lbl_old", returnRequestId: "rr_1", status: "needs_review", shippyproOrderId: "888" });
    const { confirmNoShipment } = await import("../app/services/shippypro.server");
    expect((await confirmNoShipment("rr_1")).ok).toBe(false);
  });

  it("treats ShippyPro's Error / ValidationErrors reply as a refusal (retry allowed)", async () => {
    state.shippypro.Ship = () => ({
      Error: "Invalid carrier",
      ValidationErrors: "Params.to_address.country: Must be at most 2 characters long",
    });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");
    expect(result.error).toContain("Invalid carrier");
    expect(result.error).toContain("Must be at most 2 characters long");
    expect(state.returnLabels[0].status).toBe("failed");
  });

  it("sends the carrier type, not the connection's nickname, as CarrierName", async () => {
    state.carriers[0].name = "My UPS account";
    state.carriers[0].meta = JSON.stringify({ CarrierID: 501, Label: "My UPS account", CarrierName: "UPS" });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    await createReturnLabel("rr_1");
    expect(shipCalls()[0].params.CarrierName).toBe("UPS");
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
// Pre-flight validation and preview
// ---------------------------------------------------------------------------

describe("shipment pre-flight", () => {
  it("does not call Ship when the customer's postal code is missing", async () => {
    state.order.shippingAddress.zip = "";
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Customer (pickup) postal code is missing");
    expect(shipCalls()).toHaveLength(0);
    expect(state.returnLabels[0].status).toBe("failed");
  });

  it("does not call Ship when there is no return warehouse address", async () => {
    state.location = null;
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");
    expect(result.error).toContain("Return warehouse street address is missing");
    expect(shipCalls()).toHaveLength(0);
  });

  it("previews the shipment without calling Ship", async () => {
    const { previewReturnShipment } = await import("../app/services/shippypro.server");
    const preview = await previewReturnShipment("rr_1");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.from).toMatchObject({ name: "Test Buyer", zip: "10001" });
    expect(preview.to).toMatchObject({ name: "US Warehouse", zip: "07102" });
    expect(shipCalls()).toHaveLength(0);
    expect(state.returnLabels).toHaveLength(0);
  });

  it("requires a warehouse phone before calling Ship (ShippyPro rejects it otherwise)", async () => {
    state.location.address.phone = "";
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");
    expect(result.error).toContain("Return warehouse phone is missing");
    expect(shipCalls()).toHaveLength(0);
  });

  it("sends 2-letter country codes even when Settings hold a country name", async () => {
    state.settings[world.SHOP].warehouseAddressesPerMarket = JSON.stringify({
      US: { name: "US Returns", address1: "1 Return Ln", city: "Austin", zip: "73301", country: "United States", phone: "+1512000" },
    });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    expect((await createReturnLabel("rr_1")).ok).toBe(true);
    expect(shipCalls()[0].params.to_address.country).toBe("US");
  });

  it("stops before Ship when a country cannot be turned into a code", async () => {
    state.settings[world.SHOP].warehouseAddressesPerMarket = JSON.stringify({
      US: { name: "US Returns", address1: "1 Return Ln", city: "Austin", zip: "73301", country: "Narnia", phone: "+1512000" },
    });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");
    expect(result.error).toContain('country "Narnia" must be a 2-letter code');
    expect(shipCalls()).toHaveLength(0);
  });

  it("admin preview action returns the shipment details", async () => {
    const result = await adminAction("preview_shipment");
    expect(result.ok).toBe(true);
    expect(result.preview.reference).toBe("#1001");
    expect(shipCalls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Mirror the original outbound shipment
// ---------------------------------------------------------------------------

describe("return label mirrors the original shipment", () => {
  const original = {
    TransactionID: "#1001",
    CarrierID: 501,
    CarrierName: "UPS",
    Service: "Ground",
    FromAddress: { Name: "Grand Le Mar WH", Address1: "5 Harbor Way", City: "Newark", ZIP: "07114", Country: "US", Phone: "+19730000" },
    ToAddress: { Name: "Buyer At Home", Address1: "22 Elm St", City: "Boston", ZIP: "02101", Country: "US" },
    Parcels: [{ Weight: 2.5, Length: 40, Width: 30, Height: 12 }],
  };

  it("swaps the original addresses and reuses its parcel", async () => {
    state.shippypro.GetShipmentsReport = () => ({ Shipments: [original] });
    const { previewReturnShipment } = await import("../app/services/shippypro.server");
    const preview = await previewReturnShipment("rr_1");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.to).toMatchObject({ name: "Grand Le Mar WH", street1: "5 Harbor Way", zip: "07114", country: "US" });
    expect(preview.from).toMatchObject({ name: "Buyer At Home", street1: "22 Elm St", zip: "02101" });
    // Phone missing on the original recipient is filled from the Shopify order.
    expect(preview.from.phone).toBe("+15555550100");
    expect(preview.parcels).toEqual([{ weight: 2.5, length: 40, width: 30, height: 12 }]);
  });

  it("uses the Settings return address and fallback parcel when no original shipment is found", async () => {
    state.settings[world.SHOP].warehouseAddressesPerMarket = JSON.stringify({
      US: { name: "US Returns", address1: "1 Return Ln", city: "Austin", zip: "73301", country: "US", phone: "+1512000" },
    });
    state.settings[world.SHOP].defaultReturnMethodPerMarket = JSON.stringify({
      US: { carrierId: "501", service: "Ground", parcel: { weight: 1.2, length: 35, width: 25, height: 8 } },
    });
    const { previewReturnShipment } = await import("../app/services/shippypro.server");
    const preview = await previewReturnShipment("rr_1");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.to).toMatchObject({ name: "US Returns", street1: "1 Return Ln" });
    expect(preview.from).toMatchObject({ name: "Test Buyer", street1: "1 Main St" });
    expect(preview.parcels).toEqual([{ weight: 1.2, length: 35, width: 25, height: 8 }]);
  });

  it("falls back to the Default carrier when the market rule has only a parcel", async () => {
    state.settings[world.SHOP].defaultReturnMethodPerMarket = JSON.stringify({
      US: { parcel: { weight: 1.2, length: 35, width: 25, height: 8 } },
      DEFAULT: { carrierId: "501", service: "Ground" },
    });
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    expect((await createReturnLabel("rr_1")).ok).toBe(true);
    expect(shipCalls()[0].params).toMatchObject({ CarrierID: 501, CarrierService: "Ground" });
    expect(shipCalls()[0].params.parcels).toEqual([{ weight: 1.2, length: 35, width: 25, height: 8 }]);
  });

  it("flags the request for review when the parcel had to be guessed", async () => {
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    await createReturnLabel("rr_1");
    expect(shipCalls()[0].params.parcels).toEqual([{ weight: 1, length: 10, width: 10, height: 10 }]);
    expect(state.returnRequests[0].reviewFlagged).toBe(true);
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

  it("ignores a second approve of an already-approved request", async () => {
    await adminAction("approve");
    state.returnLabels[0].status = "failed"; // even after a failed label, approve must not re-ship
    const second = await adminAction("approve");
    expect(second.ok).toBe(false);
    expect(second.message).toContain("already approved");
    expect(shipCalls()).toHaveLength(1);
    expect(state.emails.filter((e) => e.event === "approved")).toHaveLength(1);
  });

  it("refuses to approve a rejected request", async () => {
    await adminAction("reject", { rejectionReason: "Worn item" });
    const result = await adminAction("approve");
    expect(result.ok).toBe(false);
    expect(state.returnRequests[0].status).toBe("Rejected");
    expect(shipCalls()).toHaveLength(0);
  });

  it("refuses to reject an approved request", async () => {
    await adminAction("approve");
    const result = await adminAction("reject", { rejectionReason: "Changed mind" });
    expect(result.ok).toBe(false);
    expect(state.returnRequests[0].status).toBe("Approved");
    expect(state.emails.some((e) => e.event === "rejected")).toBe(false);
  });

  it("double-click approve sends one label and one email", async () => {
    await Promise.all([adminAction("approve"), adminAction("approve")]);
    expect(shipCalls()).toHaveLength(1);
    expect(state.emails.filter((e) => e.event === "approved")).toHaveLength(1);
  });

  it("addresses the customer by name, not by email", async () => {
    await adminAction("approve");
    expect(state.emails.find((e) => e.event === "approved")?.vars.customerName).toBe("Test Buyer");
  });

  it("approving an exchange emails the exchange template with the return label", async () => {
    const { createExchangePaymentLink } = await import("../app/services/exchanges.server");
    vi.mocked(createExchangePaymentLink).mockResolvedValueOnce({ required: false, total: 0, orderId: "gid://shopify/Order/2002" } as any);
    state.returnRequests[0].type = "exchange";
    const result = await adminAction("exchange_payment_link");
    expect(result.ok).toBe(true);
    expect(shipCalls()).toHaveLength(1);
    const email = state.emails.find((e) => e.event === "exchange_approved");
    expect(email?.vars.labelLink).toBe("https://labels.example/777.pdf");
    expect(email?.vars.items).toBe("Linen Shirt - M");
    expect(state.emails.some((e) => e.event === "approved")).toBe(false);
  });

  it("retrying the approval email reuses the existing label", async () => {
    state.emails.length = 0;
    await adminAction("approve");
    state.returnRequests[0].approvalEmailSentAt = null; // pretend the email failed
    const retry = await adminAction("retry_approval_email");
    expect(retry.ok).toBe(true);
    expect(shipCalls()).toHaveLength(1);
    expect(state.emails.filter((e) => e.event === "approved")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test-store isolation
// ---------------------------------------------------------------------------

describe("test store mode", () => {
  beforeEach(() => {
    process.env.SHIPPING_TEST_SHOPS = "other-shop.myshopify.com, DEV-TEST.myshopify.com";
  });

  it("does not call ShippyPro for a test store while live labels are off", async () => {
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("switched off");
    expect(state.calls).toHaveLength(0);
    expect(state.returnLabels).toHaveLength(0);
  });

  it("never uses the shared env key for a test store", async () => {
    process.env.SHIPPING_LIVE_TEST_ENABLED = "true";
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    const result = await createReturnLabel("rr_1");
    expect(result.ok).toBe(false);
    expect(shipCalls()).toHaveLength(0);
  });

  it("uses the test store's own key when live labels are on", async () => {
    process.env.SHIPPING_LIVE_TEST_ENABLED = "true";
    const { encryptSecret } = await import("../app/services/crypto.server");
    state.settings[world.SHOP].shippyproApiKeyEncrypted = encryptSecret("dev-store-key");
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    expect((await createReturnLabel("rr_1")).ok).toBe(true);
    expect(shipCalls()).toHaveLength(1);
  });

  it("leaves shops that are not test stores unchanged", async () => {
    process.env.SHIPPING_TEST_SHOPS = "other-shop.myshopify.com";
    const { createReturnLabel } = await import("../app/services/shippypro.server");
    expect((await createReturnLabel("rr_1")).ok).toBe(true);
  });

  it("routes test-store emails to TEST_EMAIL_RECIPIENT", async () => {
    process.env.TEST_EMAIL_RECIPIENT = "qa@example.com";
    const { emailRecipientFor } = await import("../app/services/test-mode.server");
    expect(emailRecipientFor(world.SHOP, "buyer@example.com")).toBe("qa@example.com");
    expect(emailRecipientFor("live-store.myshopify.com", "buyer@example.com")).toBe("buyer@example.com");
  });
});

// ---------------------------------------------------------------------------
// ShippyPro connection form
// ---------------------------------------------------------------------------

describe("ShippyPro connection settings", () => {
  async function saveKey(key: string, url: string | null) {
    const { saveShippyproConnection } = await import("../app/services/shippypro.server");
    await saveShippyproConnection(world.SHOP, key, url);
    return state.settings[world.SHOP];
  }

  it("shows only a masked hint of the saved key", async () => {
    const { maskShippyproKey } = await import("../app/services/shippypro.server");
    const saved = await saveKey("live-secret-key-abcd", null);
    expect(saved.shippyproApiKeyHint).toBe("abcd");
    expect(maskShippyproKey(saved.shippyproApiKeyHint)).toBe("••••••••••••abcd");
    expect(maskShippyproKey(saved.shippyproApiKeyHint)).not.toContain("secret");
  });

  it("keeps the saved key when the masked value or an empty field is submitted", async () => {
    const first = await saveKey("live-secret-key-abcd", null);
    const encrypted = first.shippyproApiKeyEncrypted;
    expect((await saveKey("••••••••••••abcd", "https://custom.example/v1")).shippyproApiKeyEncrypted).toBe(encrypted);
    expect(state.settings[world.SHOP].shippyproApiUrl).toBe("https://custom.example/v1");
    expect((await saveKey("", null)).shippyproApiKeyEncrypted).toBe(encrypted);
  });

  it("replaces the key when a new one is typed", async () => {
    const first = await saveKey("live-secret-key-abcd", null);
    const encrypted = first.shippyproApiKeyEncrypted;
    const second = await saveKey("new-key-wxyz", null);
    expect(second.shippyproApiKeyEncrypted).not.toBe(encrypted);
    expect(second.shippyproApiKeyHint).toBe("wxyz");
  });

  it("does not store the pre-filled default URL as a custom URL", async () => {
    expect((await saveKey("", "https://api.shippypro.com/v1/")).shippyproApiUrl).toBeNull();
  });
});

describe("carrier sync", () => {
  it("keeps the carrier type from ShippyPro's grouped carrier list", async () => {
    state.shippypro.GetCarriers = () => ({
      Carriers: { DHLExpress: [{ CarrierID: 700, Label: "DHL main account", ServicesList: ["EXPRESS WORLDWIDE"] }] },
    });
    const { syncCarriers, shippyproCarrierType } = await import("../app/services/shippypro.server");
    expect((await syncCarriers(world.SHOP)).ok).toBe(true);
    const synced = state.carriers.find((c) => c.shippyproCarrierId === "700");
    expect(synced.name).toBe("DHL main account");
    expect(shippyproCarrierType(synced)).toBe("DHLExpress");
  });
});
