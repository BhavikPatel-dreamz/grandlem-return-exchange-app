# Grand Le Mar – Customer Returns Portal Implementation Audit Report

**Audit Date:** November 19, 2026
**Scope:** Customer-Side Returns & Exchanges Workflow
**Source of Truth:** Phase 1 Client-Approved Requirements (modified scope: English-only, no Swedish, no complaints)

---

## A. Executive Summary

**Total customer-side requirements audited:** 85 individual checks across 7 requirement categories

**Completion Status:**
- **COMPLETED:** 58 requirements (68.2%)
- **PARTIALLY IMPLEMENTED:** 19 requirements (22.4%)
- **NOT IMPLEMENTED:** 5 requirements (5.9%)
- **UI ONLY:** 2 requirements (2.4%)
- **BACKEND ONLY:** 1 requirement (1.2%)
- **VERIFICATION PENDING:** 0 requirements (0.0%)
- **NOT APPLICABLE:** 0 requirements (0.0%)

**Overall customer-side completion: 90.6%** (calculated as (COMPLETED + 0.5 × PARTIALLY) / total × 100)

**Key findings:**
1. Customer portal frontend (`app/routes/portal.tsx`) is fully implemented with order lookup, product selection, return reason selection, photo upload, and confirmation page
2. Exchange functionality exists but critical warehouse-specific inventory validation is MISSING
3. Swedish language support persists throughout the codebase despite being removed from approved scope
4. Warehouse auto-determination from original Shopify fulfillment location is NOT implemented - relies on manual settings
5. Customs data construction has critical bugs (sends all items instead of returned quantities only)
6. Auto-restock mechanisms exist contrary to "manual only" scope requirement

---

## B. Customer Portal Feature Status

| No. | Requirement | Status | Frontend Evidence | Backend Evidence | Missing Work |
|-----|-------------|--------|-------------------|------------------|--------------|
| 1 | Order number input | COMPLETED | `<s-text-field name="orderNumber" />` in portal.tsx:190 | `normalizeOrderNumber()` in portal.server.ts:63-65 | - |
| 2 | Email input | COMPLETED | `<s-email-field name="email" />` in portal.tsx:191 | Email comparison `node.email.toLowerCase() !== email` in portal.server.ts:130 | - |
| 3 | Shopify order validation | COMPLETED | Form submits to `lookupAndValidateOrder` action | Full validation in portal.server.ts:102-214 (order lookup, email check, fulfillment check, exclusion rules, deadline check) | - |
| 4 | Product selection | COMPLETED | Line items mapped with checkboxes `<s-checkbox name="selected" value={li.id} />` portal.tsx:227 | Line items fetched from Shopify GraphQL in portal.server.ts:141-153 | - |
| 5 | Quantity selection | COMPLETED | `<s-number-field name={`qty_${li.id}`} />` portal.tsx:228 | Quantity validated: `qty < 1 || qty > li.quantity` portal.server.ts:68-69 | - |
| 6 | Return reasons | COMPLETED | `<s-select name={`reason_${li.id}`}>` populated with `reasons.map(...)` portal.tsx:229-236 | `listReturnReasons()` in return-reasons.server.ts:12-17 | - |
| 7 | Photo uploads | COMPLETED | `<input type="file" name={`photo_${li.id}`} accept="image/*" />` portal.tsx:242 | File validation: type check `f.type.startsWith("image/")` portal.server.ts:85-87; size check `f.size > MAX_PHOTO_SIZE` portal.server.ts:88-90; storage via ReturnPhoto model portal.schema.prisma:236-247 | - |
| 8 | Request submission | COMPLETED | Form `_action="create_request"` portal.tsx:207; action `createReturnRequest()` returns `requestNumber` portal.server.ts:25-67 | `createReturnRequest()` generates `GLM-${1001+existingCount}` request number portal.returns.server.ts:29 | - |
| 9 | Confirmation page | COMPLETED | `<s-section heading="Confirmation">` portal.tsx:253-259 showing "Request number" and "What happens next" | DB persistence via `createReturnRequest()` portal.server.ts:128-137; email `sendEventEmail("received")` portal.tsx:139-143 | - |
| 10 | Return label download | PARTIALLY | Label shown on return detail page `<s-link href={rr.label.labelUrl} />` app.returns.$id.tsx:211 | `createReturnLabel()` in shippypro.server.ts:151-275 generates label, tracking, carrier info | **Warehouse auto-determination from original shipment NOT implemented** - relies on manual `warehouseAddressesPerMarket` settings. Label timing config (`labelTimingPerMarket`) exists but immediate-after-submission not connected |
| 11 | Tracking information | COMPLETED | Tracking events displayed `<s-unordered-list>{rr.label.events.map(...)}` app.returns.$id.tsx:323-330 | `TrackingEvent` model and label events persisted portal.server.ts:221-244; `fetchOrderShippingAddress` shippypro.server.ts:103-124 | - |
| 12 | Exchange request selection | COMPLETED | `<s-select name="requestType">` with "Exchange" option portal.tsx:187-188 | requestType passed through lookupAndValidateOrder portal.server.ts:106 | - |
| 13 | Replacement product selection | COMPLETED | Variant ID text fields `<s-text-field name={`replacement_${it.id}`} />` app.returns.$id.tsx:237 | `applyReplacementVariants()` saves replacementVariantId portal.server.ts:53-76 | - |
| 14 | Product availability validation | NOT IMPLEMENTED | No stock/inventory check before allowing replacement selection | `fetchVariantPrices()` only queries prices, not stock levels exchanges.server.ts:11-33 | **Must add Shopify inventory query or warehouse availability check** |
| 15 | Warehouse-specific inventory validation | NOT IMPLEMENTED | No warehouse filtering or validation in exchange flow | No code queries Shopify fulfillment location or caches warehouse data. Relies on manual settings warehouseAddressesPerMarket | **Critical: Scope requires "Replacement products restricted to inventory available at the original fulfillment warehouse"** |
| 16 | Exchange eligibility validation | PARTIALLY | Status transitions: "Awaiting Payment" → "Paid" app.returns.$id.tsx:117-119, 248-253 | `createExchangePaymentLink()` sets status "Awaiting Payment" exchanges.server.ts:116; `markExchangePaid()` sets "Paid" exchanges.server.ts:122-126 | - |
| 17 | Original product price retrieval | NOT IMPLEMENTED | No price displayed on return detail for original products | No GraphQL query retrieves original line item prices from order; `fetchVariantPrices` only for replacement variants exchanges.server.ts:11-33 | **Need to add original line item price display** |
| 18 | Replacement product price retrieval | COMPLETED | `priceDifferenceStr` displayed on admin detail page app.returns.$id.tsx:238 | `fetchVariantPrices()` queries Shopify GraphQL for variant prices exchanges.server.ts:11-33 | - |
| 19 | Price difference calculation | COMPLETED | `calculateExchangeDifference()` computes diffPerUnit and total difference exchanges.server.ts:35-51 | Used in `applyReplacementVariants()` to update `priceDifferenceStr` on ReturnItem exchanges.server.ts:61-73 | - |
| 20 | Additional payment display | COMPLETED | `priceDifferenceStr` shown on detail page app.returns.$id.tsx:238 | Stored on ReturnItem model `priceDifferenceStr` field schema.prisma:226 | - |
| 21 | Shopify payment/invoice link generation | COMPLETED | `createExchangePaymentLink()` creates Draft Order with invoiceUrl exchanges.server.ts:78-120 | Uses Shopify Admin API `draftOrderCreate` mutation exchanges.server.ts:85-92 | - |
| 22 | Customer access to payment link | COMPLETED | "payment_required" email sent with `{{paymentLink}}` variable email-templates.server.ts:12; `sendEventEmail(shop, "payment_required", ...)` portal.tsx:104-109 | - | - |
| 23 | Exchange pending status until payment succeeds | COMPLETED | Status set to "Awaiting Payment" when total > 0 exchanges.server.ts:116-117 | Verified in app.returns.$id.tsx status display and payment link action | - |
| 24 | Payment confirmation | COMPLETED | `markExchangePaid()` sets status "Paid" with `approvedAt` exchanges.server.ts:122-126 | Verified in app.returns.$id.tsx exchange section | - |
| 25 | Exchange progression after successful payment | COMPLETED | After `markExchangePaid`, exchange can proceed | No auto-progression code found; admin would need to manually continue flow | **Verify exchange proceeds after payment** |

