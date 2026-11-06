# Grand Le Mar Returns App – Cursor Build Guide

> This file is the single source of truth for building this app with Cursor.
> Read it fully before writing code. Build **one phase at a time**, in order.
> Do not start a new phase until the current phase's "Done when" checklist passes.

---

## 1. What We Are Building

A custom Shopify app for **Grand Le Mar** (grandlemar.com) that handles:

- A **customer returns portal** (EN + SV) where customers submit returns, exchanges and complaints
- An **admin panel** (EN only) inside Shopify Admin to approve/reject requests and manage labels
- **ShippyPro** integration for carrier routing, return labels, customs and tracking
- **Exchanges** with Shopify invoice links for price differences
- **Restocking**, **deadlines**, **exclusion rules** and **email notifications**

**Extension (Phases 10–15):**
- **Required photos + comments** on every claim (complaint)
- **Receiving & inspection** step in the warehouse
- **Refund processing** through Shopify
- **Store credit + refund deflection** (offer exchange or store credit before a refund)
- **EU withdrawal function** (Directive (EU) 2023/2673)
- **Analytics dashboard**

**Extension 2 (Phases 16–19):**
- **Complaint resolution flow** (customer chooses / always replacement / always refund, free replacement orders)
- **Advanced exchanges** (inventory reservation, ship now or wait, store credit when unavailable, per-item admin resolution)
- **Smart refunds** (bundle- and discount-aware)
- **Portal & label upgrades** (embeddable form, QR/SMS/PDF labels, "what happens next" page)

Budget: 150–160 hours (Phases 0–9) + ~65 hours (Phases 10–15) + ~40 hours (Phases 16–19). Keep solutions simple. No features outside this file.

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| App framework | Shopify app template (React Router / Remix), TypeScript |
| Admin UI | Shopify Polaris (embedded app via App Bridge) |
| Customer portal | Shopify **App Proxy** (`/apps/returns`) rendering portal routes |
| Database | PostgreSQL + Prisma ORM |
| Background jobs | BullMQ + Redis |
| File uploads | S3-compatible storage (signed upload URLs) |
| Email | Transactional provider (Resend / SendGrid – configurable via env) |
| i18n | JSON translation files (`en.json`, `sv.json`) |
| Validation | Zod |
| Testing | Vitest (unit), Playwright (portal E2E) |

> If the Shopify CLI template differs from the above (e.g. React Router vs Remix), follow the template's current conventions.

---

## 3. Project Structure

```
app/
  routes/
    app._index.tsx                  # Admin dashboard (returns list)
    app.returns.$id.tsx             # Admin return detail
    app.settings.tsx                # General settings + deadlines + label timing
    app.settings.reasons.tsx        # Return reasons
    app.settings.exclusions.tsx     # Exclusion rules
    app.settings.emails.tsx         # Email templates
    app.settings.carriers.tsx       # ShippyPro carriers + routing rules
    app.extensions.tsx              # Order-specific deadline extensions
    app.inspection.tsx              # Warehouse receiving & inspection queue
    app.analytics.tsx               # Analytics dashboard
    app.settings.resolutions.tsx    # Store credit, deflection, refund settings
    proxy.returns._index.tsx        # Portal: order lookup
    proxy.returns.resolution.tsx    # Portal: refund deflection offer
    proxy.withdraw._index.tsx       # EU withdrawal function (form)
    proxy.withdraw.confirm.tsx      # EU withdrawal confirmation step
    proxy.returns.request.tsx       # Portal: item selection + submit
    proxy.returns.confirmation.tsx  # Portal: confirmation
    webhooks.shippypro.tsx          # ShippyPro webhook receiver
    webhooks.shopify.*.tsx          # Shopify webhooks (orders/paid for invoices, app/uninstalled)
  services/
    shopify/
      orders.server.ts              # Order lookup + validation
      inventory.server.ts           # Restock
      draftOrders.server.ts         # Exchange invoices
    shippypro/
      client.server.ts              # API client, auth, rate limit
      carriers.server.ts            # GetCarriers sync
      shipments.server.ts           # GetShippedOrders lookup
      labels.server.ts              # Ship (IsReturn=true), void, regenerate
      routing.server.ts             # Carrier routing rules
      customs.server.ts             # Customs payload builder
    returns/
      eligibility.server.ts         # Deadlines, extensions, exclusions (shared!)
      workflow.server.ts            # Status transitions
      restock.server.ts             # Restock rules
      exchange.server.ts            # Exchange + price difference
      inspection.server.ts          # Receiving & condition checks
      refunds.server.ts             # Shopify refunds
      storeCredit.server.ts         # Store credit / gift card issuing
      deflection.server.ts          # Offer exchange/store credit before refund
      withdrawal.server.ts          # EU withdrawal function
    analytics/
      analytics.server.ts           # Dashboard queries
    email/
      sender.server.ts
      templates.server.ts
    storage/
      uploads.server.ts
  jobs/
    queue.server.ts
    createLabel.job.ts
    sendEmail.job.ts
    syncCarriers.job.ts
    issueRefund.job.ts
    issueStoreCredit.job.ts
    dailyOrderStats.job.ts
  components/admin/analytics/       # Dashboard widgets + palette.ts
  i18n/
    en.json
    sv.json
    index.ts
  components/
    portal/                         # Customer portal UI (styled like grandlemar.com)
    admin/                          # Polaris admin components
prisma/
  schema.prisma
tests/
```

---

## 4. Coding Rules (follow always)

1. **TypeScript strict mode.** No `any` unless commented why.
2. **All server logic in `services/`**, never directly in route files. Routes only parse input, call services, return data.
3. **Validate every input with Zod** (portal forms, admin actions, webhooks).
4. **Eligibility checks live in ONE place:** `returns/eligibility.server.ts`. Both portal and API must call it. Never duplicate deadline/exclusion logic.
5. **Status changes only via `returns/workflow.server.ts`.** It enforces allowed transitions and writes an audit entry.
6. **ShippyPro calls only via `shippypro/client.server.ts`** (handles auth, rate limit, retries, logging).
7. **Label creation always runs as a background job**, never inline in a request.
8. **No hard-coded customer-facing text.** All portal strings come from `i18n/*.json`. Admin is English only and may use plain strings.
9. **Money as integer minor units** (öre/pence/cents) + currency code. Never floats.
10. **Store Shopify IDs as GIDs** (`gid://shopify/Order/123`).
11. **Secrets only in env vars.** Never log API keys, customer emails in full, or label PDFs.
12. **Every service function gets a unit test** for its main paths and edge cases.
13. Keep components small. Match grandlemar.com styling in the portal; use Polaris in admin.

