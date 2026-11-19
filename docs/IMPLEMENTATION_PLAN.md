# Grand Le Mar Returns App – Implementation Plan (Extension Phases)

Baseline: Phases 0–9 are implemented. `doc/scope.md` now contains the merged scope (Phases 0–19). This plan covers only the remaining extension work and is intended to be executed one phase at a time.

## Current Baseline

- Core flows exist: portal order lookup/submission, admin returns list/detail, settings, exclusions, email templates, carriers, exchanges, restock, analytics.
- Portal supports one optional photo per item (stored as base64 data URLs) and optional comments.
- Prisma models exist for returns, items, photos, labels, tracking events, daily order stats.
- No models/routes/services yet for inspection, refunds, store credit/deflection, EU withdrawal, complaint resolution, inventory reservation, or the advanced exchange/refund flows.

## Recommended Execution Order

Follow the scope order unless a client dependency blocks a phase:

1. Phase 10 – Required Claim Evidence
2. Phase 11 – Receiving & Inspection
3. Phase 12 – Refund Processing
4. Phase 13 – Store Credit & Refund Deflection
5. Phase 14 – EU Withdrawal Function
6. Phase 15 – Analytics Dashboard polish/completion
7. Phase 16 – Complaint Resolution Flow
8. Phase 17 – Advanced Exchanges
9. Phase 18 – Smart Refunds
10. Phase 19 – Portal & Label Upgrades

## Phase 10 – Required Claim Evidence

**Goal:** Make photos/comments mandatory for complaints and improve evidence handling.

**Tasks:**
- Update portal form validation in `app/routes/portal.tsx` so complaints require at least one image and a minimum comment length.
- Allow multiple photos per item instead of one.
- Store/display evidence in admin detail view `app/routes/app.returns.$id.tsx`.
- Add service helpers in `app/services/returns.server.ts` and/or `portal.server.ts` for validating evidence.
- Migrate data if changing `ReturnPhoto` (not strictly required if keeping base64 URLs).

**Files likely touched:**
- `app/routes/portal.tsx`
- `app/services/portal.server.ts`
- `app/services/returns.server.ts`
- `app/routes/app.returns.$id.tsx`
- tests for portal validation

**Done when:** Complaint submissions without valid evidence are rejected; admins can view all evidence.

## Phase 11 – Receiving & Inspection

**Goal:** Add warehouse receiving queue and inspection outcomes.

**Prisma changes:** Add `Inspection` (or extend `ReturnRequest` with status/inspection fields), inspection status, warehouse location, received timestamp, per-item condition notes.

**Routes/UI:**
- `app/routes/app.inspection.tsx` (queue + filters)
- `app/routes/app.returns.$id.tsx` inspection actions
- portal status display enhancements

**Services:** `app/services/inspection.server.ts`

**Done when:** Warehouse can mark items received, record condition, and move return to the next workflow status.

## Phase 12 – Refund Processing

**Goal:** Process refunds through Shopify Admin API after approval/inspection.

**Prisma changes:** Add refund records (amount, currency, status, Shopify refund id, error).

**Services:** `app/services/refunds.server.ts` using Shopify Admin GraphQL.

**Routes/UI:**
- Admin return detail refund action and status
- Background job handling (if BullMQ is available in this app setup)

**Dependencies:** Clear refund policy from client (automatic vs approved).

**Done when:** Approved/inspected returns create a Shopify refund and record its result.

## Phase 13 – Store Credit & Refund Deflection

**Goal:** Offer exchange/store credit before refund and issue credit when selected.

**Prisma changes:** Store credit offers/decisions, resolution mode settings.

**Routes/UI:**
- `app/routes/proxy.returns.resolution.tsx` or portal-side resolution step
- `app/routes/app.settings.resolutions.tsx`

**Services:** credit issuance (Shopify gift cards/store credit depending on client choice).

**Done when:** Customer can choose offered resolution and admin can configure modes.

## Phase 14 – EU Withdrawal Function

**Goal:** Add withdrawal form and confirmation compliant with Directive (EU) 2023/2673.

**Routes/UI:**
- `app/routes/proxy.withdraw._index.tsx`
- `app/routes/proxy.withdraw.confirm.tsx`

**Prisma changes:** `WithdrawalRequest`/confirmation timestamps.

**Done when:** Customer can submit and confirm withdrawal in EN/SV with required legal acknowledgement.

## Phase 15 – Analytics Dashboard Polish/Completion

**Goal:** Complete analytics coverage already partially implemented.

**Tasks:**
- Review `app/services/analytics/analytics.server.ts` and `app/routes/app.analytics.tsx`.
- Add missing KPIs/filters from scope (reasons, exchanges, complaints, country breakdown).
- Ensure DailyOrderStat updates are populated from Shopify/webhooks.

**Done when:** Dashboard supports all required filters and KPIs with real data.

## Phase 16 – Complaint Resolution Flow

**Goal:** Let customer/admin choose complaint outcome (replacement/refund) and create replacement orders.

**Prisma changes:** complaint resolution fields, replacement order references.

**Services/UI:** complaint actions in admin detail and portal status.

**Done when:** Complaint can be resolved as configured and replacement orders created when appropriate.

## Phase 17 – Advanced Exchanges

**Goal:** Add inventory reservation, ship now/wait logic, store credit fallback, per-item resolution.

**Prisma changes:** reservation metadata, ship timing.

**Services:** exchange/inventory services extensions.

**Done when:** Exchanges support ship-now vs after-inspection flows and unavailable-item store credit.

## Phase 18 – Smart Refunds

**Goal:** Make refunds bundle/discount-aware.

**Services:** refund calculation logic accounting for bundles and discounts.

**Done when:** Refund amounts match Shopify order economics for representative cases.

## Phase 19 – Portal & Label Upgrades

**Goal:** Embeddable portal form, QR/SMS/PDF labels, "what happens next" page.

**Routes/UI:** embedded form support, QR/SMS/PDF rendering/sending, confirmation enhancements.

**Done when:** Labels can be delivered via supported methods and confirmation explains next steps.

## Cross-Cutting Notes

- Keep using existing route registration via `@react-router/fs-routes`; adding files under `app/routes` automatically registers routes.
- Run `npm run typecheck`, `npm run lint`, and `npm run build` after each phase.
- Create a Prisma migration for each schema change and verify locally against SQLite dev database.
- Resolve open questions in `doc/scope.md` section 9 before phases requiring client policy decisions.
- Update `doc/HANDOVER.md` after each completed phase.
- New service files should follow existing `*.server.ts` naming and use pessimistic validation with Zod where input is external.
