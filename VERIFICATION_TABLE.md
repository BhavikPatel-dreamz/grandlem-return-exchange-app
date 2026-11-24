# GRAND LE MAR – STEP 1.5: VERIFICATION TABLE

## Verification Against Actual Source Code

| Requirement | Previous Report | Actual Code Finding | Relevant File | Verified Status |
|---|---|---|---|---|
| **Customer order lookup** | Fully implemented | ✅ `portal.server.ts:lookupAndValidateOrder()` - complete order validation via Shopify Admin API, email verification, fulfillment status check, exclusion rules, deadline check | `app/services/portal.server.ts:102-214` | **Actually working** |
| **Return request creation** | Fully implemented | ✅ `returns.server.ts:createReturnRequest()` - creates request with items, photos, reasons, generates request number `GLM-{1001+count}` | `app/services/returns.server.ts:25-67` | **Actually working** |
| **Customer-facing route** | Not implemented | ❌ NO customer route exists. `app.returns.tsx` is admin-only (requires admin auth). No portal form for customers to submit returns | - | **Not implemented** |
| **Shopify App Proxy for returns** | Not configured | ❌ No App Proxy configured for returns. Only withdrawal proxy exists (`proxy.withdraw._index.tsx`) | - | **Not configured** |
| **Reuse existing services for portal** | Possible | ✅ `portal.server.ts` services can be reused, but no customer route exists to use them | `app/services/portal.server.ts` | **Backend exists, frontend missing** |
| **Warehouse routing from original shipment** | Partially implemented | ❌ No automatic warehouse determination. Uses manually configured `warehouseAddressesPerMarket` settings JSON. `findOriginalShipment()` only gets CarrierID/Service, NOT fulfillment location | `app/services/shippypro.server.ts:95-173` | **Exists only in UI/settings, not from actual order data** |
| **GetShippedOrders response handling** | Implemented | ✅ `findOriginalShipment()` calls ShippyPro GetShippedOrders, extracts CarrierID and Service. Response format: `CarrierID`, `Service`, `OrderID`, `Status` | `app/services/shippypro.server.ts:95-101` | **Actually working** |
| **Original warehouse information available** | Not tracked | ❌ Shopify fulfillment location NOT tracked on ReturnRequest. No `fulfillmentLocationId`, `warehouseId`, or similar field in model. Relies entirely on manual settings configuration | `prisma/schema.prisma:89` via `warehouseAddressesPerMarket` | **Not implemented** |
| **Shopify fulfillment/order queries** | Not mentioned | ❌ NO `fulfillmentOrders` or `fulfillments` GraphQL queries exist anywhere in codebase. Original order's fulfillment location is never queried from Shopify | - | **Not implemented** |
| **Most reliable source for fulfillment location** | Settings JSON | ❌ Manual `warehouseAddressesPerMarket` settings. Should query Shopify order `fulfillments` to get actual location. Current: unreliable (depends on admin correctly configuring settings per market) | `prisma/schema.prisma:89`, `settings.server.ts:23` | **Cannot verify without live data - code shows manual config only** |
| **Carrier ID and service mapping** | Fully implemented | ✅ `syncCarriers()` maps GetCarriers response → `Carrier` and `CourierService` models. `routingDecision()` uses CarrierID/Service from original shipment or market defaults | `app/services/shippypro.server.ts:44-93` | **Actually working** |
| **Return shipment creation** | Fully implemented | ✅ `createReturnLabel()` uses Ship method with `IsReturn=true`, configures From/To addresses, retrieves label URL, tracking number, tracking URL. Retries 3x with backoff | `app/services/shippypro.server.ts:151-275` | **Actually working** |
| **Customs data structure** | Partially implemented | ⚠️ Customs array built and sent to ShippyPro, but: `Description: it.title` (not per-return-item), `Quantity: it.quantity` (TOTAL not returned qty), `Value: it.priceDifferenceStr` (WRONG - should be item value, not diff), `HSCode: ""` (always empty), `OriginCountry: warehouse.country` (from settings, not per-item) **CRITICAL: Scope requires invoice show ONLY returned items, not all items** | `app/services/shippypro.server.ts:177-183` | **Implemented but incomplete** |
| **Returned quantities available** | Partially | ✅ `ReturnItem` has `returnedQuantity` field. In `createReturnRequest()`: `returnedQuantity: it.quantity` (sets equal to total). In inspection: `returnedQuantity` updated to `approvedQuantity`. **But customs uses `it.quantity` not `returnedQuantity`** | `prisma/schema.prisma:215`, `inspection.server.ts:44-47` | **Available but not used in customs** |
| **Original prices available** | Not for returns | ❌ No original purchase price stored on ReturnItem for returns. Only `priceDifferenceStr` used for exchanges. `createReturnRequest()` doesn't capture line item price | `prisma/schema.prisma:219-226`, `exchanges.server.ts:11-33` | **Not implemented for returns** |
| **Inspection workflow** | Fully implemented | ✅ `inspection.server.ts:saveInspection()` - saves condition, approvedQuantity, updates returnedQuantity, triggers auto-restock if condition=OK && reason.autoRestock, moves status to "Inspected", sends item_received email, checks auto-refund eligibility | `app/services/inspection.server.ts:13-69` | **Actually working** |
| **Auto-restock triggers** | Two mechanisms | ✅ 1) `inspection.server.ts:50`: `if (condition === "OK" && item.reason?.autoRestock)` 2) `restock.server.ts:104-109`: `autoRestockForRequest()` loops items, checks `item.reason?.autoRestock` **BOTH must be disabled for manual-only restocking** | `app/services/inspection.server.ts:50`, `restock.server.ts:104-109` | **Two mechanisms exist** |
| **Manual restocking controls** | UI exists | ✅ `app.returns.$id.tsx:75-89` - restockDecision selector ("auto"|"manual"|"pending"|"no") + "Restocked" checkbox. `performRestock()` called when checkbox checked. DB fields updated. | `app/routes/app.returns.$id.tsx:75-89`, `restock.server.ts:42-94` | **UI exists, policy enforcement missing** |
| **Shopify inventory adjustments** | Working | ✅ `restock.server.ts:performRestock()` calls Shopify GraphQL `inventoryAdjustQuantities` mutation with correct `inventoryItemId`, `locationId`, and `delta` (returnedQuantity). Updates DB restock fields on success | `app/services/restock.server.ts:42-94` | **Actually working** |
| **Email template HTML editing** | Partial support | ⚠️ Templates stored in DB with `subject`/`body` String fields. `renderTemplate()` replaces `{{var}}` patterns. Admins can include HTML in body field, but editor is regex-based `{{var}}` only. No WYSIWYG. | `app/services/email-templates.server.ts:6-52`, `app/services/email.server.ts:6-11` | **Body free text, but renderer limited** |
| **Template storage/editing/rendering/sending** | Fully described | ✅ Store: Prisma `EmailTemplate` model (subject, body, language, event, shop). Edit: `upsertEmailTemplate()` by ID. Render: `renderTemplate()` regex replacement. Send: `sendEventEmail()` → webhook or console fallback | `app/services/email-templates.server.ts`, `app/services/email.server.ts` | **Actually working** |
| **Shopify refund notification unaffected** | Yes | ✅ App sends separate emails via `sendEventEmail()`. Shopify native refund emails remain independent. `refunds.server.ts:issueRefund()` sends `refund_issued` email but Shopify also sends its own. Confirmed: "Your refund has been made" continues in Shopify | `app/services/refunds.server.ts:166-172`, `email.server.ts:13-28` | **Actually working** |
| **Warehouse filtering in admin list** | Not mentioned | ❌ NO warehouse/fulfillment location filter in `app.returns.tsx`. Filters: status, type, carrier (label's carrierId), date, flagged, search query. No warehouse filter | `app/routes/app.returns.tsx:1-49` | **Not implemented** |
| **Search and filtering** | Fully implemented | ✅ Status: 7 options. Type: return/exchange/complaint. Carrier: by label connectionId. Date range. Flagged checkbox. Search: order#/customer/email/order ID. Clear all options. | `app/routes/app.returns.tsx:58-78` | **Actually working** |
| **Approval workflow** | Fully implemented | ✅ `app.returns.$id.tsx:293-301` - Approve: sets status="Approved", creates label via `createReturnLabel()`, calls `autoRestockForRequest()`, sends "approved" email with label/tracking. Reject: sets status="Rejected", stores rejectionReason, sends "rejected" email. | `app/routes/app.returns.$id.tsx:293-301` | **Actually working** |
| **Rejection emails with reason** | Fully implemented | ✅ Reject form has `rejectionReason` field. Email body includes `{{reason}}` template variable. `approvedAt`/`rejectedAt` timestamps tracked. | `app/routes/app.returns.$id.tsx:52-63`, `email-templates.server.ts:11` | **Actually working** |
| **Manual restocking controls in dashboard** | UI exists | ✅ Items section (`app.returns.$id.tsx:166-188`): restockDecision selector + restocked checkbox. Restock decision stored on each ReturnItem. | `app/routes/app.returns.$id.tsx:166-188` | **UI exists, enforcement needs review** |
| **Replacement product selection** | Fully implemented | ✅ Exchange section (`app.returns.$id.tsx:225-251`): variant ID text fields per item. `applyReplacementVariants()` saves replacementVariantId and priceDifferenceStr to DB. | `app/routes/app.returns.$id.tsx:225-251`, `exchanges.server.ts:53-76` | **Actually working** |
| **Inventory availability validation** | Not implemented | ❌ NO stock/inventory check before allowing replacement selection. `fetchVariantPrices()` only gets prices, not stock levels. No validation that replacement variant is available in same warehouse | `app/services/exchanges.server.ts:11-33` | **Not implemented** |
| **Payment link generation** | Fully implemented | ✅ `createExchangePaymentLink()` creates Shopify Draft Order with invoice URL. Returns `{required, total, invoiceUrl, draftOrderId}`. When total≤0: `required=false`, auto-approves. When total>0: `required=true`, sets status "Awaiting Payment". | `app/services/exchanges.server.ts:78-120` | **Actually working** |
| **Payment confirmation flow** | Fully implemented | ✅ `exchange_payment_link` action: sends "payment_required" email. If `!result.required`, auto-sets status "Approved". `exchange_mark_paid` action: sets status "Paid" with `approvedAt` date. | `app/routes/app.returns.$id.tsx:100-119` | **Actually working** |

---

## CORRECTED DEVELOPMENT PRIORITY LIST

### CRITICAL PRIORITY (Must fix before scope compliance)

1. **🔴 Customer-facing returns portal** - No customer route exists. Must create `app/routes/portal.tsx` with order lookup form, product selection, reason selection, comment/photo upload, and confirmation page. The backend `portal.server.ts:lookupAndValidateOrder()` exists and works, but has no frontend.

2. **🔴 Swedish language removal from frontend** - Scope explicitly removes Swedish. Currently Swedish appears in: `email-templates.server.ts:9` (SV templates), `return-reasons.server.ts:5` (labelSv field), `app.returns.$id.tsx` (Swedish text), `app.settings.tsx:197-204` (SV select options). Must remove or disable all Swedish UI text and backend support.

3. **🔴 Warehouse auto-determination from original shipment** - Scope requires: "If original order was from 530 Canal Street, return goes to 530 Canal Street; if from Sveavägen 111, return goes to Sveavägen 111." Currently relies on manually configured `warehouseAddressesPerMarket` settings JSON. Must implement automatic warehouse detection from original Shopify order's fulfillment location (or ShippyPro GetShippedOrders data).

4. **🔴 Customs data filtering to returned quantities only** - Critical bug: Current `shippypro.server.ts:177-183` sends ALL items with their total quantities to ShippyPro. Scope requires: "If customer buys 3 products and returns 2, invoice must show only the 2 returned items." Must fix customs data construction to use `returnedQuantity` and filter items.

5. **🔴 Remove auto-restock mechanisms** - Scope: "Only manual, remove automatic." Two auto-restock triggers exist:
   - `inspection.server.ts:50`: `if (condition === "OK" && item.reason?.autoRestock)`
   - `restock.server.ts:104-109`: `autoRestockForRequest()` loops items, checks `item.reason?.autoRestock`
   - Must disable both and ensure only manual restock via UI checkbox works.

### HIGH PRIORITY (Should fix in Phase 1-2)

6. **🟠 Carrier routing rules automation** - Scope examples: "UPS Europe Service Point → UPS Europe Service Point return," "FedEx UK → FedEx UK return," "Swedish order → DHL Freight return." Currently basic fallback to market defaults. Must implement automatic routing rules based on market/country.

7. **🟠 Exchange inventory availability validation** - No stock check before allowing replacement selection. Must add inventory validation (check Shopify inventory levels or cached data) before allowing customers to select replacement variants.

8. **🟠 Return label warehouse determination** - The `createReturnLabel()` warehouse is from `warehouseAddressesPerMarket` settings, NOT from the original shipment. Must integrate warehouse auto-determination (priority #3 above) with label generation.

9. **🟠 Remove complaint-related settings per scope** - Scope removes complaints entirely. Must remove: `complaintDeadlineDays` from Settings, `complaint` from request type selector, complaint from return reasons `appliesTo` options, complaint from deadline extensions UI.

### MEDIUM PRIORITY (Should fix in Phase 2-3)

10. **🟡 Exchange replacement selection UI/UX** - The replacement variant ID fields need better UX (maybe variant lookup by title/photo, not just GID numeric input). Price difference display could be improved.

11. **🟡 ShippyPro rate-limit and queue handling** - Basic retry loop (3 attempts with exponential backoff) exists in `createReturnLabel()`. Could be enhanced with proper queue system and ShippyPro API rate-limit header handling.

12. **🟡 Admin warehouse/carrier configuration UI** - No dedicated UI for warehouse addresses. Currently edited as JSON in settings tab. Should add proper UI fields for 530 Canal Street and Sveavägen 111 addresses.

13. **🟡 Return reason `autoRestock` deprecation** - The `ReturnReason.autoRestock` field conflicts with `ReturnItem.restockDecision`. Scope says manual only. Should deprecate/remove `reason.autoRestock` and ensure `restockDecision` is always "manual" or "pending".

### LOW PRIORITY (Nice-to-have, post-MVP)

14. **🟢 Warehouse filtering in admin returns list** - Would be useful but not in current scope. Could add later as enhancement.

15. **🟢 KPI/analytics data verification** - Analytics components exist but data correctness wasn't fully verified. Should verify KPI cards populate correctly.

16. **🟢 Email template HTML editor improvements** - Current regex-based `{{var}}` replacement works but could be enhanced with proper HTML source editor if client requests richer editing.

17. **🟢 Bulk operations** - No bulk approve, label generation, or restocking. Could be added post-MVP.

18. **🟢 Audit logging** - No audit trail of who approved/rejected/refunded requests. Could be added for compliance.

19. **🟢 Product/variant data caching** - No cached product data; every portal lookup hits Shopify GraphQL. Could add Redis or similar for performance.

20. **🟢 Return search by tracking number** - Admin list doesn't display or filter by tracking number. Could add to list item view.