---

## 5. Environment Variables

```
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SCOPES=read_orders,write_orders,read_products,read_inventory,write_inventory,read_customers,write_draft_orders,read_draft_orders,read_locations,read_fulfillments,read_store_credit_accounts,write_store_credit_account_transactions,write_gift_cards,read_gift_cards
SHOPIFY_APP_URL=
DATABASE_URL=
REDIS_URL=
SHIPPYPRO_API_KEY=
SHIPPYPRO_API_URL=https://www.shippypro.com/api/v1
SHIPPYPRO_WEBHOOK_SECRET=
STORAGE_BUCKET=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_ENDPOINT=
EMAIL_PROVIDER=
EMAIL_API_KEY=
EMAIL_FROM=
ADMIN_ALERT_EMAIL=
SMS_PROVIDER=
SMS_API_KEY=
SMS_SENDER_NAME=
```

> Confirm final Shopify scopes against features actually used. Verify ShippyPro endpoint, auth and method payloads against the official ShippyPro API docs before implementing.

---

## 6. Data Model (Prisma)

```prisma
enum RequestType   { RETURN EXCHANGE COMPLAINT }
enum ReturnStatus  {
  SUBMITTED
  PENDING_APPROVAL
  APPROVED
  REJECTED
  LABEL_PENDING
  LABEL_CREATED
  LABEL_FAILED
  IN_TRANSIT
  RECEIVED
  INSPECTED
  REFUND_PENDING
  REFUNDED
  CREDIT_ISSUED
  AWAITING_PAYMENT
  PAID
  COMPLETED
  CANCELLED
}
enum LabelTiming   { IMMEDIATE AFTER_APPROVAL }
enum RestockMode   { AUTO_BY_REASON MANUAL }
enum ExclusionTarget { COLLECTION PRODUCT VARIANT }
enum Resolution    { REFUND EXCHANGE_VARIANT STORE_CREDIT REPLACEMENT }
enum ComplaintResolutionMode { CUSTOMER_CHOOSES ALWAYS_REPLACEMENT ALWAYS_REFUND }
enum ExchangeShipTiming      { SHIP_IMMEDIATELY AFTER_IN_TRANSIT AFTER_INSPECTED }
enum ItemStatus    { INCOMING RECEIVED APPROVED REJECTED RESOLVED }
enum ItemCondition { AS_NEW USED DAMAGED WRONG_ITEM MISSING }
enum CreditMethod  { STORE_CREDIT GIFT_CARD }

model Shop {
  id        String   @id @default(cuid())
  domain    String   @unique
  settings  Settings?
  createdAt DateTime @default(now())
}

model Settings {
  id                   String      @id @default(cuid())
  shopId               String      @unique
  shop                 Shop        @relation(fields: [shopId], references: [id])
  returnDeadlineDays   Int         @default(30)
  exchangeDeadlineDays Int         @default(30)
  complaintDeadlineDays Int        @default(365)
  restockMode          RestockMode @default(AUTO_BY_REASON)
  // Phase 10 – claim evidence
  claimRequiresPhoto       Boolean @default(true)
  claimMinPhotos           Int     @default(1)
  claimMinCommentLength    Int     @default(20)
  // Phase 12 – refunds
  autoRefundOnInspection   Boolean @default(false)
  refundShippingCost       Boolean @default(false)
  // Phase 13 – store credit & deflection
  deflectionEnabled        Boolean      @default(true)
  storeCreditEnabled       Boolean      @default(true)
  storeCreditMethod        CreditMethod @default(STORE_CREDIT)
  storeCreditBonusPercent  Int          @default(0)
  issueCreditOn            String       @default("INSPECTED") // SUBMITTED | IN_TRANSIT | INSPECTED
  // Phase 16 – complaints
  complaintResolutionMode  ComplaintResolutionMode @default(CUSTOMER_CHOOSES)
  complaintRequireItemReturn Boolean    @default(true)
  // Phase 17 – exchanges
  exchangeShipTiming       ExchangeShipTiming @default(AFTER_INSPECTED)
  exchangeReserveDays      Int          @default(30)
  offerCreditWhenUnavailable Boolean    @default(true)
  // Phase 18 – smart refunds
  clawBackFreeItems        Boolean      @default(true)
  // Phase 19 – labels
  smsLabelEnabled          Boolean      @default(false)
  requestNumberPrefix      String       @default("GLM")
  markets              MarketSetting[]
}

model MarketSetting {
  id                String      @id @default(cuid())
  settingsId        String
  settings          Settings    @relation(fields: [settingsId], references: [id])
  marketCode        String      // e.g. SE, GB, US, EU
  labelTiming       LabelTiming @default(AFTER_APPROVAL)
  defaultCarrierId  String?     // ShippyPro Carrier ID fallback
  defaultService    String?
  warehouseAddress  Json        // return recipient address
  shopifyLocationId String?     // for restock
  @@unique([settingsId, marketCode])
}

model ReturnReason {
  id          String      @id @default(cuid())
  shopId      String
  labelEn     String
  labelSv     String
  type        RequestType
  autoRestock Boolean     @default(false)  // ignored for COMPLAINT
  requiresPhoto Boolean   @default(false)
  sortOrder   Int         @default(0)
  active      Boolean     @default(true)
}

model ExclusionRule {
  id              String          @id @default(cuid())
  shopId          String
  target          ExclusionTarget
  shopifyId       String          // collection / product / variant GID
  title           String
  excludeReturn   Boolean         @default(true)
  excludeExchange Boolean         @default(true)
}

model DeadlineExtension {
  id             String      @id @default(cuid())
  shopId         String
  orderId        String      // Shopify order GID
  orderName      String      // #1001
  type           RequestType
  extendedUntil  DateTime
  note           String?
  createdAt      DateTime    @default(now())
  @@unique([shopId, orderId, type])
}

model ReturnRequest {
  id              String       @id @default(cuid())
  shopId          String
  orderId         String
  orderName       String
  customerEmail   String
  customerName    String
  marketCode      String
  locale          String       @default("en")
  type            RequestType
  status          ReturnStatus @default(SUBMITTED)
  flaggedForReview Boolean     @default(false)
  flagReason      String?
  rejectionReason String?
  countryCode     String?      // shipping country, for analytics
  requestedResolution Resolution? // what the customer first chose
  finalResolution     Resolution? // what actually happened
  deflectionOffered   Boolean    @default(false)
  deflectionAccepted  Boolean?
  isWithdrawal        Boolean    @default(false) // created via EU withdrawal function
  requestNumber       String?    @unique  // e.g. GLM-1001, shown to customer + admin
  itemReturnRequired  Boolean    @default(true) // false = complaint resolved without return label
  replacementOrderId  String?    // free replacement order for complaints
  customerPhone       String?    // for SMS label delivery
  carrierId       String?
  carrierService  String?
  items           ReturnItem[]
  labels          ReturnLabel[]
  events          AuditEvent[]
  exchange        Exchange?
  refunds         Refund[]
  storeCredit     StoreCreditIssue?
  withdrawal      WithdrawalNotice?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  @@index([shopId, status])
  @@index([shopId, orderName])
}

model ReturnItem {
  id             String   @id @default(cuid())
  requestId      String
  request        ReturnRequest @relation(fields: [requestId], references: [id])
  lineItemId     String
  variantId      String
  productTitle   String
  variantTitle   String?
  sku            String?
  quantity       Int
  unitPriceMinor Int
  currency       String
  reasonId       String
  comment        String?
  photos         ReturnPhoto[]
  restock        Boolean?   // null = undecided (manual mode)
  restockedAt    DateTime?
  inspection     InspectionResult?
  itemStatus     ItemStatus  @default(INCOMING)
  itemResolution Resolution? // per-item override by admin ("resolve differently")
  itemRejectionReason String?
  refundAdjustmentMinor Int  @default(0) // bundle / free-item claw-back (negative)
  refundAdjustmentNote  String?
}

model ReturnPhoto {
  id         String   @id @default(cuid())
  itemId     String
  item       ReturnItem @relation(fields: [itemId], references: [id])
  storageKey String
  createdAt  DateTime @default(now())
}

model ReturnLabel {
  id             String   @id @default(cuid())
  requestId      String
  request        ReturnRequest @relation(fields: [requestId], references: [id])
  carrierId      String
  carrierName    String
  service        String
  shippyproOrderId String?
  trackingNumber String?
  trackingUrl    String?
  labelUrl       String?
  status         String   // CREATED / FAILED / VOIDED
  errorMessage   String?
  attempts       Int      @default(0)
  qrCodeUrl      String?  // label-less QR return, when the carrier supports it
  smsSentAt      DateTime?
  trackingEvents TrackingEvent[]
  createdAt      DateTime @default(now())
}

model TrackingEvent {
  id        String   @id @default(cuid())
  labelId   String
  label     ReturnLabel @relation(fields: [labelId], references: [id])
  status    String
  rawPayload Json
  occurredAt DateTime
}

model Exchange {
  id                 String   @id @default(cuid())
  requestId          String   @unique
  request            ReturnRequest @relation(fields: [requestId], references: [id])
  replacementVariantId String
  originalValueMinor Int
  replacementValueMinor Int
  differenceMinor    Int
  currency           String
  draftOrderId       String?
  invoiceUrl         String?
  paidAt             DateTime?
  fulfilledOrderId   String?
  reservedUntil      DateTime?  // draft order inventory reservation
  shipTiming         ExchangeShipTiming?
  shippedAt          DateTime?
}

model Carrier {
  id          String  @id @default(cuid())
  shopId      String
  carrierId   String  // ShippyPro Carrier ID (unique connection)
  carrierName String
  label       String?
  services    Json
  active      Boolean @default(true)
  @@unique([shopId, carrierId])
}

model RoutingRule {
  id                String  @id @default(cuid())
  shopId            String
  originalCarrierId String?  // match by original connection
  originalService   String?
  marketCode        String?  // match by market (e.g. SE → DHL Freight)
  returnCarrierId   String
  returnService     String
  priority          Int      @default(0)
}

model EmailTemplate {
  id       String @id @default(cuid())
  shopId   String
  event    String // REQUEST_RECEIVED, APPROVED, REJECTED, PAYMENT_REQUIRED
  locale   String // en, sv
  subject  String
  body     String // supports {{variables}}
  @@unique([shopId, event, locale])
}

model AuditEvent {
  id        String   @id @default(cuid())
  requestId String
  request   ReturnRequest @relation(fields: [requestId], references: [id])
  actor     String   // "customer", "system", or staff email
  action    String
  fromStatus ReturnStatus?
  toStatus   ReturnStatus?
  data      Json?
  createdAt DateTime @default(now())
}

// ---------- Extension models (Phases 10–15) ----------

model InspectionResult {
  id          String        @id @default(cuid())
  itemId      String        @unique
  item        ReturnItem    @relation(fields: [itemId], references: [id])
  condition   ItemCondition
  approvedQty Int
  note        String?
  photoKeys   Json?         // warehouse photos
  inspectedBy String
  inspectedAt DateTime      @default(now())
}

model Refund {
  id              String   @id @default(cuid())
  requestId       String
  request         ReturnRequest @relation(fields: [requestId], references: [id])
  shopifyRefundId String?
  amountMinor     Int
  currency        String
  includesShipping Boolean @default(false)
  status          String   // PENDING / SUCCEEDED / FAILED
  errorMessage    String?
  issuedBy        String   // staff email or "system"
  createdAt       DateTime @default(now())
}

model StoreCreditIssue {
  id              String       @id @default(cuid())
  requestId       String       @unique
  request         ReturnRequest @relation(fields: [requestId], references: [id])
  method          CreditMethod
  baseAmountMinor Int
  bonusMinor      Int
  totalMinor      Int
  currency        String
  shopifyTransactionId String?
  giftCardId      String?
  status          String       // PENDING / ISSUED / FAILED
  errorMessage    String?
  createdAt       DateTime     @default(now())
}

model WithdrawalNotice {
  id                     String   @id @default(cuid())
  shopId                 String
  requestId              String?  @unique
  request                ReturnRequest? @relation(fields: [requestId], references: [id])
  orderName              String
  customerName           String
  customerEmail          String
  scope                  Json     // whole order or selected line items
  submittedAt            DateTime @default(now())
  acknowledgementSentAt  DateTime?
  acknowledgementContent String?  // exact copy of the acknowledgement sent
}

model DailyOrderStat {
  id              String   @id @default(cuid())
  shopId          String
  date            DateTime @db.Date
  marketCode      String
  fulfilledOrders Int
  @@unique([shopId, date, marketCode])
}
```

