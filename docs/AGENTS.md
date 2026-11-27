# Shopify app development

This app is scaffolded from a Shopify app template. See the README for framework-specific details.

Use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) for all Shopify API and platform work. If missing, install it in the agent host per that page (or `npx skills add Shopify/shopify-ai-toolkit --list` for skill-compatible hosts) — do not add tooling to this repo.

## Audit status (2026-11-27)

A read-only audit and implementation plan are in `docs/audit/`. **Implementation is NOT approved yet.** Do not change code, schema, scopes or env, and make no live shipping/email calls until the owner approves.

- Provider confirmed by the owner: **ShippyPro** ("Shopflo" in the brief meant ShippyPro). Owner decisions D-1…D-7 are in `docs/audit/IMPLEMENTATION_ROADMAP.md`.
- Rules: one label per request, with no automatic re-send to ShippyPro after a failure. The return label mirrors the original outbound shipment (same parcel, addresses swapped). Partial quantity returns are allowed. Dev-store tests must never touch live-store data.

### Pending tasks (future)
- **Tracking webhook hardening (S4):** `/webhooks/shippypro` is unauthenticated and its `orderNumber` fallback is not shop-scoped. Add a shared secret and match only by our own shipment id / tracking number.
- Never create a real label without the run book in `docs/audit/DEVELOPMENT_STORE_TESTING_PLAN.md` §6 and explicit per-run approval. Never test on the live client store.
- First tasks once approved: S5 (mock harness) → S1 (idempotent label) → A1 (approval guard) → S2 (test mode) → S3 → S4. See `docs/audit/IMPLEMENTATION_ROADMAP.md`.
