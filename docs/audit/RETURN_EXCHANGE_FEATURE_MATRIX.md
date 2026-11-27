# Return & Exchange Feature Matrix

Audit date: 2026-11-27. Status keys:
**Working** = implemented, no blocking issue found · **Partial** = exists but incomplete · **Fix** = exists, needs correction · **Missing** · **External** = needs a provider integration · **Blocked** = waiting on credentials/permissions/confirmation.

"Verified" in this audit means *read in code*. Nothing was run against a real store.

## 1. Customer side

| Requirement | Status | Existing implementation | Missing work | Relevant files | Priority |
|---|---|---|---|---|---|
| Customer order lookup (guest) | Working | Order number + email, generic error for wrong email/unknown order, IP rate limit | — | `portal.server.ts:lookupAndValidateOrderBasic`, `proxy-returns-route.server.ts:handleGuestLookup` | — |
| Customer order listing (logged in) | Partial | Last 20 non-cancelled orders of signed `logged_in_customer_id` | Paging; orders > 60 days need `read_all_orders` | `portal.server.ts:listCustomerOrders` | Low |
| Customer sees only own orders | Working | Logged in: `order.customer.id` must equal the signed id. Guest: email match. Signed order token bound to shop + customer | Covered by tests | `portal.server.ts:lookupOrderForCustomer`, `proxy-order-token.server.ts` | — |
| Only eligible orders shown | Partial | Fulfilled / in-progress / partially fulfilled only; deadline per type with extensions; exclusion rules | Listing shows all orders (eligibility is checked on select) | `portal.server.ts:validateOrderNode` | Low |
| Order detail retrieval | Working | `order(id:)` with line items, variant, image, collections, fulfillment location | `lineItems(first:50)` limit | `portal.server.ts` | Low |
| Product selection (multi) | Working | Multiple checkbox lines | — | `proxy-returns-route.server.ts` | — |
| Variant handling | Working | `variantId` per line stored; exchange picks replacement variant | — | `ReturnItem.variantId`, `exchanges.server.ts` | — |
| Quantity ≤ eligible quantity | **Fix** | Checked against original `quantity` | Use fulfilled/refundable quantity minus quantities in non-rejected requests | `proxy-returns-route.server.ts:1667`, `portal.server.ts:209-235` | High |
| Previously returned quantities | **Fix** | Any earlier request containing the line excludes the whole line; rejected requests still block; one return request blocks the whole order | Quantity-aware ledger that ignores Rejected/Cancelled | `portal.server.ts:80-87, 209-235` | High |
| Return vs exchange choice | Working | Return / Exchange / Complaint radios + resolution choices | — | `requestTypeRadios`, `proxy-resolutions.server.ts` | — |
| Return reason | Working | Reasons filtered by `appliesTo`, required when reasons exist | — | `return-reasons.server.ts` | — |
| Request submission & save | Working | Server-side revalidation from signed token; photos; resolution | `requestNumber` race (D15) | `returns.server.ts` | Low |
| Order ↔ request ↔ line items kept | Working | `shopifyOrderId`, `orderNumber`, `ReturnItem.shopifyLineItemId` | — | `schema.prisma` | — |
| Pickup address confirmation | **Missing** | Order shipping address used silently | Show and confirm (or edit) pickup address and phone before label | `shippypro.server.ts:498` | High |

## 2. Admin side