---

## 7. Status Workflow

```
SUBMITTED ──► PENDING_APPROVAL ──► APPROVED ──► LABEL_PENDING ──► LABEL_CREATED ──► IN_TRANSIT ──► RECEIVED ──► COMPLETED
                   │                                  │
                   ▼                                  ▼
               REJECTED                          LABEL_FAILED ──(retry/manual)──► LABEL_PENDING

Exchange with higher price:
APPROVED ──► AWAITING_PAYMENT ──► PAID ──► (label + fulfillment) ──► COMPLETED
```

- If market `labelTiming = IMMEDIATE`: on submit → `LABEL_PENDING` immediately (request still visible for admin review).
- If `AFTER_APPROVAL`: label job is queued only when admin approves.
- `CANCELLED` allowed from any non-final state by admin.

**Extension (Phases 11–13):**

```
RECEIVED ──► INSPECTED ──┬─► REFUND_PENDING ──► REFUNDED ──► COMPLETED
                         ├─► CREDIT_ISSUED ──────────────► COMPLETED
                         └─► (exchange fulfillment) ─────► COMPLETED
```

- `finalResolution` is set when the request reaches `COMPLETED`.
- Store credit may be issued earlier (`SUBMITTED` or `IN_TRANSIT`) if `issueCreditOn` says so.
- Refunds are never issued before `INSPECTED` unless an admin overrides (audit event required).