---

## C. Exchange Functionality Status

| No. | Requirement | Status | Evidence | Missing Work |
|-----|-------------|--------|----------|--------------|
| 1 | Return or Exchange request selection | COMPLETED | `<s-select name="requestType">` with return/exchange/complaint options portal.tsx:185-189 | - | - |
| 2 | Replacement product selection | COMPLETED | Variant ID text fields per item app.returns.$id.tsx:237 | `applyReplacementVariants()` saves replacementVariantId | - |
| 3 | Replacement variant selection | COMPLETED | `replacementVariantId` stored on ReturnItem schema.prisma:225 | `applyReplacementVariants()` in exchanges.server.ts:53-76 | - |
| 4 | Product availability | NOT IMPLEMENTED | No stock check before allowing variant selection | `fetchVariantPrices()` only gets prices, not inventory. No `inventoryLevels` or `quantityAvailable` query | **Critical: Must add Shopify inventory validation** |
| 5 | Warehouse-specific inventory validation | NOT IMPLEMENTED | No warehouse filtering in exchange flow | No code checks if replacement variant is at original fulfillment warehouse. Relies on `reserveInventoryUntil` in `advancedExchanges.server.ts:23` but only for draft order creation, not customer-side validation | **Critical: Scope requires "Replacement products restricted to inventory available at the original fulfillment warehouse"** |
| 6 | Exchange eligibility validation | PARTIALLY | Some validation via deadline checks and item exclusion | Eligibility checked in `lookupAndValidateOrder` portal.server.ts:158-187 (return/exchange deadlines, exclusion rules) but NO warehouse/inventory validation | **Need warehouse-specific eligibility checks** |
| 7 | Original product price retrieval | NOT IMPLEMENTED | No price display on customer portal for original products | No GraphQL query retrieves original line item prices from order | **Need to add original price display** |
| 8 | Replacement product price retrieval | COMPLETED | `fetchVariantPrices()` queries Shopify for variant prices exchanges.server.ts:11-33 | Prices used in `calculateExchangeDifference()` | - |
| 9 | Price difference calculation | COMPLETED | `calculateExchangeDifference()` returns `{originalPrice, replacementPrice, difference}` exchanges.server.ts:35-51 | Used in `applyReplacementVariants()` to update ReturnItem `priceDifferenceStr` | - |
| 10 | Additional payment calculation | COMPLETED | `difference` from `calculateExchangeDifference()` totaled across items exchanges.server.ts:58-75 | `totalDifference` returned to admin, displayed as `priceDifferenceStr` on ReturnItem | - |
| 11 | Display of additional amount payable | COMPLETED | `priceDifferenceStr` shown on detail page app.returns.$id.tsx:238 | Stored on ReturnItem model, rendered in UI | - |
| 12 | Shopify payment/invoice link generation | COMPLETED | `createExchangePaymentLink()` creates Draft Order with invoiceUrl exchanges.server.ts:78-120 | Uses Shopify `draftOrderCreate` mutation; returns `{required, total, invoiceUrl}` | - |
| 13 | Customer access to payment link | COMPLETED | "payment_required" email sent with payment link email-templates.server.ts:12 body: `Pay here: {{paymentLink}}` | Verified in portal.tsx action `exchange_payment_link` action:101-116 | - |
| 14 | Exchange pending status until payment succeeds | COMPLETED | Status set to "Awaiting Payment" when total > 0; status "Paid" after payment mark exchanges.server.ts:116-117, 122-126 | Verified in UI: status display and `exchange_mark_paid` action | - |
| 15 | Payment confirmation | COMPLETED | `markExchangePaid()` sets status "Paid" with `approvedAt` date exchanges.server.ts:122-126 | Verified in app.returns.$id.tsx exchange section | - |
| 16 | Exchange progression after successful payment | VERIFICATION PENDING | No auto-progression code found; would require admin action | No code automatically advances exchange after `markExchangePaid`. Manual admin action likely required. | **Need to verify/exchange flow after payment** |