| Requirement | Status | Existing implementation | Missing work | Relevant files | Priority |
|---|---|---|---|---|---|
| Request listing | Working | Search, pagination, status | — | `app.returns.tsx` | — |
| Request details | Working | Items, images, reasons, photos, customer, order, label, tracking, refunds, warehouse | — | `app.returns_.$id.tsx` | — |
| Approve | **Fix** | Sets Approved → creates label → sends email | Status guard (only from Submitted/Pending), idempotency | `app.returns_.$id.tsx:226` | High |
| Reject | Partial | Sets Rejected + reason + email | Status guard; template uses email as name | `app.returns_.$id.tsx:247` | Med |
| Status management | Partial | Free-text status dropdown | Allowed-transition rules | `app.returns_.$id.tsx:335` | Low |
| Duplicate approval prevention | **Missing** | Only "email already sent" banner | Atomic `updateMany where status in (...)` | — | High |
| Email after approval (return) | Partial | `approved` template with `{{labelLink}}`, `{{trackingLink}}`; blocks email if no label | Correct customer name, language, return instructions copy | `sendApprovedReturnEmail`, `email-templates.server.ts` | Med |
| Email after approval (exchange) | **Fix** | Same return email + return label | Exchange-specific template / branching | same | Med |
| Email failure handling | Working | Error banner + "Retry label & email"; `approvalEmailSentAt` | Auto-approve path doesn't set `approvalEmailSentAt` (D13) | `app.returns_.$id.tsx:449` | Low |
| Return address management | Partial | Per-market (US/SE/UK/DEFAULT) warehouse address in Settings | Used only as last fallback (D7); should be the primary destination | `app.settings.tsx:1318`, `shippypro.server.ts:434` | High |

## 3. Shipping and label

| Requirement | Status | Existing implementation | Missing work | Relevant files | Priority |
|---|---|---|---|---|---|
| Shipping provider | **Blocked** | **ShippyPro** only; no Shopflo code | Confirm provider (Shopflo vs ShippyPro) | `shippypro.server.ts` | **Critical** |
| Label generation | **Fix** | `Ship` with `IsReturn:true`, sync, label URL/tracking saved | Remove blind retry, add idempotency, pre-flight field validation, test-mode guard | `shippypro.server.ts:400` | **Critical** |
| Label storage | Partial | External URL in `ReturnLabel.labelUrl` | Optional: copy PDF to storage; keep shipment history | `schema.prisma` | Med |
| Label download | Working | Admin link, email link, confirmation screen link | — | `app.returns_.$id.tsx:948` | — |
| Label printing | Partial | Browser opens the PDF (print from viewer) | Optional print view / proxy route that streams the PDF | — | Low |
| Tracking | Partial | Tracking number/URL saved; webhook writes events | Authenticate and shop-scope the webhook (D3) | `webhooks.shippypro.ts` | High |
| Cancellation / void | Working | `VoidShipments` | Keep voided shipment history | `voidReturnLabel` | Low |
| Pickup scheduling | Missing (by design) | Recorded as `needs_manual_booking` | Not needed for Option A (must *not* book) | `requestPickup` | — |
| Package weight / dimensions | **Fix** | Hard-coded 1 kg 10×10×10 | Settings default + per-variant weight sum | `shippypro.server.ts:510` | Med |
| Customs (CN22) | Needs confirmation | Required whenever the warehouse is in SE | Rule by origin/destination customs territory | `shippypro.server.ts:451` | Med |
| Label failure alert | Working | Email to shop owner or `SHIPPYPRO_FAILURE_EMAIL` | Must be suppressed/redirected in test mode | `notifyLabelFailure` | Med |

## 4. Exchange

| Requirement | Status | Existing implementation | Relevant files |
|---|---|---|---|
| Replacement variant selection | Working (admin) | Admin sets replacement per item | `exchanges.server.ts:applyReplacementVariants` |
| Price difference payment | Working | Draft order invoice; `orders/paid` webhook marks Paid | `exchanges.server.ts:246`, `webhooks.orders.paid.tsx` |
| Free exchange | Working | Draft order completed at zero cost | `exchanges.server.ts:406` |
| Reserve / ship timing | Partial | Settings exist; advanced service is thin | `advancedExchanges.server.ts` |

## 5. Shopify synchronization

| Requirement | Status | Notes |
|---|---|---|
| Shopify Return object (`returnCreate`, reverse fulfillment) | Missing | Optional. Needs `read_returns`/`write_returns`. Not required for labels. Recommend deferring until the client asks. |
| Refund | Working | `refundCreate` |
| Restock | Working | `inventoryAdjustQuantities` |
| Order metafields | Not used | — |