---

## 8. Build Phases

Work through these in order. Each phase lists tasks, then **Done when**.

---

### Phase 0 – Setup (≈8h)

**Tasks**
1. Scaffold with Shopify CLI app template (TypeScript).
2. Add Prisma + PostgreSQL, BullMQ + Redis, Zod, Vitest.
3. Add the Prisma schema from Section 6 and run the first migration.
4. Configure App Proxy: subpath `apps/returns` → `/proxy/returns`.
5. Create `shippypro/client.server.ts` with auth, a single `call(method, params)` function, logging and error typing.
6. Create `jobs/queue.server.ts` and a worker entry point.
7. Add `.env.example` with all vars from Section 5.

**Done when**
- [ ] App installs on the dev store and loads in Shopify Admin
- [ ] `/apps/returns` on the storefront returns a test page
- [ ] A test ShippyPro `GetCarriers` call succeeds
- [ ] A test job runs through the queue

---

### Phase 1 – Settings, Deadlines, Exclusions (≈18h)

**Tasks**
1. `app.settings.tsx`: return / exchange / complaint deadlines, restock mode, per-market label timing, warehouse address, default carrier, Shopify location.
2. `app.settings.reasons.tsx`: CRUD + reorder, EN/SV labels, type, auto-restock, requires-photo.
3. `app.settings.exclusions.tsx`: add collection / product / variant via Shopify resource picker; toggles for return/exchange.
4. `app.extensions.tsx`: search order by number, set extended deadline per type.
5. `returns/eligibility.server.ts`:
   - `getDeadline(order, type)` → uses extension if present, else settings, counted from fulfillment date (fallback: order date)
   - `isItemExcluded(variant, product, collections, type)`
   - `getEligibleItems(order, type)` → excludes already-returned quantities
   - Returns typed reasons for ineligibility (used for portal errors)

**Done when**
- [ ] All settings save and reload
- [ ] Unit tests cover: deadline expired, extension active, excluded variant/product/collection, partially returned item

---

### Phase 2 – Portal: Order Lookup (≈12h)

**Tasks**
1. `proxy.returns._index.tsx`: form with order number + email.
2. `shopify/orders.server.ts`: find order by name; compare email case-insensitively; load line items, fulfillments, market/country, collections.
3. Verify App Proxy signature on every portal request.
4. After successful lookup, create a short-lived signed session token (orderId + email) – never trust order IDs from the client.
5. Error messages (from i18n): not found, email mismatch, not fulfilled, deadline expired, no eligible items.
6. Rate limit lookups per IP + per order number.
7. Portal layout matches grandlemar.com; mobile-first.

**Done when**
- [ ] Valid lookup proceeds; each error case shows the right translated message
- [ ] Tampering with order ID in the request is rejected

---

### Phase 3 – Portal: Request Flow (≈20h)

**Tasks**
1. `proxy.returns.request.tsx`: list eligible items; excluded items shown as disabled with a note.
2. Per item: quantity selector, request type (return / exchange / complaint), reason (filtered by type), optional comment, photo upload (required if reason `requiresPhoto`).
3. Photo upload: signed URL to storage; allow jpg/png/heic/webp; max size from config.
4. Review step → submit → re-run eligibility server-side → create `ReturnRequest` + items in a transaction → audit event.
5. Queue `REQUEST_RECEIVED` email.
6. If market label timing is `IMMEDIATE` → queue label job.
7. `proxy.returns.confirmation.tsx`: summary; label download button when available (poll status), otherwise "label will be emailed after approval".
8. Language switcher EN/SV; default from storefront locale.

**Done when**
- [ ] Full flow works on mobile and desktop in EN and SV
- [ ] Server rejects excluded items even if the client sends them
- [ ] E2E test: lookup → select → submit → confirmation

---

### Phase 4 – ShippyPro Integration (≈30h)

**Tasks**
1. **Carrier sync** (`carriers.server.ts`): `GetCarriers` → upsert `Carrier` by Carrier ID. Admin button + daily job.
2. **Original shipment** (`shipments.server.ts`): `GetShippedOrders` → match by Shopify order name / transaction ID → return original Carrier ID + service.
3. **Routing** (`routing.server.ts`):
   - Match `RoutingRule` by original carrier/service first, then market, by priority
   - Examples to seed: UPS Europe Service Point → UPS Europe Service Point return; FedEx UK → FedEx UK return; SE market → DHL Freight return
   - PostNord: if a PostNord connection exists in ShippyPro, seed PostNord → PostNord return for Nordic markets (SE, DK, NO, FI) – confirm with client
   - Not found → market default carrier + `flaggedForReview = true` with reason