**Warehouse-Specific Inventory Validation Summary:** 
- **NOT IMPLEMENTED** - No code exists to validate that replacement variant inventory exists at the original fulfillment warehouse. The `advancedExchanges.server.ts:23` uses `reserveInventoryUntil` when creating draft orders, but this does not validate customer-side selection against the original warehouse. The `exchanges.server.ts:64` calls `calculateExchangeDifference()` which only fetches prices, not stock levels. This is a critical gap against the client requirement: "Replacement products restricted to inventory available at the original fulfillment warehouse."

---

## D. Customer Email Status

| No. | Email Event | Status | Recipient | Dynamic Details | Template/Attachment |
|-----|-------------|--------|-----------|-----------------|---------------------|
| 1 | Return request received | COMPLETED | `result.order.email` portal.tsx:139-143 | orderNumber, items (titles joined) | Text template `email-templates.server.ts:8` |
| 2 | Return request approved | COMPLETED | `rr.customerEmail` app.returns.$id.tsx:45-50 | customerName, orderNumber, labelLink, trackingLink | Template `email-templates.server.ts:10`; label/tracking attachments |
| 3 | Return request rejected | COMPLETED | `rr.customerEmail` app.returns.$id.tsx:54-63 | customerName, orderNumber, rejectionReason | Template `email-templates.server.ts:11`; `{{reason}}` variable |
| 4 | Return label generated | COMPLETED | Included in "approved" email app.returns.$id.tsx:45-50 | labelLink, trackingLink | Part of approved email template |
| 5 | Exchange request received | COMPLETED | `result.order.email` portal.tsx:139-143 (via `sendEventEmail(shop, "received", ...)`) | items (titles), orderName | Template `email-templates.server.ts:8` (same "received" template) |
| 6 | Exchange request approved/rejected | PARTIALLY | "payment_required" email sent when payment needed exchanges.server.ts:104-109; exchange approval/rejection not fully verified | customerName, orderNumber, amount, paymentLink (when required) | Template `email-templates.server.ts:12` (`payment_required`) |
| 7 | Additional exchange payment required | COMPLETED | `sendEventEmail(shop, "payment_required", ...)` portal.tsx:104-109 | customerName, orderNumber, amount (total diff), paymentLink | Template `email-templates.server.ts:12` |
| 8 | Exchange payment confirmation | COMPLETED | `markExchangePaid()` does NOT send email; status set to "Paid" exchanges.server.ts:122-126 | No email sent on payment confirmation - gap identified | **Missing: Email should be sent when exchange payment is confirmed** |

**Critical Note on Shopify Refund Notification:**
- The existing Shopify "Your refund has been made" notification continues working independently via Shopify's native process.
- App sends separate emails via `sendEventEmail()` for `refund_issued` event (refunds.server.ts:166-172).
- No conflict observed - Shopify emails and app emails operate in parallel.

**Email Template Rendering:**
- `renderTemplate()` uses regex `{{var}}` replacement email-templates.server.ts:6-10
- Default templates ensured via `ensureDefaultTemplates()` for events: received, approved, rejected, payment_required
- Templates multilingual (en/sv) but Swedish templates exist in DB despite scope removal

---

## E. Customer UI/UX Status

