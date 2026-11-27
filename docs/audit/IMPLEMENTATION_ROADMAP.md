# Implementation Roadmap

Status: **PLAN ONLY, awaiting owner approval.** No code has been changed.
Principle: reuse the existing app (React Router + Prisma + ShippyPro service); no rewrite.

Gate 0 decides everything shipping-related. Phases 1–2 (safety + correctness) do not need provider answers and can start once approved.

## Owner decisions (2026-11-27)

| # | Decision |
|---|---|
| D-1 | **Provider = ShippyPro** (the existing integration). "Shopflo" in the brief referred to ShippyPro. |
| D-2 | **Production flow:** admin approves → app calls ShippyPro once → label generated → customer gets an email with the label link → customer prints the label → the carrier collects the parcel. |
| D-3 | **One label per request.** If generation fails on approve, the app must **not** send the shipment to ShippyPro again automatically. It first checks (single order + single request) whether a shipment already exists, and only an explicit admin action may try again. |
| D-4 | **Isolation is mandatory.** Dev-store testing must never touch live-store data or use the live store's credentials by accident. |
| D-5 | **Return address and parcel come from the original outbound shipment.** Reuse the same parcel details (weight/dimensions) and the same addresses as the first shipment, **with sender and receiver swapped**. |
| D-6 | **Partial quantity returns.** Example: a customer bought 10 and returns 5. The other 5 stay eligible. Not every return is a full-order return. |
| D-7 | **Tracking webhook hardening (S4) is deferred** and recorded as a pending task in `docs/AGENTS.md`. |

Still open: G3 (exchange gets a return label?), G4 (Sweden customs rule), G6 (Shopify Returns API), the fallback when no original shipment is found (D-5), and the provider answers needed before the live test (shipping doc §9).

---

## Gate 0: decisions needed from the owner

| # | Decision | Blocks |
|---|---|---|
| G1 | Provider: is "Shopflo" ShippyPro (existing) or a different provider? | All S/L tasks |
| G2 | Written provider answers (see shipping doc §9) | Option A run |
| G3 | Exchange approval: should an exchange also get a return label? (today: yes) | A3 |
| G4 | Customs rule for Sweden warehouse (SE→SE needs HS codes today) | L3 |
| G5 | Return destination: always the per-market configured address? | L2 |
| G6 | Shopify Returns API sync wanted? (needs new scopes) | Phase 4 |

---

## Phase 1: Shipping safety (required before any live label)

### S1. Single-attempt, idempotent label creation
- **Files:** `app/services/shippypro.server.ts` (`createReturnLabel`), `app/routes/app.returns_.$id.tsx`
- **New:** `ShipmentAttempt` model (requestId, status sending/succeeded/failed/unknown, payload hash, provider id, error, timestamps)
- **DB:** new table + migration; `ReturnLabel` keeps the current row, attempts keep history (fixes lost shipment ids)
- **Backend:** remove the outer retry around `Ship`; keep the 429 retry only; refuse if a non-voided label or an in-flight attempt exists (`updateMany`/unique constraint as lock); timeout/parse error → `unknown`, no retry; reconcile via `GetShipmentsReport` by `TransactionID`
- **Frontend:** "Regenerate" requires void first; show attempt history and an "unknown – reconcile" state
- **Tests:** timeout-after-send, double approve in parallel, regenerate with existing label, missing label URL
- **Risk:** medium (core path). **Acceptance:** in every mocked scenario at most one `Ship` call per request until voided.

### S2. Test-mode and credential isolation
- **Files:** `shippypro.server.ts` (`resolveShippyProApiKey`), `email.server.ts`, `returns.server.ts`
- **DB:** `ReturnRequest.isTest Boolean @default(false)`
- **Env:** `SHIPPING_TEST_SHOPS`, `SHIPPING_LIVE_TEST_ENABLED`, `SHIPPYPRO_ALLOW_ENV_KEY_FALLBACK`, `TEST_EMAIL_RECIPIENT`
- **Backend:** requests from allowlisted shops are `isTest`; live `Ship` for `isTest` only when enabled; env key fallback off unless allowed; all emails for `isTest` go to `TEST_EMAIL_RECIPIENT`, including the label-failure alert
- **Frontend:** "TEST" badge on request list/detail
- **Acceptance:** non-allowlisted shop cannot hit live test path; live shop behaviour unchanged.

### S3. Pre-flight validation and shipment preview
- **Files:** `shippypro.server.ts` (split `buildReturnShipment()` from `sendShipment()`), `app.returns_.$id.tsx`
- **Backend:** validate mandatory fields (shipping doc §3) before any call; return a typed list of missing fields
- **Frontend:** preview card on request detail (sender, destination, parcel, carrier/service) before approve
- **Acceptance:** invalid address → no API call, clear message.

