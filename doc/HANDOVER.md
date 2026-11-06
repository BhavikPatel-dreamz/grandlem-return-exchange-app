# Grand Le Mar – Shopify Returns App: Handover

## Prerequisites
- Node.js >= 22.12
- Shopify CLI installed (`npm run shopify`)
- Prisma-supported database (SQLite for dev; migrate to Postgres for production)

## Environment variables
Set these before running/deploying:
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`
- `SHIPPYPRO_API_KEY` (and optional `SHIPPYPRO_API_URL`)
- `EMAIL_WEBHOOK_URL` (optional; defaults to console logging)

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
- Customer portal: `/portal?shop=...&lang=en|sv`
- Webhooks: `/webhooks/app/uninstalled`, `/webhooks/app/scopes_update`, `/webhooks/products/update`, `/webhooks/shippypro`

## Client configuration still required
- ShippyPro API credentials + sandbox access
- Warehouse addresses per market / default return methods
- HS codes and country of origin on Shopify products
- Swedish translations and email wording approval
- Shopify location IDs per market for restock