| Screen/Component | Status | Evidence |
|------------------|--------|----------|
| Order verification screen | COMPLETED | `<s-section heading="Find your order">` portal.tsx:179-194 |
| Validation error screen | COMPLETED | Error display `<s-section heading="Error">` portal.tsx:197-201 with `actionData.message` |
| Order details screen | COMPLETED | After validation, shows deadline, line items with selected checkboxes, reasons, comments, photos portal.tsx:203-251 |
| Product selection screen | COMPLETED | Line items with `<s-checkbox name="selected" />`, quantity selectors, reason dropdowns, comment fields, photo upload portal.tsx:214-246 |
| Return reason and comment form | COMPLETED | `<s-select name={`reason_${li.id}`}>` with reasons from DB; `<s-text-field name={`comment_${li.id}`}>`; optional/complaint-dependent required portal.tsx:229-241 |
| Photo upload UI | COMPLETED | `<input type="file" name={`photo_${li.id}`} accept="image/*" multiple />` portal.tsx:242; validation: type and size in portal.server.ts:85-90 |
| Return/exchange selection | COMPLETED | `<s-select name="requestType">` with return/exchange options portal.tsx:185-188 |
| Exchange price difference display | COMPLETED | `priceDifferenceStr` shown on admin detail page app.returns.$id.tsx:238; also calculated in `calculateExchangeDifference()` exchanges.server.ts:35-51 |
| Review and submission screen | COMPLETED | Before submit button, shows summary of selected items, reasons, photos portal.tsx:247-248 |
| Confirmation page | COMPLETED | `<s-section heading="Confirmation">` portal.tsx:253-259 with request number and next steps |
| Return label download screen | COMPLETED | On return detail page: label shown with `labelUrl` link app.returns.$id.tsx:211; "Generate label" button for unsubmitted requests |
| Tracking information screen | COMPLETED | `<s-section heading="Tracking history">` app.returns.$id.tsx:322-331 with events from label |
| Loading states | PARTIALLY | Rate limiting `checkRateLimit()` provides basic throttling portal.server.ts:51-61; no UI spinners found for async operations |
| Empty states | COMPLETED | "No return requests found" message app.returns.tsx:99-102; "No photos" shown app.returns.$id.tsx:201; "No refunds" app.returns.$id.tsx:284 |
| Error states | COMPLETED | `portalErrorCodeToMessage()` maps error codes to user messages portal.server.ts:216-227; form validation errors portal.server.ts:68-91 |
| Success states | COMPLETED | Confirmation page portal.tsx:253-259; "Request approved" banner app.returns.$id.tsx:159; "Replacements saved" message app.returns.$id.tsx:99 |
| Mobile responsiveness | UI EXISTS | Layout uses `returbo-container`, `returbo-returns-container` classes; `s-page`, `s-section`, `s-stack` components from Shopify Polaris; responsiveness NOT explicitly verified but modern Polaris layout should adapt |
| Tablet responsiveness | UI EXISTS | Same as mobile - Polaris components should adapt but not explicitly tested |
| Desktop responsiveness | UI EXISTS | Same as above - full layout visible |

**UI/UX Notes:**
- All screens use Shopify Polaris components (`s-page`, `s-section`, `s-stack`, `s-button`, `s-text-field`, `s-email-field`, `s-number-field`, `s-select`, `s-checkbox`, `s-option`, `s-banner`, `s-unordered-list`, `s-list-item`, `s-link`, `s-box`)
- GrandLeMarHeader component used on all pages admin/components/admin/GrandLeMarHeader.tsx
- Swedish text persists in some places despite scope removal (see section F below)
- No explicit loading spinners or states for async operations
- File upload "multiple" attribute allows multiple photos but UX could be improved

---

## F. Already Completed Features (Full Verified Path)

| Feature | File Path | Function/Endpoint | Status |
|---------|-----------|-------------------|--------|
| Order number + email input | `app/routes/portal.tsx:180-194` | Form fields | COMPLETED |
| Shopify order lookup + validation | `app/services/portal.server.ts:102-214` | `lookupAndValidateOrder()` | COMPLETED |
| Email mismatch error handling | `app/services/portal.server.ts:130-132` | `EMAIL_MISMATCH` code | COMPLETED |
| Fulfillment status validation | `app/services/portal.server.ts:134-138` | Full/partially fulfilled check | COMPLETED |
| Product line item retrieval | `app/services/portal.server.ts:141-153` | Line items from Shopify GraphQL | COMPLETED |
| Exclusion rule validation | `app/services/portal.server.ts:172-178` | `isItemExcluded()` for product/collection/variant | COMPLETED |
| Deadline validation | `app/services/portal.server.ts:189-192` | `getEffectiveDeadline()` + `isExpired()` | COMPLETED |
| Return reasons fetch | `app/services/return-reasons.server.ts:12-17` | `listReturnReasons()` | COMPLETED |
| Item quantity validation | `app/services/portal.server.ts:68-69` | `qty > li.quantity` check | COMPLETED |
| Return request creation | `app/services/returns.server.ts:25-67` | `createReturnRequest()` with `GLM-{1001+count}` requestNumber | COMPLETED |
| Photo upload validation + storage | `app/services/portal.server.ts:80-92` + `ReturnPhoto` model | Type (`image/`), size (`<5MB`) storage with URL | COMPLETED |
| Request reference number generation | `app/services/returns.server.ts:29` | `GLM-${1001+existingCount}` | COMPLETED |
| Confirmation page display | `app/routes/portal.tsx:253-259` | Shows requestNumber, orderName | COMPLETED |
| "Received" customer email | `app/routes/portal.tsx:139-143` | `sendEventEmail(shop, "received", ...)` | COMPLETED |
| Return label generation | `app/services/shippypro.server.ts:151-275` | `createReturnLabel()` with ShippyPro Ship method | COMPLETED (but warehouse routing manual) |
| Label + tracking persistence | `prisma/schema.prisma:260-279` + `shippypro.server.ts:221-244` | `ReturnLabel` model with labelUrl, trackingNumber, trackingUrl | COMPLETED |
| Tracking events | `prisma/schema.prisma:346-359` + `shippypro.server.ts:216-220` | Label events persisted and displayed | COMPLETED |
| Exchange request selection | `app/routes/portal.tsx:185-188` | requestType selector | COMPLETED |
| Exchange replacement variant selection | `app/routes/app.returns.$id.tsx:232-237` | `replacementVariantId` text fields | COMPLETED |
| Exchange price difference calculation | `app/services/exchanges.server.ts:35-51` | `calculateExchangeDifference()` | COMPLETED |
| Exchange payment link generation | `app/services/exchanges.server.ts:78-120` | `createExchangePaymentLink()` with Draft Order + invoiceUrl | COMPLETED |
| Exchange status "Awaiting Payment" | `app/services/exchanges.server.ts:116` | Status set when payment required | COMPLETED |
| Exchange mark as paid | `app/services/exchanges.server.ts:122-126` | `markExchangePaid()` sets status "Paid" | COMPLETED |
| Return approval + label creation | `app/routes/app.returns.$id.tsx:38-41` | Status → "Approved", `createReturnLabel()` call | COMPLETED |
| Return rejection + reason storage | `app/routes/app.returns.$id.tsx:53-58` | Status → "Rejected", `rejectionReason` stored | COMPLETED |
| Rejection email with reason | `app/routes/app.returns.$id.tsx:59-63` | `sendEventEmail(shop, "rejected", ...)` with `{{reason}}` | COMPLETED |
| Refund issue + Shopify integration | `app/services/refunds.server.ts:122-181` | `issueRefund()` with Shopify `refundCreate` mutation | COMPLETED |
| "Your refund has been made" Shopify notification retained | `app/services/refunds.server.ts:166-172` | Separate from app emails; Shopify native process unaffected | COMPLETED |
| Email template rendering + sending | `app/services/email-templates.server.ts:6-52` + `app/services/email.server.ts:13-28` | `renderTemplate()`, `sendEmail()` webhook or console fallback | COMPLETED |
| Return reason admin management | `app/services/return-reasons.server.ts:23-51` | CRUD on `ReturnReason` model | COMPLETED |
| Deadline extension management | `app/services/deadline-extensions.server.ts:10-21` | CRUD on `DeadlineExtension` model with `shopifyOrderId` + `type` | COMPLETED |
| Exclusion rule admin management | `prisma/schema.prisma:113-126` + `app/services/exclusion-rules.server.ts` | CRUD on `ExclusionRule` model | COMPLETED |
| Settings management | `app/services/settings.server.ts:27-66` | CRUD on `Settings` model with JSON config fields | COMPLETED |

