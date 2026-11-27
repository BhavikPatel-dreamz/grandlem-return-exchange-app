# Shopify app development

This app is scaffolded from a Shopify app template. See the README for framework-specific details.

Use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) for all Shopify API and platform work. If missing, install it in the agent host per that page (or `npx skills add Shopify/shopify-ai-toolkit --list` for skill-compatible hosts) — do not add tooling to this repo.

## Audit status (2026-11-27)

The audit and plan are in `docs/audit/`. The owner approved implementation on 2026-11-27. **Steps 1–9 of the roadmap are done** (commits `58f38b0`…`0a86438`, not pushed or deployed). Step 10, the live ShippyPro label test, is **not** approved: it needs ShippyPro's written answers on charging, void rules and pickup, plus the owner's go-ahead for each run. Make no live shipping calls and never test on the live client store.

Checks before committing: `npm test`, `npm run typecheck`, and `npx react-router build`. Use that build command, not `npm run build`, because the npm script runs `prisma migrate deploy` against the DATABASE_URL in `.env`, which is the shared live database.

- Provider confirmed by the owner: **ShippyPro** ("Shopflo" in the brief meant ShippyPro). Owner decisions D-1…D-7 are in `docs/audit/IMPLEMENTATION_ROADMAP.md`.
- Rules: one label per request, with no automatic re-send to ShippyPro after a failure. The return label mirrors the original outbound shipment (same parcel, addresses swapped). Partial quantity returns are allowed. Dev-store tests must never touch live-store data.

### Pending tasks (future)
- **Step 10, live label test:** follow the run book in `docs/audit/DEVELOPMENT_STORE_TESTING_PLAN.md` §6. Set `SHIPPING_TEST_SHOPS` (dev store only), `SHIPPING_LIVE_TEST_ENABLED`, and `TEST_EMAIL_RECIPIENT`, and save the dev store's own ShippyPro key in its Settings.
- **ShippyPro field names unverified:** the API reference is rendered by JavaScript and could not be read. `findOriginalShipment` reads `ToAddress`/`Parcels` under several spellings. Confirm them against a real `GetShipmentsReport` response from the dev store's account.
- **Request number unique index:** first check the live data for duplicate `(shop, requestNumber)` with a read-only query, then add the index.
- **Withdraw flow (`proxy.withdraw.*`):** still trusts a posted shop. Move it to the signed proxy pattern.
- **Email language:** admin emails are always sent in `en`, because there is no language column on `ReturnRequest`.
- **Sweden customs rule (G4):** every return to a Swedish warehouse needs HS codes, including returns from inside Sweden. Waiting on the client's answer.
- **Tracking webhook hardening (S4):** `/webhooks/shippypro` is unauthenticated and its `orderNumber` fallback is not shop-scoped. Add a shared secret and match only by our own shipment id / tracking number.
- Never create a real label without the run book in `docs/audit/DEVELOPMENT_STORE_TESTING_PLAN.md` §6 and explicit per-run approval. Never test on the live client store.
