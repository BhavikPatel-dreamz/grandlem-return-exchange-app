# Grand Le Mar – Shopify Returns App: Handover

## Prerequisites
- Node.js >= 22.12
- Shopify CLI installed (`npm run shopify`)
- Prisma-supported database (SQLite for dev; migrate to Postgres for production)

## Environment variables
Set these before running/deploying:
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`
- `SHIPPYPRO_API_KEY` (and optional `SHIPPYPRO_API_URL`)
- `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (or `EMAIL_API_KEY`), and `EMAIL_FROM` (verified sender address)
- `EMAIL_WEBHOOK_URL` (optional fallback when Resend is not configured; otherwise logs to console)
- Test-store isolation (optional; see `app/services/test-mode.server.ts`):
  - `SHIPPING_TEST_SHOPS`: comma list of test shop domains, e.g. the dev store. **Never add the live client store.** Test stores never use the env `SHIPPYPRO_API_KEY`; they must save their own key in Settings.
  - `SHIPPING_LIVE_TEST_ENABLED=true`: allows a test store to send a real ShippyPro `Ship` call. Leave it unset except during an approved live-label test.
  - `TEST_EMAIL_RECIPIENT`: every email for a test store goes to this address instead.

## Database
```bash
npm run prisma -- migrate deploy
npm run prisma -- generate
```

## Run locally
```bash
npm install
npm run dev
```

## Deploy
```bash
npm run build
npm run deploy
```

## Key routes
- Admin: `/app`, `/app/returns`, `/app/returns/:id`, `/app/settings`, `/app/email-templates`
- Customer return page: `https://{shop}/apps/returns` (app proxy). The old `/portal` route only redirects there.
- Webhooks: `/webhooks/app/uninstalled`, `/webhooks/app/scopes_update`, `/webhooks/products/update`, `/webhooks/shippypro`

## Client configuration still required
- ShippyPro API credentials + sandbox access
- Warehouse addresses per market / default return methods
- HS codes and country of origin on Shopify products
- Swedish translations and email wording approval
- Shopify location IDs per market for restock