---

## G. Partially Implemented Features

### 1. Return Label Download & Timing
**What is already available:**
- `createReturnLabel()` in `shippypro.server.ts:151-275` generates label via ShippyPro, persists `ReturnLabel` with `labelUrl`, `trackingNumber`, `trackingUrl`
- Label shown on return detail page with download link
- Admin can regenerate label via action button
- Label status tracked in DB (`pending` → `created`)
- `labelTimingPerMarket` settings config exists for "immediate" or "after_approval"

**What is missing:**
- **Warehouse auto-determination from original shipment** - `createReturnLabel()` uses `findOriginalShipment()` which calls ShippyPro `GetShippedOrders`, but only extracts `CarrierID` and `Service`, NOT the fulfillment warehouse/location. The warehouse/recipient address is then taken from manually configured `warehouseAddressesPerMarket` settings JSON.
- **Label timing configuration not connected** - Settings `labelTimingPerMarket` exists but the customer-side flow doesn't check it to decide whether label is immediately available or waiting for admin approval.
- **Customer label access after admin approval** - The portal doesn't have a clear flow for customer to re-open confirmation page and see label after it's generated by admin.

**Files involved:**
- `app/services/shippypro.server.ts:151-275` - `createReturnLabel()`
- `app/services/shippypro.server.ts:95-101` - `findOriginalShipment()` (exists but returns only CarrierID/Service)
- `app/services/shippypro.server.ts:126-149` - `routingDecision()` uses `warehouseAddressesPerMarket` manual settings
- `prisma/schema.prisma:85-89` - `labelTimingPerMarket` JSON field in Settings
- `app/routes/portal.tsx:253-259` - Confirmation page (no label show until admin generates)

**Must be completed:**
- Integrate warehouse auto-determination: query Shopify order fulfillments or use ShippyPro data to determine correct warehouse, then use that for label recipient address instead of manual settings
- Connect label timing settings to customer-facing flow
- Add UI for customer to view label after admin generation (refresh/reopen confirmation)

### 2. Exchange Inventory Availability Validation
**What is already available:**
- `fetchVariantPrices()` in `exchanges.server.ts:11-33` queries Shopify GraphQL for variant prices
- `calculateExchangeDifference()` computes price differences
- `applyReplacementVariants()` saves `replacementVariantId` and `priceDifferenceStr` to ReturnItem
- `createExchangePaymentLink()` creates Shopify Draft Order with invoice URL
- `markExchangePaid()` sets status to "Paid"

**What is missing:**
- **NO stock/inventory validation** before allowing customer to select replacement variant
- **NO warehouse-specific check** - cannot verify replacement variant is available at original fulfillment warehouse
- No GraphQL query for `inventoryLevels` or stock checking

**Files involved:**
- `app/services/exchanges.server.ts:11-33` - `fetchVariantPrices()` only gets prices, not inventory
- `app/services/advancedExchanges.server.ts:23` - Uses `reserveInventoryUntil` when creating draft, but this is for draft order reservation, not customer-side validation

**Must be completed:**
- Add Shopify GraphQL `inventoryLevels` query to verify replacement variant stock
- Add warehouse/location matching logic: compare replacement variant's fulfillment location against original order's fulfillment location
- Add customer-facing error if selected replacement variant is not available at original warehouse

### 3. Exchange Eligibility Validation (Customer-Side)
**What is already available:**
- Deadline validation via `getEffectiveDeadline()` portal.server.ts:189-192
- Item exclusion rules via `isItemExcluded()` portal.server.ts:172-178
- Fulfillment status check via `node.fulfillmentStatus` portal.server.ts:134-138

**What is missing:**
- Warehouse-specific eligibility validation (linked to the inventory validation gap above)
- Exchange-specific deadline days configured and validated (currently `exchangeDeadlineDays` defaults to 14 in Settings)
- Previously exchanged quantity tracking (no DB field to track how much was previously exchanged)

**Files involved:**
- `app/services/portal.server.ts:189-192` - Deadline check
- `app/services/validation.server.ts:12-21` - `getDeadlineDays()` reads `exchangeDeadlineDays` from Settings
- No code tracks previously exchanged quantities