4. **Label creation** (`labels.server.ts`, run in `createLabel.job.ts`):
   - `Ship` with `IsReturn = true`
   - Sender = customer address from order; Recipient = market warehouse
   - Parcel weight/dimensions from variants (fallback defaults in settings)
   - Save label URL, tracking number, tracking link
5. **Customs** (`customs.server.ts`) for GB and US → SE: item description, HS code, country of origin, declared value per item. Read HS code + origin from product metafields (namespace/key configurable).
6. **Void / regenerate**: void where carrier supports it; regenerate creates a new label and marks old one VOIDED.
7. **Webhooks** (`webhooks.shippypro.tsx`): verify, store `TrackingEvent`, map to `IN_TRANSIT` / `RECEIVED`.
8. **Reliability**: rate limiter in client (respect ShippyPro limits), exponential backoff, max 5 attempts, then `LABEL_FAILED` + email to `ADMIN_ALERT_EMAIL`.

**Done when**
- [ ] Each routing example produces the correct carrier
- [ ] UK/US labels include customs data
- [ ] Forced failure triggers retries, then admin alert
- [ ] Webhook updates the request status

---

### Phase 5 – Admin Panel (≈22h)

**Tasks**
1. `app._index.tsx`: Polaris IndexTable; filters for order number, customer, carrier, status, date range; badge for flagged requests; pagination.
2. `app.returns.$id.tsx`:
   - Customer + order info (link to Shopify order)
   - Items, quantities, reasons, comments, photo gallery
   - Carrier + service, labels list, tracking timeline, audit log
3. Actions:
   - Approve → workflow transition (+ label job if `AFTER_APPROVAL`)
   - Reject → modal for reason → `REJECTED` + rejection email
   - Download / regenerate / void label
   - Manual label: choose any synced carrier + service → queue job
   - Restock toggle per item (manual mode, during `PENDING_APPROVAL`)
   - Mark received / complete / cancel
4. `app.settings.carriers.tsx`: list carriers, manage routing rules.

**Done when**
- [ ] All filters work together
- [ ] Every action writes an audit event and updates status correctly

---

### Phase 6 – Exchanges (≈16h)

**Tasks**
1. Portal: when type = EXCHANGE, show replacement variant picker limited to products **in stock at the Shopify location that fulfilled the original order** and not excluded from exchange.
2. `exchange.server.ts`: compute original vs replacement value (minor units, same currency).
3. Difference > 0: create Shopify draft order for the difference, send invoice, save `invoiceUrl`, status `AWAITING_PAYMENT`.
4. Listen for draft order completion / `orders/paid` webhook → `PAID`.
5. After payment (or when difference ≤ 0): create replacement order/fulfillment at the original location.
6. Difference < 0: **do not auto-refund** – flag for admin (pending client decision).

**Done when**
- [ ] Equal price → proceeds without payment
- [ ] Higher price → blocked until invoice is paid, then proceeds
- [ ] Out-of-stock replacement at original location cannot be selected

---

### Phase 7 – Emails (≈8h)

**Tasks**
1. Events: `REQUEST_RECEIVED`, `APPROVED` (with label link/attachment), `REJECTED` (with reason), `PAYMENT_REQUIRED` (invoice link).
2. `app.settings.emails.tsx`: edit subject + body per event per locale; variable list; preview; send test.
3. Variables: `{{customer_name}}`, `{{order_number}}`, `{{items}}`, `{{label_url}}`, `{{tracking_url}}`, `{{rejection_reason}}`, `{{invoice_url}}`.
4. Send via `sendEmail.job.ts` with retries; use the request's locale.
5. Seed default EN + SV templates.

**Done when**
- [ ] Each event sends the right template in the right language
- [ ] Missing variables render empty, never crash

---

### Phase 8 – Restock (≈6h)

**Tasks**
1. `restock.server.ts`:
   - `AUTO_BY_REASON`: restock if reason `autoRestock = true`
   - `MANUAL`: use admin's per-item decision
   - **COMPLAINT is never auto-restocked**
2. Restock on `RECEIVED` (or admin "complete") to the market's Shopify location via inventory adjust.
3. Idempotent: never restock the same item twice (`restockedAt`).

**Done when**
- [ ] Unit tests for each mode + complaint rule
- [ ] Shopify inventory changes match expectations

---

### Phase 9 – Testing & Deployment (≈15h)

**Tasks**
1. E2E per market: SE, GB, US, EU.
2. Routing + fallback, customs, exchange payment, deadline/extension/exclusion tests.
3. Mobile + cross-browser check of portal.
4. EN/SV text review with client.
5. Production: managed Postgres + Redis, worker process, Shopify app deploy, App Proxy on live store, ShippyPro webhook URL set.
6. Write `docs/ADMIN_GUIDE.md` (short, how to use each admin screen).

**Done when**
- [ ] Client UAT signed off
- [ ] Live store processes a real test return end to end

---

## 8b. Extension Phases (10–15)

Build only after Phases 0–9 are signed off. Same rules apply.

| Phase | Name | Est. Hours |
|---|---|---|
| 10 | Required Claim Evidence | 2 |
| 11 | Receiving & Inspection | 7 |
| 12 | Refund Processing | 10 |
| 13 | Store Credit & Refund Deflection | 20 |
| 14 | EU Withdrawal Function (2023/2673) | 8 |
| 15 | Analytics Dashboard | 18 |
| | **Total** | **≈65** |

---

### Phase 10 – Required Claim Evidence (≈2h)

**Tasks**
1. For request type `COMPLAINT`, enforce in `eligibility.server.ts` / submit validation:
   - At least `claimMinPhotos` photos per item (when `claimRequiresPhoto = true`)
   - Comment of at least `claimMinCommentLength` characters
2. Portal: mark fields as required for complaints, show translated validation messages (EN/SV).
3. Admin settings: toggles + numbers for the three settings.

**Done when**
- [ ] A complaint without photo or with a too-short comment is rejected client- and server-side
- [ ] Returns and exchanges are unaffected

---

### Phase 11 – Receiving & Inspection (≈7h)

