# Shipping Integration Audit ("Shopflo Shipping")

Audit date: 2026-11-27. Read-only: **no shipping API call of any kind was made.**

## 0. Blocking finding: provider mismatch

| Check | Result |
|---|---|
| `shopflo` anywhere in the repo (code, docs, env, config) | **Not found** |
| Shipping provider in code | **ShippyPro** (`app/services/shippypro.server.ts`, `webhooks.shippypro.ts`, Settings → Integrations) |
| Shipping provider in client scope | **ShippyPro** (`docs/scope.md` §1: "ShippyPro integration for carrier routing, return labels, customs and tracking") |
| Shopflo public shipping/label API docs | None found in a web search (2026-11-27). Shopflo is publicly known as a checkout platform. |

So there are two possibilities. **The client/owner must say which one applies before any shipping task starts:**

- **(a) "Shopflo" means ShippyPro** (the existing integration). Everything below in §2–§8 applies directly, and the work is to harden the existing code.
- **(b) Shopflo is a genuinely different provider.** Then a new provider adapter is needed. These are required first: API docs, base URL, auth method, credentials, a test/sandbox statement, and written confirmation of label-without-pickup behaviour. Nothing can be planned in detail until they exist. §9 lists the questions.

Option A ("genuine label, live provider API, dev Shopify order, no pickup/dispatch/charges") is **not authorized to run** until the provider confirms it in writing. If it cannot be confirmed, the agent stops and reports. It must not silently create a real shipment.

---

## 1. Existing ShippyPro integration (what the code does)

| Item | Implementation | Location |
|---|---|---|
| Base URL | `https://api.shippypro.com/v1` default; per-shop `shippyproApiUrl` or `SHIPPYPRO_API_URL` override; legacy URL auto-rewritten | `shippypro.server.ts:8-50` |
| Auth | `Authorization: Bearer <key>`, body `{ Method, Params }`, POST JSON | `shippyproCall` |
| Credential storage | Per-shop, AES-256-GCM encrypted in `Settings.shippyproApiKeyEncrypted` (key from `SHIPPYPRO_ENCRYPTION_KEY` → `SHOPIFY_API_SECRET` → `"dev-only-insecure"`). Only the last 4 characters are shown in the UI. **Falls back to env `SHIPPYPRO_API_KEY` for any shop without its own key** | `crypto.server.ts`, `shippypro.server.ts:23` |
| Secrets in logs/frontend | Key never sent to the client or logged. Raw provider responses are logged into `TrackingEvent.raw` (webhook only) | — |
| Rate limit | Retries HTTP 429 up to 2× honoring `Retry-After` | `shippyproCall` |
| Carrier sync | `GetCarriers` → `Carrier`, `CourierService` | `syncCarriers` |
| Routing | `GetShipmentsReport` finds the original outbound shipment by order number → same carrier. Otherwise the per-market default carrier/service (flags for review) | `findOriginalShipment`, `routingDecision` |
| Return shipment + label | `Ship` with `IsReturn: true`, `Async: false`, `TransactionID = orderNumber`, from = customer, to = warehouse, one parcel, CN22 when warehouse is SE | `createReturnLabel` |
| Label response parsing | `NewOrderID` → `shippyproOrderId`; `PDF`/`LabelURL` → `labelUrl` (first item if array); `TrackingNumber`; `TrackingExternalLink` | `shippypro.server.ts:527-532` |
| Missing label URL | Stops retrying, marks label `failed`, emails admin. **The shipment may still exist at ShippyPro** (not voided) | `:534-537` |
| Cancellation | `VoidShipments { OrderIDS:[id], CarrierName }` → label `voided` | `voidReturnLabel` |
| Pickup | **Not called.** `requestPickup` only stores `ReturnPickup` with `needs_manual_booking` | `:651` |
| Tracking | Unauthenticated `/webhooks/shippypro` → `TrackingEvent` + label status; "delivered/received" sets request `Received` | `webhooks.shippypro.ts` |

## 2. Capability questions for the live API (to be answered by the provider)

"Code" = what the current code shows. "Doc" = from public material. "?" = unknown; must be confirmed by ShippyPro/Shopflo support in writing.