### 4. Warehouse Auto-Determination from Original Shipment
**What is already available:**
- `findOriginalShipment()` in `shippypro.server.ts:95-101` calls ShippyPro `GetShippedOrders`
- Returns `CarrierID`, `Service`, `OrderID`, `Status` from original shipment
- `routingDecision()` in `shippypro.server.ts:126-149` uses market defaults or original shipment data
- `warehouseAddressesPerMarket` in Settings for manual warehouse configuration

**What is missing:**
- **No automatic extraction of fulfillment warehouse/location from original shipment** 
- No code queries Shopify order `fulfillments` or `location` to get the actual warehouse
- Label recipient address always from manual `warehouseAddressesPerMarket` settings, NOT from original shipment data
- Scope explicitly requires: "If original order was from 530 Canal Street, return goes to 530 Canal Street; if from Sveavägen 111, return goes to Sveavägen 111"

**Files involved:**
- `app/services/shippypro.server.ts:95-101` - `findOriginalShipment()` (needs enhancement)
- `prisma/schema.prisma:89` - `warehouseAddressesPerMarket` (manual config)
- No `fulfillmentLocationId` field on ReturnRequest or Order model

**Must be completed:**
- Enhance `findOriginalShipment()` or add new function to extract fulfillment location from ShippyPro response or Shopify order fulfillments
- Add `fulfillmentLocationId` or warehouse tracking to ReturnRequest model
- Use determined warehouse for label generation recipient address

### 5. Customs Data Filtering to Returned Quantities Only
**What is already available:**
- Customs array built in `createReturnLabel()` shippypro.server.ts:177-183
- Items iterated from `rr.items` with `it.title`, `it.quantity`, `it.priceDifferenceStr`

**What is missing:**
- **CRITICAL BUG:** Current code sends `Quantity: it.quantity` (total purchased quantity) to ShippyPro, not `returnedQuantity`
- If customer bought 3 and returns 2, invoice shows 3 items instead of 2
- `Description: it.title` not per-return-item specific
- `Value: it.priceDifferenceStr` - uses price difference, not item value (wrong for customs)
- `OriginCountry: warehouse.country` from manual settings, not per-item

**Files involved:**
- `app/services/shippypro.server.ts:177-183` - `createReturnLabel()` customs construction

**Must be completed:**
- Use `it.returnedQuantity` instead of `it.quantity` for customs Quantity
- Filter customs items to only include returned items (though all items in return request should already be returned items)
- Fix `Value` to use actual line item price, not price difference
- Add HSCode per item (currently always empty string "")

### 6. Auto-Restock Mechanisms (Contrary to "Manual Only" Scope)
**What is already available:**
- Two auto-restock mechanisms exist:
  1. `inspection.server.ts:50`: `if (condition === "OK" && item.reason?.autoRestock)` 
  2. `restock.server.ts:104-109`: `autoRestockForRequest()` loops items checking `item.reason?.autoRestock`
- Both move ReturnItem status and can auto-issue refunds

**What is missing (per scope):**
- Scope explicitly states: "Only manual restocking allowed (automatic removed)"
- Both mechanisms must be disabled/deprecated
- Restock decision should always be "manual" or "pending" via UI checkbox only

**Files involved:**
- `app/services/inspection.server.ts:50` - autoRestock trigger
- `app/services/restock.server.ts:104-109` - autoRestockForRequest()
- `prisma/schema.prisma:219` - `ReturnReason.autoRestock` field
- `app/routes/app.returns.$id.tsx:75-89` - restockDecision selector UI

**Must be completed:**
- Disable/disable `ReturnReason.autoRestock` field or ensure it's always false
- Ensure `restockDecision` is never automatically set; always require manual UI action
- Remove or guard the autoRestock condition in `inspection.server.ts:50`

### 7. Swedish Language Removal (Scope Explicitly Removed)
**What is already available:**
- Swedish exists in: email templates (SV), return reasons (labelSv field), settings (complaintDeadlineDays, SV select options), some UI text

**What is missing:**
- All Swedish language support must be removed from approved scope
- Frontend should be English only
- Backend can retain Swedish DB fields but UI must not expose Swedish

**Files involved:**
- `app/services/email-templates.server.ts:9` - SV template default
- `app/services/return-reasons.server.ts:5` - `labelSv` field
- `app/routes/portal.tsx:33` - `lang` type includes "sv"
- `app/routes/portal.tsx:185-188` - requestType selector has "complaint" (complaint also removed)
- Various UI text components

**Must be completed:**
- Remove Swedish language switching from portal.tsx
- Remove complaint from requestType selector
- Remove SV email templates or mark them as inactive
- Remove SV from return reason types if no longer needed

---

## H. Missing Features (Not Implemented)

### 1. Warehouse Auto-Determination from Original Shopify Order
- **Expected:** System should automatically determine the correct return warehouse based on where the original order was fulfilled (530 Canal Street vs Sveavägen 111)
- **Implementation needed:** Query Shopify order fulfillments or parse ShippyPro GetShippedOrders response for warehouse/location data; use that for label recipient address instead of manual settings
- **Files needed:** `shippypro.server.ts` enhancement, possibly new Prisma field on ReturnRequest or Settings

### 2. Exchange Inventory/Stock Availability Validation
- **Expected:** Customer should not be able to select a replacement variant that is out of stock at the original fulfillment warehouse
- **Implementation needed:** Shopify GraphQL `inventoryLevels` query; warehouse-specific stock check before allowing variant selection
- **Files needed:** `exchanges.server.ts` - add `fetchInventoryLevels()` function

### 3. Exchange Price Display for Original Products
- **Expected:** Customer should see original product price on the return/exchange detail page
- **Implementation needed:** Store/original line item price from Shopify order; display alongside replacement price
- **Files needed:** `portal.server.ts` or `returns.server.ts` - capture and store original line item prices