**Tasks**
1. `app.inspection.tsx`: queue of requests in `IN_TRANSIT` / `RECEIVED`, searchable by order number, tracking number or SKU (works with a barcode scanner typing into the search field).
2. Per item: condition (`ItemCondition`), approved quantity, note, optional warehouse photos.
3. Save → `InspectionResult` per item → status `INSPECTED` → audit event.
4. Restock (Phase 8) now runs on `INSPECTED`, using approved quantity; items marked `DAMAGED` / `WRONG_ITEM` / `MISSING` are never restocked.
5. After inspection, trigger the next step based on resolution: refund (Phase 12), store credit (Phase 13) or exchange fulfillment (Phase 6).

**Done when**
- [ ] Partial approvals (e.g. 1 of 2 items OK) carry through to restock and refund amounts
- [ ] Scanner input finds the request in one step

---

### Phase 12 – Refund Processing (≈10h)

**Tasks**
1. `refunds.server.ts`:
   - Calculate refund from inspected, approved items (unit price × approved qty, minus discounts allocated to the line)
   - Optionally include original shipping (`refundShippingCost`)
   - Use Shopify `refundCreate`; refund to original payment method
2. Run in `issueRefund.job.ts` with retries; idempotency key = request ID + attempt-safe check, never refund twice.
3. Admin detail page: "Issue refund" button showing a calculated preview; admin can lower (never raise above paid) the amount with a required note.
4. If `autoRefundOnInspection = true`: refund automatically when all items are `AS_NEW` / `USED` and approved.
5. Email: new event `REFUND_ISSUED` (EN/SV template).
6. Status: `REFUND_PENDING` → `REFUNDED` → `COMPLETED`; failure → admin alert.

**Done when**
- [ ] Refund amounts match Shopify for full, partial and discounted orders
- [ ] Double-clicking or retrying never creates two refunds

---

### Phase 13 – Store Credit & Refund Deflection (≈20h)

**Tasks**
1. **Settings** (`app.settings.resolutions.tsx`): deflection on/off, store credit on/off, method (Shopify store credit or gift card), bonus %, when to issue credit.
2. **Portal step** (`proxy.returns.resolution.tsx`), shown only when the customer selects a **refund** and `deflectionEnabled = true`:
   - Option A: "Exchange for another size/colour" → goes to the exchange picker (Phase 6)
   - Option B: "Get store credit" showing amount incl. bonus (e.g. "1 000 kr + 100 kr bonus")
   - Option C: "Continue with refund" – always visible, same prominence; never hide or obstruct the refund (consumer-law requirement)
   - Save `requestedResolution`, `deflectionOffered`, `deflectionAccepted`
   - Not shown for complaints or EU withdrawal requests
3. **Issuing credit** (`storeCredit.server.ts`, `issueStoreCredit.job.ts`):
   - Shopify store credit: credit the customer's store credit account (requires customer account)
   - Fallback / alternative: create a Shopify gift card and email the code
   - Amount = approved item value + bonus, in order currency
   - Status `CREDIT_ISSUED`; email event `STORE_CREDIT_ISSUED` (EN/SV)
4. Lower-priced exchange replacement: difference can be issued as store credit (confirm with client – see open questions).
5. Admin detail page: show chosen resolution, allow admin to switch resolution before it is issued.

**Done when**
- [ ] Refund path is never blocked; deflection is skippable in one click
- [ ] Bonus is calculated correctly and shown before the customer confirms
- [ ] Credit is issued once, at the configured stage, and appears on the customer's account / as a gift card

---

### Phase 14 – EU Withdrawal Function, Directive (EU) 2023/2673 (≈8h)

> Directive (EU) 2023/2673 adds an online "withdrawal function" requirement to the Consumer Rights Directive (applicable from 19 June 2026). The client must confirm the exact wording and requirements with legal counsel. Build it configurable.

**Tasks**
1. **Entry point:** a clearly labelled link/button, e.g. "Withdraw from contract here" / Swedish wording approved by client, available throughout the withdrawal period. Add it via theme app extension (footer block) + order status page + order confirmation email link.
2. **Form** (`proxy.withdraw._index.tsx`): only what is needed – name, order number, email for confirmation, and which items (whole order default). **No reason required. No login required.**
3. **Confirmation step** (`proxy.withdraw.confirm.tsx`): summary + a clearly labelled confirm button, e.g. "Confirm withdrawal here".
4. On confirm:
   - Create `WithdrawalNotice` with timestamp
   - Create a linked `ReturnRequest` (`isWithdrawal = true`, type `RETURN`, `requestedResolution = REFUND`)
   - Immediately send an acknowledgement email with the content of the withdrawal and the date/time it was received; store the exact content in `acknowledgementContent`
5. Withdrawal requests skip refund deflection and are flagged in the admin dashboard.
6. Translations EN/SV; wording held in i18n files so legal can change it without code changes.

**Done when**
- [ ] A customer can withdraw in two steps without logging in or giving a reason
- [ ] Acknowledgement email is sent instantly and stored
- [ ] Withdrawal appears in admin as a return request with a "Withdrawal" badge

---

### Phase 15 – Analytics Dashboard (≈18h)

**Tasks**
1. Route `app.analytics.tsx`; filters: date range (7/30/90 days, custom) and market.
2. **KPI cards** with "vs previous period" trend (same-length period before):
   - Return rate = returned orders ÷ fulfilled orders (pts; lower is good)
   - Exchange rate = exchanges ÷ all requests (pts; higher is good) – highlighted card
   - Revenue recovered = value kept via exchanges + store credit + paid price differences (higher is good)
   - Total returns (absolute difference; lower is good)
3. **Top 10 returned items:** donut chart + list (dot, name, bar, %, count), grouped by product, matching colours.
4. **Resolution outcome:** Refund / New product variant / Store credit as % rows with bars (from `finalResolution`).
5. **Returns by country:** horizontal bar chart, top 5 (from `countryCode`).
6. **Extra card:** deflection rate = deflections accepted ÷ deflections offered.
7. `analytics.server.ts`: `getKpis`, `getTopReturnedItems`, `getResolutionOutcomes`, `getReturnsByCountry`, `getDeflectionRate`; Prisma aggregations, loaded with `Promise.all`.
8. `dailyOrderStats.job.ts`: daily fulfilled-order counts from Shopify into `DailyOrderStat` – the dashboard never calls Shopify on page load.
9. Backfill `countryCode` for existing requests.
10. UI: Polaris layout, Recharts charts, white rounded cards, small grey uppercase labels, large bold numbers, fixed 10-colour palette, empty states and skeletons.

