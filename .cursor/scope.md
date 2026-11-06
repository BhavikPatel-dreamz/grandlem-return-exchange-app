# Grand Le Mar – Shopify Returns App

> **Project:** Custom Shopify Returns App (Phase 1 Scope)
> **Client:** Grand Le Mar (grandlemar.com)
> **Estimated Effort:** 150–160 hours
> **Estimated Timeline:** 4–5 weeks (depends on API access, client feedback and approvals)

---

## 1. Project Overview

A custom Shopify app that manages the full returns lifecycle for Grand Le Mar: customer return and exchange requests, admin approvals, return shipping labels and tracking through **ShippyPro**.

The app has two main parts:

| Part | Audience | Languages |
|---|---|---|
| Customer Returns Portal (frontend) | Customers | English, Swedish (multilingual-ready) |
| Returns Admin Panel (backend) | Grand Le Mar team | English only |

### UI References

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

---

## 2. Phase Summary

| Phase | Name | Est. Hours | Week |
|---|---|---|---|
| 0 | Project Setup & Discovery | 8 | 1 |
| 1 | Data Model & Return Settings | 18 | 1 |
| 2 | Customer Portal – Order Lookup & Validation | 12 | 1–2 |
| 3 | Customer Portal – Return Request Flow | 20 | 2 |
| 4 | ShippyPro Integration (Routing, Labels, Webhooks) | 30 | 2–3 |
| 5 | Returns Admin Panel | 22 | 3 |
| 6 | Exchanges & Price Difference | 16 | 3–4 |
| 7 | Customer Email Notifications | 8 | 4 |
| 8 | Restock Logic & Shopify Sync | 6 | 4 |
| 9 | Testing, Bug Fixing & Deployment | 15 | 4–5 |
| | **Total** | **155** | **4–5 weeks** |

---

## Phase 0 – Project Setup & Discovery

**Goal:** Get the foundation, access and environments in place.

### Tasks
- [ ] Create Shopify custom app and development store
- [ ] Set up repository, branching strategy and environments (dev / staging / production)
- [ ] Configure required Shopify API scopes (orders, products, inventory, customers, draft orders, fulfillments)
- [ ] Obtain ShippyPro API credentials and sandbox access
- [ ] Confirm markets (e.g. Sweden, UK, US, EU) and warehouse addresses
- [ ] Confirm grandlemar.com theme styles (fonts, colours, components) for portal design
- [ ] Set up email sending provider
- [ ] Set up background job queue infrastructure

### Deliverables
- Running app skeleton installed on the dev store
- API access confirmed for Shopify and ShippyPro

### Dependencies
- Client to provide ShippyPro API access, warehouse details and market list

---

## Phase 1 – Data Model & Return Settings

**Goal:** Build the configuration layer that drives every other phase.

### 1.1 Data Model
- [ ] `ReturnRequest` – order, customer, type (return / exchange / complaint), status, market, carrier, timestamps
- [ ] `ReturnItem` – line item, variant, quantity, reason, comment, restock decision
- [ ] `ReturnPhoto` – uploaded images linked to items
- [ ] `ReturnLabel` – carrier ID, service, label URL, tracking number, tracking link, status
- [ ] `TrackingEvent` – webhook status history
- [ ] `ReturnReason` – label (EN/SV), type, auto-restock flag
- [ ] `Settings` – deadlines, label timing per market, defaults
- [ ] `DeadlineExtension` – order ID, type, new deadline
- [ ] `ExclusionRule` – collection / product / variant, applies to return and/or exchange
- [ ] `EmailTemplate` – per event and language
- [ ] `Carrier` – synced ShippyPro carrier connections

### 1.2 Return Management Settings
- [ ] General return deadline (days)
- [ ] Separate exchange deadline
- [ ] Separate complaint deadline
- [ ] Manage return reasons (create / edit / delete / reorder, EN + SV)
- [ ] Label generation timing per market:
  - Immediately after request submission
  - After admin approval
- [ ] Default return method per market (fallback for routing)

### 1.3 Order-Specific Deadline Extension
- [ ] Admin can extend the return, exchange or complaint deadline for a specific Shopify order
- [ ] Portal validation uses the extended deadline when present