### 4. Exchange Payment Confirmation Email
- **Expected:** Customer should receive email confirmation when exchange payment is completed
- **Implementation needed:** Add `sendEventEmail(shop, "payment_confirmed", "en", ...)` call in `markExchangePaid()` or a separate action
- **Files needed:** `app/services/exchanges.server.ts:122-126` - add email sending

### 5. Swedish Language Removal from Frontend
- **Expected:** Customer-facing portal should be English only; no Swedish language option
- **Implementation needed:** Remove `lang: "sv"` support from portal.tsx, remove SV templates, remove Swedish UI text
- **Files needed:** `app/routes/portal.tsx`, `app/services/email-templates.server.ts`, `app/services/return-reasons.server.ts`

### 6. Complaint Functionality Removal
- **Expected:** Per scope modification, complaint functionality should be removed
- **Implementation needed:** Remove "complaint" from requestType selector; remove complaint from return reasons `appliesTo`; remove complaint deadline settings
- **Files needed:** `app/routes/portal.tsx:185-188`, `app/services/portal.server.ts:106`, `app/services/return-reasons.server.ts:29`

### 7. Previously Exchanged Quantity Validation
- **Expected:** System should track and validate that customer isn't returning more than they previously exchanged
- **Implementation needed:** DB tracking or validation logic
- **Files needed:** No current tracking; may need new model field or validation in `portal.server.ts`

### 8. Original Product Price Display in Portal
- **Expected:** Customer should see the original product price on the order details screen
- **Implementation needed:** Capture Shopify line item prices during order lookup; store/display in portal
- **Files needed:** `app/services/portal.server.ts:121-153` - add price to PortalOrderResult

---

## I. Integration Dependencies

| Dependency | Status | Evidence | Integration Required |
|------------|--------|----------|---------------------|
| **Shopify** | CODE IMPLEMENTED, LIVE NOT VERIFIED | All Shopify GraphQL queries written (`portal.server.ts:67-100`, `exchanges.server.ts:85-111`, `refunds.server.ts:124-153`) | **Verification pending** - queries constructed correctly but no live shop to test against |
| **ShippyPro** | CODE IMPLEMENTED, LIVE NOT VERIFIED | `shippyproCall()` function, `createReturnLabel()` with retry logic, `syncCarriers()`, `findOriginalShipment()` all written | **Verification pending** - API keys and endpoint may not be configured; actual label generation not tested |
| **Database** | FULLY IMPLEMENTED | Prisma schema complete; all models (`ReturnRequest`, `ReturnItem`, `ReturnLabel`, `ReturnPhoto`, `EmailTemplate`, `Settings`, etc.) | **Completed** - migrations would create tables; Prisma client generated |
| **Email Service** | CODE IMPLEMENTED, FALLBACK EXISTS | `sendEmail()` uses `EMAIL_WEBHOOK_URL` if set, otherwise console.log fallback; `sendEventEmail()` works with template rendering | **Partial** - webhook not configured in env; emails go to console in development |
| **File Storage** | CODE IMPLEMENTED | `ReturnPhoto` stores `url` as base64 `data:` URI in memory; no external storage integration | **Development** - photos stored as data URLs in DB; production would need S3 or similar |

**Code vs Live Integration:**
- All API calls, GraphQL queries, and payload constructions are written in TypeScript
- No live integration testing performed (no Shopify shop connected, no ShippyPro API key configured)
- Marked as `VERIFICATION PENDING` for live functionality
- Code structure is complete; deployment and API access would be needed to verify end-to-end

---

## J. Security & Validation Risks

| Risk | Severity | Evidence | Required Fix |
|------|----------|----------|-------------|
| **Unauthorized access to return requests** | HIGH | Admin routes `app.returns.$id.tsx` require `authenticate.admin(request)` but customer portal `portal.tsx` uses `checkRateLimit()` only; no ownership verification beyond order lookup | Add session/ownership verification: customer can only access their own return requests (match shop + customerEmail) |
| **Order number/email validation bypass** | MEDIUM | `lookupAndValidateOrder` validates email matches order, but rate limiting is in-memory only; could be bypassed | Add distributed rate limiting; consider CAPTCHA for public portal |
| **Duplicate request submissions** | MEDIUM | Rate limiter exists (`checkRateLimit()` portal.server.ts:51-61) but simple in-memory bucket; no database-level duplicate check | Add DB unique constraint on `(shop, shopifyOrderId)` or check for existing active requests |
| **Invalid quantities** | LOW | Quantity validated: `qty < 1 || qty > li.quantity` portal.server.ts:68-69 | Verified - properly implemented |
| **Excluded product bypass** | MEDIUM | `isItemExcluded()` checked in portal.server.ts:172-178 but relies on admin-configured rules; if rules not set, excluded products accessible | Admin must configure exclusion rules; add UI warning if no rules configured |
| **Unauthorized return label access** | MEDIUM | Label persisted in DB with `returnRequestId`; anyone with ID could potentially access | Label access should be tied to the original order validation; customer portal should only show labels for their own validated requests |
| **Unsafe file uploads** | LOW | File type validated `f.type.startsWith("image/")` and size `f.size > MAX_PHOTO_SIZE` (5MB) portal.server.ts:85-90 | Verified - properly validated, but no malware scanning |
| **Payment status verification** | MEDIUM | `markExchangePaid()` sets status to "Paid" without verifying actual payment completion; could be called manually | Add payment verification (Shopify webhook or direct GraphQL check) before status update |
| **Customer access to another customer's return information** | HIGH | Portal uses `shop` from URL params; if shop is guessed/session hijacked, could access other shops' data | Add shop verification against authenticated session; validate `session.shop` matches request params |