**Done when**
- [ ] Loads in under 1s with 10k seeded requests
- [ ] No divide-by-zero when the previous period is empty
- [ ] Works on desktop, tablet and mobile

---

## 8c. Extension Phases 2 (16–19)

Build after Phases 10–15. These phases **extend** earlier phases – change the existing services, do not duplicate them.

| Phase | Name | Extends | Est. Hours |
|---|---|---|---|
| 16 | Complaint Resolution Flow | 3, 10, 12 | 8 |
| 17 | Advanced Exchanges | 6, 13 | 14 |
| 18 | Smart Refunds (Bundle & Discount Aware) | 12 | 8 |
| 19 | Portal & Label Upgrades | 3, 4, 7 | 10 |
| | **Total** | | **≈40** |

---

### Phase 16 – Complaint Resolution Flow (≈8h)

**Tasks**
1. **Settings** (`app.settings.resolutions.tsx`, new "Complaints" section):
   - Resolution flow (radio): *Let customer choose replacement or refund* / *Always replacement* / *Always refund*
   - Toggle: *Require faulty item to be returned*
2. **Portal** (complaint path):
   - Complaint badge on the item card (product image, name, variant, price)
   - "Add photos – helps us process faster" + "Describe the issue" (required, Phase 10 rules)
   - If mode = `CUSTOMER_CHOOSES`: show *Replacement* / *Refund* choice; otherwise show the fixed outcome as information only
   - Replacement only offered if the same variant is in stock at the original fulfilling location; otherwise fall back to refund (or store credit if enabled)
3. **Item return not required** (`complaintRequireItemReturn = false`):
   - No return label is created; `itemReturnRequired = false`
   - Request goes straight to admin review (`PENDING_APPROVAL`)
   - Never restocked
4. **Replacement order** (on admin approval, or after inspection if return required):
   - Create a free replacement order in Shopify (draft order with 100% discount → complete) for the same variant, shipping to the original address, from the original location
   - Save `replacementOrderId`, set `finalResolution = REPLACEMENT`
   - Email event `REPLACEMENT_SENT` (EN/SV)
5. Refund path for complaints uses Phase 12 (no deflection offer on complaints).

**Done when**
- [ ] All three modes behave correctly in the portal
- [ ] With "require return" off, no label is generated and the replacement/refund is issued on approval
- [ ] Replacement orders appear in Shopify at 0 kr and are fulfilled from the original location

---

### Phase 17 – Advanced Exchanges (≈14h)

**Tasks**
1. **Draft order on submit:** when an exchange is submitted, create a Shopify draft order with the replacement item(s) and **reserve inventory** (`reserveInventoryUntil` = now + `exchangeReserveDays`). Save `draftOrderId`, `reservedUntil`.
2. **Ship timing setting** (`exchangeShipTiming`):
   - `SHIP_IMMEDIATELY` – complete the draft order right after submit (and after payment if there is a price difference)
   - `AFTER_IN_TRANSIT` – complete when the carrier reports the return as in transit
   - `AFTER_INSPECTED` – complete after inspection (Phase 11)
   - Admin can override per request ("Send now")
3. **Item unavailable:** if the requested replacement is out of stock at the original location, the portal offers store credit (gift card / store credit, Phase 13) instead of a refund, with "Continue with refund" still visible. Controlled by `offerCreditWhenUnavailable`.
4. **Admin request page redesign:**
   - Header: "Request GLM-1001", created date/time, status badge (e.g. *Incoming*)
   - Tip banner: "A draft order with the exchange item(s) was created in Shopify" + **See draft order** button (opens Shopify admin)
   - Exchange items table: item, reason badge (e.g. *Wrong size*), stock badge (*In stock* / *Out of stock*), "From L / Pink → M / Pink", price (new item vs old price), item status badge
5. **Per-item "Resolve differently"** panel:
   - *Refund the item instead* → item resolution REFUND (Phase 12)
   - *Offer store credit* → item resolution STORE_CREDIT (Phase 13)
   - *Reject selected item* → required reason, item status REJECTED, rejection email for that item
   - Changing an exchange item updates/cancels the draft order line and releases the reservation
6. **Expiry job:** when `reservedUntil` passes and the original was never shipped, cancel the draft order, release stock, notify admin.

**Done when**
- [ ] Reserved stock is not sellable to other customers while the exchange is open
- [ ] Each ship-timing mode completes the draft order at the right moment
- [ ] Per-item resolution changes keep Shopify draft order and app data in sync

---

### Phase 18 – Smart Refunds: Bundle & Discount Aware (≈8h)

**Tasks**
1. Extend `refunds.server.ts`:
   - Use each line's `discountAllocations` so the refund equals what the customer actually paid for that line (order-level discounts spread proportionally)
   - **Bundles:** if the order line belongs to a bundle (line item group / bundle app data), refund the component's share of the bundle price, never the full standalone price
   - **Free items / BXGY:** if returning an item breaks the condition that made another kept item free or discounted, deduct that benefit (`refundAdjustmentMinor`, with a readable note). Controlled by `clawBackFreeItems`
   - Never refund more than the amount paid on the order (minus earlier refunds)
2. **Portal refund summary** before submit: item price, discount/bundle lines marked **Adjusted**, final refund amount; when store credit is offered, show "You'd get X kr" incl. bonus next to it.
3. **Admin:** show the same breakdown; admin can override with a required note (audit event).
4. Unit tests with fixtures: percentage discount, fixed order discount, bundle, buy-X-get-Y, free gift, partial quantity, previous partial refund.

**Done when**
- [ ] Refund previews in portal and admin equal the amount sent to Shopify
- [ ] A customer cannot keep a free/discounted item and get the full price back

---

### Phase 19 – Portal & Label Upgrades (≈10h)

**Tasks**
1. **Embeddable form:** theme app extension with an app block ("Returns form") the client can place on any page, plus an app embed for a floating "Start a return" link. Both open the App Proxy portal.
2. **Label delivery options** (per market / carrier capability):
   - **QR code** for label-less drop-off when the carrier service supports it via ShippyPro (save `qrCodeUrl`)
   - **PDF** download (existing)
   - **SMS** with label/QR link (optional, `smsLabelEnabled`; phone from order or entered in portal). Add `sms/sender.server.ts` behind the provider env vars
   - Hide options a carrier does not support