| # | Capability | Status | Evidence / note |
|---|---|---|---|
| 1 | Shipment from manually supplied order details | Code: yes | `Ship` takes free addresses/parcels; `TransactionID` is a free string |
| 2 | Shipment without an order in the live Shopify store | Code: yes | ShippyPro does not query Shopify in this call |
| 3 | Label without scheduling pickup | **?** | The app never calls a pickup API. Whether a *carrier's return service* auto-books a collection depends on the carrier/service and contract |
| 4 | Label without dispatching | **?** | A label alone is not a dispatch, but some carriers bill on label creation, not on first scan |
| 5 | Draft / non-dispatched shipment | **?** | Not used in code |
| 6 | Test shipment with production credentials | **?** | ShippyPro's own API guide says Ship/Edit create **real labels** and recommends testing with the **Generic Carrier** |
| 7 | Label URL / PDF retrieval | Code: yes | `PDF`/`LabelURL` in the Ship response. URL lifetime unknown |
| 8 | Cancel a test shipment | Code: yes (`VoidShipments`) | **?** whether void is free and within what time window per carrier |
| 9 | No billing for label-only test | **?** | Depends on the ShippyPro plan (per-label fee?) and the carrier contract (billed on creation vs scan) |
| — | Idempotency key | **?** | No idempotency parameter used. `TransactionID` is not documented as a dedupe key |

**Request payload actually sent today** (`createReturnLabel`):
```
CarrierID (int), CarrierName, CarrierService, IsReturn: true, TransactionID, Async: false,
ContentDescription,
to_address  { name, company, street1, street2, city, state, zip, country, phone, email:"" }   ← warehouse
from_address{ name, company:"", street1, street2, city, state, zip, country, phone, email }   ← customer
parcels: [{ weight: 1, length: 10, width: 10, height: 10 }]
CN22Info?: [{ Description, Weight: 1, Quantity, UnitValue, OriginCountry, Currency, HSCode }]   ← only if warehouse country = SE
```
**Response fields read:** `NewOrderID`, `PDF | LabelURL | label_url | label`, `TrackingNumber | tracking_number`, `TrackingExternalLink | TrackingURL | tracking_url`, error via `Result != "OK"` / `ErrorMessage`.

## 3. Address mapping

| Field | Pickup / sender (customer) | Return destination (merchant) |
|---|---|---|
| Source | Shopify `order.shippingAddress` (`fetchOrderShippingAddress`) | **Today:** 1) `FromAddress` of the original ShippyPro shipment → 2) Shopify fulfillment **location** address → 3) Settings `warehouseAddressesPerMarket[market]` → `DEFAULT`. **Required:** the configured return address (3) should be primary (D7) |
| Contact name | `shippingAddress.name` → `customerName` → "Customer" | warehouse `name` → "Warehouse" |
| Phone | `shippingAddress.phone` (often empty; **not validated**) | warehouse `phone` |
| Email | `customerEmail` | empty |
| Street / city / postal | `address1/2`, `city`, `zip` | `address1/2` or `address`, `city`, `zip` |
| State | `provinceCode` → `province` | `state`/`province` |
| Country | `countryCodeV2` | `country` (ISO code expected) |
| Market | `order.shippingAddress.countryCodeV2` (used to pick warehouse) | — |
| Weight / dims | Hard-coded 1 kg, 10×10×10 | — |
| Order reference | `TransactionID = orderNumber` (e.g. `#1001`) | — |
| Products | `ContentDescription` = titles; CN22 per item with unit price from `discountedUnitPriceSet` | — |

The customer's order shipping address and the merchant return address are **never** the same object in code. That is correct and must stay this way.

**Mandatory pre-flight validation (to add, task S3):** sender name, street1, city, zip, country, phone (if the carrier requires it); destination name, street1, city, zip, country, phone; parcel weight > 0; carrier + service resolved; CN22 fields when required. Fail before calling the API, never after.

## 4. Option A: confirmed test configuration

| Item | Requirement |
|---|---|
| Shopify store | Development store `bhavik-app-test-5couj1fn.myshopify.com` only |
| Order | Dev-store test order |
| Provider / env | Live credentials, production API |
| Label | Genuine carrier label |
| Pickup / dispatch | **Must not** be triggered |
| Printing | PDF download and print |
| Live client store | No changes, no testing |

