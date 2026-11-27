# Existing App Audit — Grand Le Mar Returns & Exchanges

Audit date: 2026-11-27 · Branch: `main` @ `7354110` · Scope: read-only code review.
No code, schema, scopes, store data, emails or shipping calls were changed or made during this audit.

Related documents in this folder:
- [RETURN_EXCHANGE_FEATURE_MATRIX.md](RETURN_EXCHANGE_FEATURE_MATRIX.md): status of every feature
- [SHOPFLO_SHIPPING_INTEGRATION.md](SHOPFLO_SHIPPING_INTEGRATION.md): shipping provider findings (**read first: the app uses ShippyPro, not Shopflo**)
- [DEVELOPMENT_STORE_TESTING_PLAN.md](DEVELOPMENT_STORE_TESTING_PLAN.md): test strategy and matrix
- [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md): phased tasks and acceptance criteria

---

## 1. Headline findings

1. **There is no Shopflo integration in this codebase.** The only shipping provider is **ShippyPro** (`app/services/shippypro.server.ts`), and the client scope (`docs/scope.md` §1, §6) names ShippyPro. `grep -ri shopflo` returns nothing. See the Shopflo document. The provider must be confirmed before any shipping work.
2. **The end-to-end workflow already exists.** That covers order lookup, item selection, return/exchange/complaint submission, the admin list and detail pages, approve/reject, label generation at approval, the approval email with label link, label download/void, and exchange price-difference payment. Most of the remaining work is correctness and safety, not new features.
3. **Label creation can create duplicate real shipments.** `createReturnLabel` retries the ShippyPro `Ship` call up to 3 times on *any* error, including a network timeout after the shipment was already created. Approve, Regenerate and Retry have no lock or idempotency guard. This must be fixed before any live-API label test (roadmap task S1).
4. **Both stores share one deployment and one database.** `shopify.app.toml` has a single `client_id` and `application_url` (Vercel), and the local `.env` points at a Neon Postgres. Rows are separated only by the `shop` column. Development tests therefore write into the same database the live store uses, so test-mode guards must key on the `shop` domain.
5. **The env-level `SHIPPYPRO_API_KEY` is used for any shop that has no saved per-shop key** (`resolveShippyProApiKey`). A live key in the environment would therefore be used automatically by the dev store, and by any future install.

---

## 2. Architecture

| Area | Finding | Files |
|---|---|---|
| Framework | React Router 7.18.2 (Remix successor) via `@shopify/shopify-app-react-router` ^4, React 18, Vite 6, TypeScript 5.9 | `package.json`, `vite.config.ts` |
| Runtime / deploy | Node ≥ 22.12, deployed to Vercel (`grandlem-return-exchange-app.vercel.app`); Dockerfile also present. `npm run build` runs `prisma migrate deploy` whenever `DATABASE_URL` is set | `package.json`, `Dockerfile` |
| Database / ORM | PostgreSQL (Neon) through Prisma 6. 5 migrations | `prisma/schema.prisma`, `prisma/migrations/*` |
| Auth | Embedded admin uses `authenticate.admin`. Storefront uses `authenticate.public.appProxy` (signed proxy). Background calls use `unauthenticated.admin(shop)` (offline session) | `app/shopify.server.ts`, routes |
| Embedded config | `embedded = true`, Admin API webhooks `2027-01`, events `2026-10` | `shopify.app.toml` |
| Scopes | `read/write_orders, read/write_products, read/write_customers, read/write_draft_orders, read/write_fulfillments, read/write_inventory, read_locations, read_merchant_managed_fulfillment_orders, write_metaobjects(+definitions), write_app_proxy` | `shopify.app.toml` |
| Admin UI | Custom-styled React pages (not Polaris web components) under `/app/*` | `app/routes/app.*.tsx`, `app/styles/grandlemar.css` |
| Storefront UI | **App proxy** `/apps/returns` → `/proxy`. A resource route returns Liquid rendered inside the theme. A legacy standalone `/portal` route also exists | `app/routes/proxy._index.tsx`, `app/services/proxy-returns-route.server.ts`, `app/services/proxy-returns-html.ts`, `app/routes/portal.tsx` |
| Webhooks | `app/uninstalled`, `app/scopes_update`, `orders/paid` (exchange payment completion), Product update event, plus an external ShippyPro tracking webhook | `app/routes/webhooks.*` |
| Email | Resend (`RESEND_API_KEY`, `EMAIL_FROM` / per-shop `emailFrom`), webhook fallback, otherwise a console warning reported as failure. DB templates per event/language, shared HTML layout | `app/services/email.server.ts`, `email-templates.server.ts`, `email-layout.ts` |
| Shipping | ShippyPro REST (`https://api.shippypro.com/v1/{Method}`, Bearer key). Per-shop encrypted key (AES-256-GCM) with env fallback | `app/services/shippypro.server.ts`, `crypto.server.ts` |
| Extensions | None (`extensions/` holds only `.gitkeep`) | — |
| Tests | Vitest: `tests/proxy-returns.test.ts` (storefront flow, Shopify and DB faked) and `tests/return-form-customization.test.ts`. **No tests cover the label, approval or email services** | `tests/` |