3. **Request numbers:** generate `requestNumber` as `{prefix}-{sequence}` (e.g. GLM-1001) per shop; show in portal, emails and admin; searchable.
4. **Confirmation page redesign** ("Your return is locked in"):
   - Success icon, carrier name, "label sent to {email}"
   - Tracking ID + QR code + Download PDF
   - **What happens next** numbered steps, adapted to carrier and resolution, e.g.:
     1. Show the QR at any {carrier} drop-off (or print the PDF label)
     2. Pack the item in a mailer or the original box
     3. We'll email you when it reaches our warehouse (usually 2–3 business days)
     4. Refund or store credit is issued after the check
   - All texts in i18n (EN/SV), carrier name and timings as variables
5. **New email event `ITEM_RECEIVED`** sent when the return reaches the warehouse (webhook or inspection).

**Done when**
- [ ] Form block can be added to any page from the theme editor
- [ ] QR / SMS / PDF shown only when supported, and each works
- [ ] Confirmation page matches the steps for the chosen carrier and resolution in EN and SV

---

## 9. Open Questions (do not guess – ask)

1. Lower-priced exchange replacement: refund the difference, store credit or nothing?
2. Store credit method: Shopify store credit (needs customer accounts) or gift cards?
3. Store credit bonus % (if any) and when to issue credit (on submit, in transit, after inspection)?
4. Should refunds be automatic after inspection, or always approved by staff?
5. Refund original shipping cost: yes / no / per market?
6. Exact legal wording (EN/SV) for the EU withdrawal button, confirm button and acknowledgement email.
7. Photo limits (count, size) and minimum comment length for claims?
8. Which markets use `IMMEDIATE` vs `AFTER_APPROVAL` label timing?
9. Where are HS codes and country of origin stored on products?
10. Is PostNord connected in ShippyPro, and for which markets?
11. Exact ShippyPro rate limits and webhook format for this account.
12. Default complaint resolution mode, and should faulty items always be returned?
13. Exchange ship timing: send immediately, when in transit, or after inspection? How many days to reserve stock?
14. Which carriers/services support QR label-less returns through ShippyPro (e.g. PostNord, Bring)?
15. Is SMS label delivery wanted? Which SMS provider?
16. Which bundle app and discount types (BXGY, free gifts) does the store use?
17. Request number prefix (default "GLM")?
18. Does the warehouse use Ongoing WMS (or another WMS)? If yes, a WMS integration is a separate change request.

---

## 10. Out of Scope

- Return fees / restocking fees
- Admin languages other than English
- Portal languages other than EN/SV (structure supports adding later)
- Reporting beyond the analytics dashboard (exports, scheduled reports)
---

## Appendix A – Client Scope Additions (preserved from original `scope.md`)

### UI References (original client screenshots)

| Screen | Link |
|---|---|
| Customer Returns Portal | https://prnt.sc/L-oPsK0i85r6 · https://prnt.sc/Hz_uUSuVcvMV |
| Order Validation / Error Handling | https://prnt.sc/PFcHYKzetpo2 |
| Returns Admin Interface | https://prnt.sc/E-8PkHJ9A_Jt |
| Return / Exchange / Complaint Deadlines | https://prnt.sc/yF-9SVlblg7b |
| Label Generation Timing | https://prnt.sc/INywQbUNVG1q |
| Email Templates | https://prnt.sc/veaUysIZGnMk |
| Restock Options | https://prnt.sc/0eRx5aEEXoa1 |
| Order-Specific Deadline Extension | https://prnt.sc/V5E4Sm-2onXL |

### Development Deliverables Checklist (original)

- [ ] Custom Shopify Returns App
- [ ] Customer returns portal
- [ ] Returns administration dashboard
- [ ] Return settings and policy management
- [ ] Restock configuration
- [ ] Return, exchange and complaint deadline management
- [ ] Order-specific deadline extension
- [ ] Return & exchange exclusion rules
- [ ] Exchanges with price-difference payment
- [ ] ShippyPro carrier routing and shipping integration
- [ ] Return label and tracking management
- [ ] Automated customer email notifications
- [ ] English and Swedish customer frontend
- [ ] English-only admin panel
- [ ] Testing, bug fixing and deployment assistance

### Client Dependencies (original)

- ShippyPro API credentials and webhook configuration access
- Warehouse addresses per market
- Default return method per market
- HS codes and country of origin for products
- Swedish translations (or approval of provided ones)
- Email template wording
- Timely feedback and approvals during UAT

### Original Client Open Questions (see section 9 for expanded list)

1. Handling of lower-priced exchange replacements (refund / store credit / none)?
2. Should refunds for returns be processed inside the app, or handled manually in Shopify? (Not in current scope.)
3. Is there a maximum number of photos and file size per upload?
4. Which markets require "label immediately" vs "label after approval"?
5. Who receives admin failure notifications (email address / team inbox)?

---

## Phase 4A – Courier Service Catalog & Return Pickup (≈12h on top of Phase 4)

**Tasks**
1. Sync courier services: call ShippyPro `GetCarriers`, store every connection and service, re-sync daily and from a "Sync now" button.
2. Admin list: show each carrier/service, supported capabilities (returns, pickup, QR), and which service returns use (default: same service as original shipment).
3. Find original courier: when the customer looks up their order, find the original shipment in ShippyPro and save its carrier and service.
4. Same service for the return: return uses same courier service as the order; shown as fixed info, customer cannot choose another.
5. Drop-off or courier pickup: if service supports collection, customer can choose pickup with date, time window, and address.
6. Book collection: create return shipment, then book courier pickup; if booking fails or carrier cannot be booked through API, flag request and email admin team to book manually.

**Database tables added**
- Courier services (catalog per shop/account)
- Return pickups (booking details and status)

**Client question**
- Which carriers support pickup booking via ShippyPro, and who pays for return pickup?

**Notes**
- ShippyPro API method names must be taken from https://api.shippypro.com/docs#v1 before implementing; this is especially important for pickup booking, which may not be supported by every carrier.
- Secrets must never be committed: keep `SHIPPYPRO_API_KEY` only in `.env`; `.env` is ignored by git. If an API key was exposed, generate a new one in ShippyPro and replace it.