### S4. Secure tracking webhook (DEFERRED by owner, D-7; tracked in docs/AGENTS.md)
- **Files:** `app/routes/webhooks.shippypro.ts`
- **Env:** `SHIPPYPRO_WEBHOOK_SECRET`
- **Backend:** verify secret (header/query, per provider support); match only by `shippyproOrderId`/`trackingNumber` (unique to our label), drop the cross-shop `orderNumber` fallback
- **Acceptance:** unsigned call → 401; no request of another shop can be touched.

### S5. Mock provider test harness
- **New:** `tests/shippypro-label.test.ts`, `tests/admin-approval.test.ts` (fetch + Prisma fakes, as in `proxy-returns.test.ts`)
- **Acceptance:** shipping + admin matrix rows from the testing plan pass [MOCK].

## Phase 2: Workflow correctness

| Task | Files | Change | Acceptance |
|---|---|---|---|
| **A1** Approval guard | `app.returns_.$id.tsx` | `updateMany({where:{id,status:{in:["Submitted","Pending approval"]}}})`; same for reject | Approving twice / approving Rejected does nothing |
| **A2** Email fixes | `app.returns_.$id.tsx`, `proxy-returns-route.server.ts` | Real `customerName`; language from request; set `approvalEmailSentAt` on auto-approve | Correct name; no false banner |
| **A3** Exchange approval branch | `app.returns_.$id.tsx`, `email-templates.server.ts` | New `exchange_approved` template; label only if G3 = yes | Exchange email contains replacement info |
| **E1** Quantity-aware eligibility | `portal.server.ts`, `proxy-returns-route.server.ts` | Eligible qty = fulfilled qty − qty in non-rejected requests; drop whole-order block; use `currentQuantity`/fulfilled | Partial returns allowed for remaining qty |
| **E2** Request number uniqueness | `returns.server.ts`, schema | Unique index + retry on conflict | No duplicates under concurrency |
| **E3** Retire legacy `/portal` | `app/routes/portal.tsx` | Redirect to proxy or require signature | No unsigned shop input path |

## Phase 3: Label quality

| Task | Files | Change | Acceptance |
|---|---|---|---|
| **L1** Parcel from original shipment (D-5) | `shippypro.server.ts` (`findOriginalShipment`, `createReturnLabel`) | Read parcel weight/dimensions from the original outbound ShippyPro shipment and reuse them. Fallback when not found: Settings default parcel per market, and flag for review. Verify which `GetShipmentsReport`/`GetOrder` fields carry parcels before coding | No hard-coded 1 kg when the original shipment exists |
| **L2** Swapped addresses (D-5) | `shippypro.server.ts:434-509` | Return destination = original shipment's sender (warehouse). Return sender = original shipment's receiver, with the Shopify order shipping address as fallback. When no original shipment is found: per-market return address from Settings (not the Shopify location) | Return label mirrors the outbound shipment |
| **L3** Customs rule | `shippypro.server.ts:451` | Per G4 | SE domestic return without HS codes works (if G4 says so) |
| **L4** Pickup address confirm | proxy details screen | Show/edit pickup address + phone, store on request | Label uses confirmed address |
| **L5** Print view (optional) | new `app.returns.$id.label.tsx` | Authenticated route streaming the PDF for print | Prints from admin |

## Phase 4: Optional
- Shopify Returns API sync (`returnCreate`, scopes `read_returns`/`write_returns`): only if G6 = yes.
- `read_all_orders` for orders older than 60 days (needs Shopify approval).
- Store label PDF copies.

## Phase 5: Option A live-label test
Follow the run book in `DEVELOPMENT_STORE_TESTING_PLAN.md` §6. **Requires G1 + G2 + Phase 1 done + explicit per-run approval.** If the provider cannot confirm label-without-pickup/charge, stop and report; do not run.

---

## Suggested order and size

| Order | Task | Size |
|---|---|---|
| 1 | S5 harness (so every later step is tested) | S |
| 2 | S1 idempotent label | M |
| 3 | A1 approval guard | S |
| 4 | S2 test mode + key isolation | M |
| 5 | S3 pre-flight + preview | M |
| 6 | S4 webhook | S |
| 7 | A2, A3, E1, E2, E3 | M |
| 8 | L1–L4 | M |
| 9 | Option A run | — |

Each step: typecheck + lint + tests, then a commit on `main` (project convention).