### Environment variables actually read by the code
`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `SHOP_CUSTOM_DOMAIN`, `NODE_ENV`, `RESEND_API_KEY`, `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_WEBHOOK_URL`, `SHIPPYPRO_API_KEY`, `SHIPPYPRO_API_URL`, `SHIPPYPRO_ENCRYPTION_KEY`, `SHIPPYPRO_FAILURE_EMAIL`, `SMS_WEBHOOK_URL`.
There is no store-mode or test-mode variable today.

---

## 3. Data model (relevant tables)

| Model | Purpose | Notes |
|---|---|---|
| `ReturnRequest` | One request per submission. `type` return/exchange/complaint, free-text `status`, `approvedAt`, `approvalEmailSentAt`, `rejectedAt`, `market`, `fulfillmentLocationId`, `requestNumber` | `status` is a free string, not an enum. `requestNumber` = `GLM-{1001+count}`, which is race-prone and has no unique constraint |
| `ReturnItem` | Selected line items: `shopifyLineItemId`, `variantId`, `quantity`, `reasonId`, `comment`, `replacementVariantId`, `priceDifferenceStr` | Links the request to the original order lines |
| `ReturnPhoto` | Photos stored as **data URLs in the DB** | Large rows |
| `ReturnLabel` | **1:1** with request: `shippyproOrderId`, `connectionId`, `service`, `labelUrl`, `trackingNumber`, `trackingUrl`, `status` (pending/created/failed/voided/…), `customsData` | Unique on `returnRequestId`. A regenerated label overwrites the previous one, so earlier shipment IDs are lost |
| `TrackingEvent` | ShippyPro webhook events | |
| `ReturnPickup` | Pickup requests, always `needs_manual_booking` | No API booking |
| `Carrier`, `CourierService` | Synced from ShippyPro `GetCarriers` | |
| `Settings` | Per shop: deadlines, auto-approve, label timing per market, default carrier per market, **warehouse address per market**, ShippyPro key (encrypted) | JSON stored in string columns |
| `EmailTemplate` | event × language | Events: received, approved, rejected, refund_issued, payment_required |

---

## 4. Workflow as implemented (step by step)

| # | Required step | Implemented? | Where |
|---|---|---|---|
| 1 | Customer opens return app | Yes: `/apps/returns` (proxy) and legacy `/portal` | `proxy-returns-route.server.ts:handleProxyLoader` |
| 2 | Select an order | Yes. **Logged in:** last 20 non-cancelled orders of the signed `logged_in_customer_id`. **Guest:** order number + email | `portal.server.ts:listCustomerOrders`, `lookupOrderForCustomer`, `lookupAndValidateOrderBasic` |
| 3 | Select products | Yes: checkbox per line, quantity, reason, comment, photos | `proxy-returns-route.server.ts:orderFoundScreen/detailsScreen` |
| 4 | Return or exchange | Yes (plus complaint), with resolution choice per settings | `requestTypeRadios`, `proxy-resolutions.server.ts` |
| 5–6 | Submit and save | Yes, revalidated server-side from a signed order token | `handleSubmit` → `returns.server.ts:createReturnRequest` |
| 7 | Admin reviews | Yes: list (search, pagination) and detail | `app.returns.tsx`, `app.returns_.$id.tsx` |
| 8 | Approve / reject | Yes. Reject sends an email with a reason. Optional auto-approve setting | `app.returns_.$id.tsx` action `approve` / `reject` |
| 9 | Email after approval | Yes. The approval email is sent **only if a label URL exists**. On failure the admin sees "Retry label & email" | `sendApprovedReturnEmail` (`app.returns_.$id.tsx:178`) |
| 10 | Generate label | Yes, **via ShippyPro** `Ship` with `IsReturn: true` | `shippypro.server.ts:createReturnLabel` |
| 11 | Customer gets label | Yes: `{{labelLink}}` in the approved email. It is also shown on the confirmation screen when the label was created at submit | `email-templates.server.ts`, `proxy-returns-route.server.ts:1122` |
| 12 | Print label | Partly: a "Download shipping label" link opens the **external ShippyPro URL**. There is no in-app print view or stored PDF | `app.returns_.$id.tsx:948` |
| 13 | Exchange flow | Yes: set replacement variants, price difference, draft-order invoice or free completion, `orders/paid` webhook | `exchanges.server.ts`, `webhooks.orders.paid.tsx` |

---

## 5. Defects and limitations found

Severity: **H** = can cause real cost, data leak or wrong shipment; **M** = wrong behaviour; **L** = polish.

| # | Sev | Finding | Location |
|---|---|---|---|
| D1 | H | **Blind retry of `Ship`.** The outer loop retries up to 3× on any exception. A timeout, JSON parse error or DB error *after* ShippyPro created the shipment produces another real shipment. | `shippypro.server.ts:404-578` |
| D2 | H | **No duplicate-label guard.** `regenerate_label` always calls `Ship` even when a `created` label exists, and does not void the old one. Approve and Retry check only `labelUrl`. Concurrent clicks race. `ReturnLabel` is 1:1, so the earlier shipment ID is overwritten and becomes unvoidable from the app. | `app.returns_.$id.tsx:181-188, 260`; `shippypro.server.ts:539` |
| D3 | H | **ShippyPro webhook is unauthenticated and not shop-scoped.** Anyone can POST events. A lookup by `orderNumber` with no `shop` filter can update a request belonging to *another store* (live vs dev share the DB). | `webhooks.shippypro.ts` |
| D4 | H | **Shared deployment/DB plus env-key fallback.** The dev store can silently use a production ShippyPro key from env. Nothing distinguishes test requests from real ones. | `shippypro.server.ts:23-34`, `shopify.app.toml` |
| D5 | M | **Approve has no status guard.** It can approve a Rejected or already-Approved request, which can trigger another label and email. | `app.returns_.$id.tsx:226` |
| D6 | M | **Exchange approval sends the *return* email and creates a return label** through the same path. There is no exchange-specific approved template. | `app.returns_.$id.tsx:178-235` |
| D7 | M | **Configured return destination is shadowed.** Destination priority is (1) warehouse from the original ShippyPro shipment, (2) Shopify **fulfillment location** address, then (3) per-market warehouse address from Settings. The merchant-configured return address is used only when (1) and (2) are missing. | `shippypro.server.ts:434-447` |
| D8 | M | **Parcel is hard-coded** to 1 kg, 10×10×10. CN22 weight is also 1 per line. | `shippypro.server.ts:510, 514` |
| D9 | M | **Pickup (sender) address = order shipping address.** The customer cannot confirm or edit it, and the phone is often empty. There is no validation of mandatory fields before the API call. | `shippypro.server.ts:498-509` |
| D10 | M | **Eligibility works per line, not per quantity.** Any earlier request containing a line excludes the whole line (partial returns lock out the rest). Rejected requests still count. For `type=return`, any existing return request blocks the whole order. Quantity is checked against the original `quantity`, not refundable/fulfilled quantity. | `portal.server.ts:80-87, 209-235`; `proxy-returns-route.server.ts:1667` |
| D11 | M | **Customs rule:** `isSweden` is true when the *warehouse* is in Sweden, so every return to SE (including SE→SE) requires HS code and origin and fails without them. This needs client confirmation (customs only for non-EU origins such as UK/US?). | `shippypro.server.ts:451-476` |
| D12 | M | `customerName` is set to the customer **email** in approve/reject emails. Language is hard-coded `en` in admin actions. | `app.returns_.$id.tsx:193, 253-254` |
| D13 | M | Auto-approve path sends the "approved" email but never sets `approvalEmailSentAt`, so the admin shows a false "Approval email has not been sent" banner. It also creates labels at submit when label timing = immediate (before any review). | `proxy-returns-route.server.ts:1737-1758` |
| D14 | M | Legacy `/portal` route trusts a **posted `shop`** (no proxy signature) and is still routable. | `app/routes/portal.tsx:31` |
| D15 | L | `requestNumber` is count-based (duplicates under concurrency, no unique index). | `returns.server.ts:30-31` |
| D16 | L | The label URL is stored only as an external ShippyPro link. URL lifetime is unknown, and no copy is kept. | `ReturnLabel.labelUrl` |
| D17 | L | `lineItems(first: 50)`, `orders(first: 20)`. No `read_all_orders`, so orders older than 60 days are invisible. | `portal.server.ts` |
| D18 | L | The Shopify **Returns API** (`returnCreate`, reverse fulfillment orders) is not used, so returns do not appear on the Shopify order's Returns. `read_returns`/`write_returns` scopes are absent. Optional; see roadmap. | — |
| D19 | L | No automated tests for label, approval or email services. | `tests/` |

---

## 6. Shopify API ownership (as implemented)

| Responsibility | Owner | Operations used |
|---|---|---|
| Order and product data | Shopify Admin GraphQL | `orders(query:)`, `order(id:)`, `customer.orders`, `nodes(ProductVariant)`, `location(id:)`, `shop.email` |
| Return request and approval | **App DB** (Prisma) | — (no Shopify return object is created) |
| Shipment and label | **ShippyPro** | `Ship` (IsReturn), `VoidShipments`, `GetCarriers`, `GetShipmentsReport` |
| Label storage and delivery | App DB (URL only) + Resend email | — |
| Refund | Shopify | `refundCreate` |
| Restock | Shopify | `inventoryAdjustQuantities` |
| Exchange / replacement | Shopify | `draftOrderCreate`, `draftOrderComplete`, invoice URL; `orders/paid` webhook |
| Store credit | Shopify | `giftCardCreate` |
| Shopify return/fulfillment sync | **Not implemented** | — |

Shopify does not generate ShippyPro/Shopflo carrier labels. Label generation belongs entirely to the shipping provider. No Shopify fulfillment or reverse-fulfillment record is created by the label flow.

---

## 7. Development store constraint: "no readable orders"

The likely cause, to be verified in the Partner Dashboard, is **protected customer data**. Without "Protected customer data access" (name, email, address fields) configured for the app, Admin API order queries return restricted or null customer fields. The portal's email match (`node.email`) then fails, and orders look unreadable. For development stores this access can be selected in the Partner Dashboard under *API access → Protected customer data* without App Store review. This is a configuration step, not a code change. See the testing plan.