### Production API risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Duplicate real shipments (blind retry D1, double-click D2) | **High with current code** | Cost, confusion | S1: single attempt, lock, check-before-create; never auto-retry `Ship` |
| Carrier auto-books collection for return service | Unknown | Courier visit to the test address | Written provider confirmation; choose a drop-off-only service; never use a pickup service |
| Label billed on creation | Unknown | Per-label charge | Written confirmation of billing; budget approval; void immediately after test |
| Void not free / time-limited | Unknown | Charge | Confirm void rules; void in the same session |
| Dev store uses env live key by accident | Possible today (D4) | Unplanned live calls from dev | S2: per-shop key only + shop allowlist + explicit test flag |
| Live store affected | Low (shop-scoped rows) but D3 webhook is cross-shop | Wrong status on a live request | S4: webhook shop scoping and secret |
| Test address is a real third party | — | Parcel/courier to a stranger | Use owner-approved addresses only (sender = test contact, destination = merchant's configured return warehouse or an approved test address) |
| Label failure email to shop owner | Medium | Noise | Redirect to the test recipient in test mode |
| Customer email to a real person | Low (dev store) | — | Test email recipient override |

## 5. Label generation and printing workflow (target)

1. Admin approves (atomic status change Submitted → Approved; only once).
2. The app builds the shipment **draft** (addresses, parcel, carrier/service, references) and validates mandatory fields.
3. **Safety gate** (test mode): shop ∈ allowlist, request flagged `isTest`, operation allowed by `SHIPPING_LIVE_TEST_ENABLED`, addresses approved, no existing non-voided label, no in-flight attempt.
4. Record `ShipmentAttempt{status:"sending", requestPayloadHash}` **before** the call.
5. Call `Ship` **once**. On success, store `shippyproOrderId`, label URL, tracking, raw response (redacted), and mark the attempt `succeeded`.
6. On timeout or unknown result: mark `unknown`, **do not retry**, query `GetShipmentsReport` / `GetOrder` (provider-supported lookup) by `TransactionID` to reconcile, and require admin action.
7. Show the label on the request page: Download, Open in print view, Void.
8. Email the customer (test recipient override in test mode) with the label link.
9. After the test: void through `VoidShipments` and record the outcome.

## 6. Environment configuration (proposal, following existing naming)

The existing naming is `SHIPPYPRO_*`, `EMAIL_*`. Proposed additions (names illustrative):

| Variable | Purpose |
|---|---|
| `SHIPPING_TEST_SHOPS` | Comma list of shop domains allowed to run live-label tests (e.g. the dev store). Any other shop → test features off |
| `SHIPPING_LIVE_TEST_ENABLED` | `true` to allow a real `Ship` call for a test-flagged request. Default `false` |
| `SHIPPYPRO_ALLOW_ENV_KEY_FALLBACK` | Default `false` in production; removes the D4 silent fallback |
| `TEST_EMAIL_RECIPIENT` | All customer/admin emails for test-flagged requests go here |
| `SHIPPYPRO_WEBHOOK_SECRET` | Shared secret / token for the tracking webhook (already listed in scope §4) |

Credentials stay per-shop in the DB (encrypted). The dev store gets the live key entered in *its own* Settings, so the live store never depends on env. **Hard rule:** the live shop domain can never be in `SHIPPING_TEST_SHOPS`.

## 7. Cost and pickup implications (to fill in from provider answers)

| Question | Answer | Source |
|---|---|---|
| ShippyPro fee per label on the client's plan? | ? | ShippyPro account manager |
| Carrier billed at label creation or first scan? | ? | Carrier contract / ShippyPro |
| Does the chosen return service auto-book a collection? | ? | ShippyPro / carrier |
| Void window and cost? | ? | ShippyPro / carrier |
| Is the Generic Carrier acceptable as a stand-in for the live-API test (no real carrier)? | ? | Owner decision |

## 8. Required credentials and permissions

- Written confirmation of the provider (ShippyPro or Shopflo).
- Live API key for the dev-store test (entered in dev-store Settings, not env), plus explicit authorization naming carrier, service, max number of labels and budget.
- Carrier connection ID(s) and service code(s) that are **drop-off** (no collection).
- Approved sender (test contact) and destination addresses.
- Test email recipient.
- Webhook secret if tracking is tested.
- Shopify: no new scopes are required for the label work. Protected customer data access must be configured for dev-store order reading (see testing plan).

## 9. Questions to send to the provider (ShippyPro or Shopflo support)

1. Does `Ship` with `IsReturn: true` for carrier X / service Y book a pickup or collection automatically?
2. Is the label billed on creation or on first carrier scan? Is there a ShippyPro per-label fee on our plan?
3. Can a label be voided via `VoidShipments` at no cost, and within what time?
4. Is there a sandbox, test flag, or test key for production accounts? Is the Generic Carrier the recommended test path?
5. Is there an idempotency mechanism (is `TransactionID` unique-enforced)? How do we look up a shipment after a timeout?
6. How long is the `PDF`/`LabelURL` valid?
7. Mandatory fields per carrier/service (phone, email, state)?
8. How are webhooks authenticated?

Sources consulted: ShippyPro API integration guide (blog: "How ShippyPro API works"), help.shippypro.com "How Ship API works". No Shopflo shipping documentation was found.
