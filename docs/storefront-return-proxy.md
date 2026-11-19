# Storefront return page (app proxy)

Customer returns stay on the merchant’s domain and inside that store’s theme. One app serves every installed shop. The existing admin route `app/routes/portal.tsx` stays for merchants. Customers use a new proxy page.

Do these steps in order. Do not start a later step until the earlier one works on a dev store.

## What the customer sees

Store URL: `https://{shop}/apps/returns`

Shopify forwards that URL to this app and, because the response is Liquid, renders it inside the theme (header, footer, fonts, colors).

Two ways in, one flow after the order is known:

1. **Logged-in customer.** Shopify customer session is present. Show that customer’s recent orders. They pick one. Do not ask for email.
2. **Guest.** No session. Ask for order number and the email on the order. Both must match the same order.

Then both paths use the same steps: choose request type, choose items, give a reason, submit, see confirmation.

## Security rules

- Verify the app-proxy signature on every loader and action. Read `shop` from the signed query string, not from a hidden field the browser can change.
- After lookup, store the verified order id on the server (short-lived signed token or server session). Later steps must use that id. Do not accept a different order id from the form.
- Rate-limit lookups. Reuse `checkRateLimit` in `app/services/portal.server.ts`.
- Failed lookup copy is one sentence: “We couldn’t find that order.” Do not say whether the email or the order number was wrong.
- Show line items only after the order is verified.
- Guest access never lists other orders for that email.

## Step 1 — Register the proxy

In `shopify.app.toml` add:

```toml
[app_proxy]
url = "/proxy/returns"
prefix = "apps"
subpath = "returns"
```

Run `shopify app deploy` (or dev) so the shop serves `/apps/returns`.

Confirm on a dev store: opening `/apps/returns` hits this app and the query string includes `shop`, `signature`, `timestamp`, and `logged_in_customer_id` when a customer is logged in.

## Step 2 — Proxy route that renders in the theme

Add `app/routes/proxy.returns.tsx`.

- Authenticate with `authenticate.public.appProxy(request)`.
- Return HTML with `Content-Type: application/liquid` so Shopify wraps it in the theme.
- Do not use Polaris `s-page` or admin components. Use plain HTML and the theme’s existing classes where they exist (`button`, `field`). Add a small `<style>` block only for the return steps (stack, cards, errors).
- Pass `shop` from the authenticated proxy context into every form as a hidden field only as a display hint. The server ignores it and uses the signed shop.

Leave `app/routes/portal.tsx` unchanged in this step.

## Step 3 — Guest lookup

First screen when `logged_in_customer_id` is empty:

- Order number
- Email
- Submit “Find order”

Server calls the existing `lookupAndValidateOrder(shop, orderNumber, email, requestType)` in `app/services/portal.server.ts`. Request type can default to `return` on this screen and be changed on the next screen.

On success, issue a signed order token (order id, shop, expiry around 30 minutes) and render step 4. On failure, show the single generic error.

## Step 4 — Logged-in order list

When `logged_in_customer_id` is set:

- Load that customer’s recent orders with the shop’s Admin API session (offline session already stored for the shop).
- Render a list: order name, date, fulfillment status. Each row is a submit button.
- Choosing an order verifies the order’s `customer.id` matches `logged_in_customer_id`, then issues the same signed order token as the guest path.
- If the customer has no orders, show an empty state and the guest form as a fallback.

## Step 5 — Request type, resolution, items, and submit

Same screen for guest and logged-in customers, only if the order token is valid.

Load `getOrCreateSettings(shop)` and build the choices on the server. The form only lists what that shop turned on. On submit, ignore any posted value that is not in that list and return an error. Do not trust the browser.

### Request type

Show only types that are still inside the deadline from settings (`returnDeadlineDays`, `exchangeDeadlineDays`, `complaintDeadlineDays`, plus any deadline extension):

| Customer option | Stored `requestType` | Show when |
| --- | --- | --- |
| Return | `return` | Return deadline is still open |
| Exchange | `exchange` | Exchange deadline is still open |
| Complaint | `complaint` | Complaint deadline is still open |

If none are open, stop with the existing deadline error. Do not show a refund button here. Refund is a resolution on a return or complaint, not a third request type.

### Resolution (how they want it settled)

After they pick a request type, show the resolution choices that match **Resolution & store credit** (`app/routes/app.settings.resolutions.tsx`):

**Return**

- **Refund** is available unless refund deflection is on (`deflectionEnabled`). When deflection is on, hide refund and explain that the refund is offered as store credit.
- **Store credit** only if `storeCreditEnabled` is on. Show the bonus percent from `storeCreditBonusPercent` when it is greater than 0. Do not mention gift card vs Shopify store credit; `storeCreditMethod` is applied later by the app.
- **Exchange** only if the exchange deadline is still open. Ship timing (`exchangeShipTiming`) and reserve days are merchant rules. Do not ask the customer to pick them.

**Exchange**

- Resolution is exchange. No refund or store credit on this path.
- If the replacement variant is unavailable and `offerCreditWhenUnavailable` is on and store credit is on, offer store credit as the fallback. If that flag is off, block the item with “Not available for exchange.”

**Complaint** (`complaintResolutionMode`)

- `customer_chooses`: customer picks replacement or refund. Refund still hides when `deflectionEnabled` is on; store credit shows only when `storeCreditEnabled` is on.
- `always_replacement`: no choice. Save resolution as replacement.
- `always_refund`: no choice. Save resolution as refund, or store credit when deflection is on and store credit is enabled.
- `complaintRequireItemReturn` only changes the confirmation copy (item must be sent back, or not). It does not add a new option.

Save the chosen value on the return as `requestedResolution`: `refund`, `store_credit`, `exchange`, or `replacement`.

### Items and submit

1. Line items from the validated order. Skip items already marked excluded for that request type (`appliesToReturns` / `appliesToExchanges`).
2. Reason per selected item. Only reasons whose `appliesTo` includes the selected request type.
3. Photos and comment length follow `claimRequiresPhoto`, `claimMinPhotos`, and `claimMinCommentLength` when the request is a complaint. Other types keep the existing `MAX_PHOTO_SIZE` cap.
4. Submit calls `createReturnRequest` and `sendEventEmail`, same as `portal.tsx`, and stores `requestedResolution`.

Confirmation screen: request number and short next-step text. No order details beyond what they already submitted.

## Step 6 — Merchant entry points

- Theme app extension later: a “Start a return” link to `/apps/returns`. Not required for the proxy page itself.
- Order status and shipping emails can link to `https://{shop}/apps/returns`.
- Do not link customers to `https://grandlem-return-exchange-app.vercel.app/portal`.

## Step 7 — Check on a dev store

- Guest, correct order number and email: items appear inside the theme header and footer.
- Guest, wrong email: generic error, no items.
- Logged-in customer: their orders only. Opening another customer’s order id in the form is rejected.
- Submit creates a return visible in the admin returns list.
- Second shop install: `/apps/returns` on that shop uses that shop’s theme and orders.

## Out of this pass

- Customer Account UI extension (new customer accounts).
- Withdrawal flow (`/proxy/withdraw`) restyle. Same proxy pattern can be copied after returns work.
- Replacing the admin `portal.tsx` page.