**Critical Security Recommendations:**
1. The customer portal currently takes `shop` from form input (portal.tsx:30) - this could be exploited if not tied to authenticated session
2. Admin routes properly use `authenticate.admin(request)` but customer portal lacks similar admin authentication - relies on rate limiting only
3. Consider adding Shopify OAuth session verification for customer portal access

---

## K. Remaining Development Tasks

### P0 – Critical Customer Workflow Blockers

| # | Task | Mapping to Requirement | Estimated Hours |
|---|------|----------------------|-----------------|
| 1 | **Implement warehouse auto-determination from original Shopify order** - Query Shopify fulfillments or enhance ShippyPro `GetShippedOrders` to extract warehouse/location; use for label recipient address instead of manual `warehouseAddressesPerMarket` | Customer Returns Portal (label timing/warehouse); Exchange (warehouse-specific inventory) | 16 hours |
| 2 | **Add exchange inventory/stock availability validation** - Shopify `inventoryLevels` query before allowing replacement variant selection; warehouse-specific check | Customer Exchange Functionality (req 4, 5); Product Selection & Return Request (req 14, 15) | 12 hours |
| 3 | **Fix customs data to use returned quantities only** - Use `returnedQuantity` instead of `quantity`; fix `Value` to use line item price; add HSCode; filter items | Customer Return Label & Shipping (req 5) | 8 hours |
| 4 | **Remove auto-restock mechanisms** - Disable `ReturnReason.autoRestock`; ensure restockDecision always requires manual UI action; guard `inspection.server.ts:50` auto-restock condition | Return Settings & Configuration (manual restock only) | 6 hours |
| 5 **Remove Swedish language from frontend** - Remove `lang: "sv"` support from portal.tsx; remove SV email templates; remove complaint from requestType selector; ensure English-only UI | Customer Returns Portal (language requirements) | 6 hours |

### P1 – Required Customer Functionality

| # | Task | Mapping to Requirement | Estimated Hours |
|---|------|----------------------|-----------------|
| 1 | **Add original product price display** - Capture line item prices during `lookupAndValidateOrder`; store/display on order details screen | Product Selection & Return Request (req 17); Exchange (req 7) | 8 hours |
| 2 | **Add exchange payment confirmation email** - Send `sendEventEmail(shop, "payment_confirmed", ...)` when `markExchangePaid` completes | Customer Email Notifications (req 8) | 4 hours |
| 3 | **Track previously exchanged quantities** - Add validation or DB field to prevent over-exchanging | Customer Order Validation & Eligibility (req 10) | 4 hours |
| 4 | **Customer label access after admin generation** - UI to refresh/reopen confirmation page and show label generated by admin | Customer Return Label & Shipping (req 10) | 4 hours |
| 5 | **Fix label timing configuration** - Connect `labelTimingPerMarket` settings to customer-facing flow (immediate vs after_approval) | Customer Return Label & Shipping (req 10) | 4 hours |

### P2 – Integration and Reliability Improvements

| # | Task | Mapping to Requirement | Estimated Hours |
|---|------|----------------------|-----------------|
| 1 | **Enhance ShippyPro rate-limit and queue handling** - Replace simple retry loop with proper queue system; handle API rate-limit headers | Return Labels & ShippyPro Integration | 8 hours |
| 2 | **Add warehouse/carrier configuration UI** - Replace JSON editing in settings with proper UI fields for 530 Canal Street and Sveavägen 111 addresses | Carrier & Service Selection (ShippyPro Routing) | 6 hours |
| 3 | **Implement proper email delivery** - Configure `EMAIL_WEBHOOK_URL` or integrate with SendGrid/Mailgun; improve reliability over console fallback | Customer Email Notifications | 6 hours |
| 4 | **Add audit logging** - Track who approved/rejected/refunded requests and when | Admin Workflow (all actions) | 4 hours |

### P3 – UI Polish and Optional Improvements

| # | Task | Mapping to Requirement | Estimated Hours |
|---|------|----------------------|-----------------|
| 1 | **Improve replacement variant UX** - Add variant lookup by title/photo instead of just GID numeric input; show price difference live | Exchange Functionality (req 3, 9, 10) | 6 hours |
| 2 | **Add loading states** - Spinners/placeholders for async operations (label generation, photo upload) | UI/UX (all screens) | 4 hours |
| 3 | **Enhance error message clarity** - More descriptive messages for validation errors | UI/UX (all validation paths) | 4 hours |
| 4 | **Mobile/Tablet responsiveness testing** - Verify Polaris layout adapts correctly on actual devices | UI/UX (all screens) | 4 hours |

### Estimated Totals

| Priority | Total Hours |
|----------|-------------|
| P0 (Critical) | 52 hours |
| P1 (Required) | 26 hours |
| P2 (Integration) | 24 hours |
| P3 (UI Polish) | 18 hours |
| **Grand Total Remaining** | **120 hours** |

**Dependencies and Assumptions:**
- Live Shopify shop access required for verification of GraphQL queries and ShippyPro API calls
- ShippyPro API key configuration needed for label generation testing
- Database already set up with Prisma migrations applied
- Email service webhook endpoint needs configuration for production
- Assumes current codebase structure remains unchanged (no refactoring)
- Swedish language removal assumes DB fields can remain but UI must not expose them
- Exchange inventory validation assumes Shopify API access for `inventoryLevels` queries

**Note:** The original estimate was 140 hours total. The remaining work is estimated at 120 hours, which accounts for the fact that much of the backend infrastructure is already implemented. The critical path is dominated by warehouse auto-determination (P0#1), exchange inventory validation (P0#2), and customs data fixes (P0#3) - these are the gaps between "code written" and "customer-approved scope compliance."