### 1.4 Return & Exchange Exclusion Rules
- [ ] Exclude by **collection**, **product** or **variant**
- [ ] Separate toggles for excluding returns and/or exchanges
- [ ] Shared validation service used by the portal and API

### Acceptance Criteria
- All settings save and load correctly from the admin panel
- Deadline and exclusion rules are enforced through one shared validation service

---

## Phase 2 – Customer Portal: Order Lookup & Validation

**Goal:** Customers can securely find their order.

### Tasks
- [ ] Portal entry page: order number + email address
- [ ] Validate order details against Shopify
- [ ] Clear error messages for:
  - Order not found
  - Email does not match the order
  - Order not yet fulfilled
  - Return / exchange / complaint deadline expired (respecting extensions)
  - All items excluded or already returned
- [ ] Basic rate limiting / abuse protection on lookup
- [ ] Responsive design matching grandlemar.com
- [ ] Desktop and mobile support

### Acceptance Criteria
- Valid order + email opens the order
- Each failure case shows the correct message (see reference: https://prnt.sc/PFcHYKzetpo2)

---

## Phase 3: Customer Portal – Return Request Flow

**Goal:** Customers can build and submit a return request.

### Tasks
- [ ] Display eligible order items (hide or mark excluded items)
- [ ] Select products and quantities to return
- [ ] Choose request type: return / exchange / complaint
- [ ] Select return reason from the admin-managed list
- [ ] Optional comments per item
- [ ] Photo uploads for damaged / faulty items (file type and size validation)
- [ ] Review step before submission
- [ ] Confirmation page after submission
- [ ] Return label:
  - Download immediately, **or**
  - Emailed after admin approval
  - (Behaviour configurable per market)

### Multilingual Support
- [ ] English and Swedish translations
- [ ] Translation-file structure so new languages can be added later
- [ ] Translations provided / approved by the client

### Acceptance Criteria
- Customer can complete a full request on desktop and mobile in EN and SV
- Excluded products cannot be selected or submitted

---

## Phase 4 – ShippyPro Integration

**Goal:** Correct carrier routing and automatic return labels.

### 4.1 Carrier Sync
- [ ] Sync carrier connections with **`GetCarriers`**
- [ ] Store each connection by its unique **Carrier ID**
- [ ] Manual "re-sync carriers" action in admin

### 4.2 Original Shipment Lookup & Routing
- [ ] Find the original shipment with **`GetShippedOrders`**
- [ ] Identify the original carrier connection and service
- [ ] Apply routing rules, e.g.:

| Original Shipment | Return Method |
|---|---|
| UPS Europe Service Point | UPS Europe Service Point return |
| FedEx UK | FedEx UK return |
| Swedish order | DHL Freight return |

- [ ] Fallback: if original shipment is not found → use market default return method and **flag the request for admin review**

### 4.3 Return Label Creation
- [ ] Create shipment with **`Ship`** method and `IsReturn = true`
- [ ] Sender = customer, Recipient = warehouse
- [ ] Use selected carrier connection and service
- [ ] Retrieve label, tracking number and tracking link
- [ ] Customs data for UK and US → Sweden:
  - Item description
  - HS code
  - Country of origin
  - Declared value

### 4.4 Webhooks, Queue & Reliability
- [ ] Integrate ShippyPro webhooks for shipment status updates
- [ ] Store status history as tracking events
- [ ] Notify the admin team when label generation fails
- [ ] Queue processing for label creation
- [ ] Retries with backoff
- [ ] Rate-limit handling according to ShippyPro limits

### Acceptance Criteria
- Labels generate correctly for each routing example
- Customs data included for UK/US returns
- Failed label generation triggers an admin notification and is retryable

### Dependencies
- HS codes and country of origin available on Shopify products (metafields or client-provided mapping)

---

## Phase 5 – Returns Admin Panel

**Goal:** The team can manage every request from one place (English only).

### 5.1 Dashboard
- [ ] List all submitted return requests
- [ ] Search and filter by:
  - Order number
  - Customer
  - Carrier
  - Return status
  - Date
- [ ] Highlight requests flagged for review

### 5.2 Request Detail View
- [ ] Customer and order information
- [ ] Products and quantities
- [ ] Return reasons and comments
- [ ] Uploaded photos
- [ ] Selected carrier and service
- [ ] Return label and tracking history

### 5.3 Actions
- [ ] Approve request
- [ ] Reject request with reason (sends rejection email)
- [ ] Download label
- [ ] Regenerate label
- [ ] Void label (where supported by the carrier)
- [ ] Manually generate a label using any available ShippyPro carrier connection
- [ ] Restock decision during quality check (Pending Approval stage)

### Return Status Workflow (proposed)

```
Submitted → Pending Approval → Approved → Label Created → In Transit → Received → Completed
                    ↓
                 Rejected

Exchange:  Approved → Awaiting Payment → Paid → Exchange Fulfilled
```

### Acceptance Criteria
- All filters and actions work as expected (reference: https://prnt.sc/E-8PkHJ9A_Jt)

---

## Phase 6 – Exchanges & Price Difference

**Goal:** Support product exchanges, including paying the difference.

### 6.1 Exchange Process
- [ ] Customer can request an exchange for eligible products
- [ ] Replacement products limited to items available in the **warehouse that fulfilled the original order**
- [ ] Validate replacement product and exchange eligibility (stock, exclusions, deadline)

### 6.2 Price Difference
- [ ] Compare original product value with replacement value
- [ ] If replacement costs more → calculate the additional amount
- [ ] Send customer a Shopify payment / invoice link for the difference
- [ ] Keep exchange in **Awaiting Payment** until paid
- [ ] Proceed with exchange fulfillment after successful payment

### Acceptance Criteria
- Equal-price exchanges proceed without payment
- Higher-price exchanges are blocked until the invoice is paid

### Open Question
- How should a lower-priced replacement be handled (refund difference, store credit, or no refund)?

---

## Phase 7 – Customer Email Notifications

**Goal:** Automated, configurable emails for key events.

### Emails
- [ ] Return request received
- [ ] Return request approved (includes return label)
- [ ] Return request rejected (includes rejection reason)
- [ ] Exchange payment required (invoice link) — supports Phase 6

### Tasks
- [ ] Template editor in admin settings (reference: https://prnt.sc/veaUysIZGnMk)
- [ ] Dynamic variables (customer name, order number, items, label link, tracking link, reason)
- [ ] English and Swedish versions
- [ ] Test-send option

---

## Phase 8 – Restock Logic & Shopify Sync

**Goal:** Inventory is updated correctly after returns.

### Tasks
- [ ] Auto restock / no restock based on the selected return reason
- [ ] Alternative: admin decides manually during quality check (Pending Approval stage)
- [ ] **Complaints are never automatically restocked**
- [ ] Restock to the correct Shopify location (original fulfilling warehouse)

### Acceptance Criteria
- Inventory changes in Shopify match the restock rules for every reason type

---

## Phase 9 – Testing, Bug Fixing & Deployment

**Goal:** Stable release to production.

### Tasks
- [ ] End-to-end testing per market (SE, UK, US, EU)
- [ ] Carrier routing tests for each example rule and the fallback
- [ ] Customs data verification on UK/US labels
- [ ] Exchange + payment flow testing
- [ ] Deadline, extension and exclusion rule tests
- [ ] Mobile and cross-browser testing
- [ ] EN / SV translation review with client
- [ ] Client UAT and feedback round
- [ ] Bug fixing
- [ ] Production deployment and installation on the live store
- [ ] Handover notes / short admin guide

---

## 3. Development Deliverables Checklist

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

---

## 4. Client Dependencies

- ShippyPro API credentials and webhook configuration access
- Warehouse addresses per market
- Default return method per market
- HS codes and country of origin for products
- Swedish translations (or approval of provided ones)
- Email template wording
- Timely feedback and approvals during UAT

## 5. Open Questions

1. Handling of lower-priced exchange replacements (refund / store credit / none)?
2. Should refunds for returns be processed inside the app, or handled manually in Shopify? (Not in current scope.)
3. Is there a maximum number of photos and file size per upload?
4. Which markets require "label immediately" vs "label after approval"?
5. Who receives admin failure notifications (email address / team inbox)?