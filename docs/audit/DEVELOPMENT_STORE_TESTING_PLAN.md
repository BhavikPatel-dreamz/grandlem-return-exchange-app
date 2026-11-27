# Development Store Testing Plan

Dev store: `bhavik-app-test-5couj1fn.myshopify.com`. The live client store is **never** used for testing, including to fill gaps.

Every test result must be labelled with one of:
- **[MOCK]**: provider and/or Shopify responses faked in Vitest
- **[DEV-SHOPIFY]**: real dev-store order, provider mocked or not called
- **[LIVE-PROVIDER]**: real production provider call (Option A); needs explicit approval per run
- **[NOT TESTED vs provider]**: stated explicitly in reports

## 1. Getting readable orders in the dev store

| Step | Supported? | Notes |
|---|---|---|
| Configure **Protected customer data access** for the app (Partner Dashboard → app → API access → Protected customer data → select name, email, address, phone) | Yes; dev stores do not need review | Most likely cause of "orders not readable". Verify first |
| Create orders via checkout with **Shopify Bogus Gateway** (Settings → Payments → test mode) | Yes, dev stores | Gives a normal order with customer + shipping address |
| Or Admin → Orders → Create order → *Mark as paid* | Yes | Fastest; set customer email and shipping address |
| Fulfill the order manually (Mark as fulfilled) | Yes | Required: portal accepts FULFILLED / PARTIALLY_FULFILLED / IN_PROGRESS only |
| Create ≥3 variants products, multi-qty orders, a partially fulfilled order | Yes | Covers the matrix below |
| Order with customer account (logged-in path) | Yes | Enable customer accounts on the dev store |

The deployed app (Vercel) serves both stores from one DB. Test rows are separated by `shop`. Running locally needs a separate `DATABASE_URL` (a dev Neon branch); the current local `.env` points at the shared DB. **Recommend a Neon branch for local work.**

## 2. Category A: application-only (mock provider) [MOCK]

Extend the existing Vitest setup (`tests/proxy-returns.test.ts` already fakes Shopify and Prisma) with a ShippyPro fetch mock. No network.

## 3. Category B: live API integration [LIVE-PROVIDER]

Only after: provider is confirmed, the capability questions (Shopflo/shipping doc §9) are answered in writing, S1–S4 safety tasks are merged and tested in Category A, and the owner approves **each** run (carrier, service, addresses, max labels).

## 4. Category C: real shipment

Not in scope. Separate written authorization required (cost + physical pickup/dispatch).

---

## 5. Test matrix

### Customer order testing

| Case | Category | Expected |
|---|---|---|
| Customer with no orders | MOCK + DEV-SHOPIFY | Empty state + guest form |
| One order | MOCK + DEV-SHOPIFY | Listed; selectable |
| Multiple orders | DEV-SHOPIFY | Last 20, newest first, cancelled hidden |
| Unfulfilled order | MOCK (exists) + DEV | "Not fulfilled" message |
| One product | MOCK (exists) | Auto-selected |
| Multiple products | MOCK + DEV | None preselected; multi-select works |
| Multiple variants | DEV | Correct `variantId` stored per line |
| Partial quantity (2 of 3) | MOCK + DEV | Request qty 2; **after fix:** remaining 1 still eligible |
| Previously returned quantity | MOCK (exists for full line) | **After fix:** only remaining qty offered; rejected requests don't count |
| Quantity > eligible | MOCK | Rejected server-side |
| Exchange selection | MOCK + DEV | type=exchange saved with resolution |
| Another customer's order id posted | MOCK (exists) | Rejected |
| Token from other shop | MOCK (exists) | Rejected |
| Deadline expired / excluded product | MOCK | Proper message |

### Admin testing

| Case | Category | Expected |
|---|---|---|
| Pending request visible | DEV | In list with Submitted status |
| Approve return | MOCK + DEV(provider mocked) | Approved once, label created once, email once |
| Approve exchange | MOCK | Exchange email (after fix), **no** return label unless policy says so |
| Reject | MOCK + DEV | Rejected + reason + rejected email |
| Duplicate approval (double submit / 2 tabs) | MOCK (parallel calls) | Second call is a no-op; one `Ship` call total |
| Approve a Rejected request | MOCK | Refused |
| Invalid request id | MOCK | 404 / "Request not found" |
| Email failure (Resend error) | MOCK | Approved, `approvalEmailSentAt` null, retry banner; retry does **not** create a new label |

### Shipping testing

| Case | Category | Expected |
|---|---|---|
| Successful shipment + label | MOCK, then LIVE-PROVIDER once | Label URL, tracking, `shippyproOrderId` stored |
| Invalid address / missing phone | MOCK | Pre-flight validation fails **before** API call |
| Auth failure (bad key) | MOCK (and LIVE with a wrong key: safe, no shipment) | Clear admin message, no retry |
| Timeout after send | MOCK | Attempt marked `unknown`, **no retry**, reconcile prompt |
| Provider error `Result != OK` | MOCK | Failed, error shown, admin alert (test recipient in test mode) |
| 429 rate limit | MOCK | Retry with Retry-After (allowed: request not processed) |
| Missing label URL in OK response | MOCK | Marked `needs_reconcile`, shipment id kept for void |
| Label download | DEV + LIVE | PDF opens from admin + email link |
| Label printing | LIVE | Print from PDF viewer / print view; A4 / 4×6 per carrier |
| Duplicate label generation (regenerate while one exists) | MOCK | Refused unless the existing label is voided first |
| Void | MOCK, then LIVE once | Status voided, provider confirms |
| Non-allowlisted shop in test mode | MOCK | Live call refused |
| Tracking webhook without secret / other shop | MOCK | 401 / ignored |

## 6. Option A: exact run book (after approval only)

Preconditions (all must be ticked by the owner):
- [ ] Provider confirmed; §9 answers on file (no auto-pickup, billing known, void free)
- [ ] Tasks S1–S5 merged; Category A all green
- [ ] Dev store has its **own** live key in Settings; env fallback disabled
- [ ] `SHIPPING_TEST_SHOPS` = dev store only; `SHIPPING_LIVE_TEST_ENABLED=true` set for the run window only
- [ ] Drop-off carrier/service chosen; sender + destination addresses approved; `TEST_EMAIL_RECIPIENT` set
- [ ] Max labels for this run: 1

Steps:
1. Create and fulfill a dev-store test order (customer = test contact, shipping address = approved sender address).
2. Open `https://<dev-store>/apps/returns`, look up the order, select 1 item, submit a return.
3. In admin, open the request, check *Test request* is shown and the pre-flight summary (addresses, parcel, carrier/service).
4. Approve **once**.
5. Verify one `ShipmentAttempt` and one label; tracking number saved; provider dashboard shows exactly one shipment.
6. Download and print the PDF; record paper size and readability.
7. Confirm the email reached `TEST_EMAIL_RECIPIENT` with the working label link.
8. Void the label; confirm in the provider dashboard.
9. Set `SHIPPING_LIVE_TEST_ENABLED=false`. Record the results with the [LIVE-PROVIDER] tag.

Stop conditions: any unexpected pickup booking, any second shipment, any error with unknown outcome. Stop and report; do not retry.
