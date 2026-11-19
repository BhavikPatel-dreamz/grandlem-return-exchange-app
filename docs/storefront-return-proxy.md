# Storefront return page (app proxy)

Customer returns stay on the merchant’s domain and inside that store’s theme. One app serves every installed shop. The existing admin route `app/routes/portal.tsx` stays for merchants. Customers use a new proxy page.

Do these steps in order. Do not start a later step until the earlier one works on a dev store.

## What the customer sees

Store URL: `https://{shop}/apps/returns`

Shopify forwards that URL to this app and, because the response is Liquid, renders it inside the theme (header, footer, fonts, colors).

Two ways in, one flow after the order is known:

1. **Logged-in customer.** Shopify customer session is present. Show that customer’s recent orders. They pick one. Do not ask for email.
2. **Guest.** No session. Ask for order number and the email on the order. Both must match the same order.

Then both paths use the same steps as today’s portal: request type, items, reason, submit, confirmation. The new page also asks how to settle the request, which the current portal does not. The merchant sets that later on the return in admin (`requestedResolution` on `app/routes/app.returns.$id.tsx`).

## What the app does today

`app/routes/portal.tsx` and `lookupAndValidateOrder` in `app/services/portal.server.ts`:

- Customer picks **Return**, **Exchange**, or **Complaint** before “Find order”. That value is sent into lookup. Deadline, item exclusion, and the deadline date all depend on it. Changing the type means running lookup again. The three types are always shown. Deadline settings do not hide a type up front. An expired type fails lookup with `DEADLINE_EXPIRED`.
- Lookup also requires a fulfilled order and a matching email. Errors today are specific (`ORDER_NOT_FOUND`, `EMAIL_MISMATCH`, `NOT_FULFILLED`). The proxy page keeps one public message for a wrong order or email. Other codes (`NOT_FULFILLED`, `DEADLINE_EXPIRED`, `ALL_ITEMS_EXCLUDED_OR_RETURNED`) stay specific, using `portalErrorCodeToMessage`.
- After a match, the customer selects items, quantity, reason, comment, and photos. Complaint photo count and comment length already follow `claimRequiresPhoto`, `claimMinPhotos`, and `claimMinCommentLength`.
- `createReturnRequest` saves `type` only. It does not accept `requestedResolution`. Withdrawal sets that field in a second update (`app/services/withdrawal.server.ts`).
- Active reasons are loaded with `listReturnReasons(shop, true)`. The current portal does not filter `appliesTo`. The proxy page will.
- These admin settings are saved and not used by the customer portal: `deflectionEnabled`, `storeCreditEnabled`, `storeCreditBonusPercent`, `complaintResolutionMode`, `complaintRequireItemReturn`, `offerCreditWhenUnavailable`. Ship timing and reserve days are merchant-only. The proxy page must start enforcing the ones that change what the customer can pick. `offerCreditWhenUnavailable` stays unused until the app can tell that a replacement variant is out of stock. Nothing does that check today.

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
url = "/proxy"
prefix = "apps"
subpath = "returns"
```

Run `shopify app deploy` (or dev) so the shop serves `/apps/returns`.

An app has only one app proxy, so it points at `/proxy`, not `/proxy/returns`. `/apps/returns` maps to `/proxy` (returns page) and `/apps/returns/withdraw` maps to `/proxy/withdraw` (existing withdrawal routes).

Confirm on a dev store: opening `/apps/returns` hits this app and the query string includes `shop`, `signature`, `timestamp`, and `logged_in_customer_id` when a customer is logged in.

## Step 2 — Proxy route that renders in the theme

Add `app/routes/proxy._index.tsx` (serves `/proxy`).

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

Same fields as the current portal, in this order:

- Request type: Return, Exchange, Complaint
- Order number
- Email
- Submit “Find order”

Server calls `lookupAndValidateOrder(shop, orderNumber, email, requestType)`. If they change request type, submit lookup again. Do not reuse a result from another type.

On success, issue a signed order token (order id, shop, request type, expiry around 30 minutes) and render step 5. On `ORDER_NOT_FOUND` or `EMAIL_MISMATCH`, show “We couldn’t find that order.” Show the existing message for the other error codes.

## Step 4 — Logged-in order list

When `logged_in_customer_id` is set:

- Load that customer’s recent orders with the shop’s Admin API session (offline session already stored for the shop).
- Render a list: order name, date, fulfillment status. Each row is a submit button.
- Choosing an order still needs a request type, then verifies the order’s `customer.id` matches `logged_in_customer_id`, then runs the same deadline and exclusion checks as `lookupAndValidateOrder` for that type. Issue the same signed order token as the guest path. There is no logged-in lookup helper today, so this check is new and must not skip fulfillment, deadline, or exclusion.
- If the customer has no orders, show an empty state and the guest form as a fallback.

## Step 5 — Request type, resolution, items, and submit

Same screen for guest and logged-in customers, only if the order token is valid.

Load `getOrCreateSettings(shop)` and build the choices on the server. The form only lists what that shop turned on. On submit, ignore any posted value that is not in that list and return an error. Do not trust the browser.

### Request type

Keep the current three options. Do not hide one before lookup.

| Customer option | Stored `type` | Deadline setting used at lookup |
| --- | --- | --- |
| Return | `return` | `returnDeadlineDays` |
| Exchange | `exchange` | `exchangeDeadlineDays` |
| Complaint | `complaint` | `complaintDeadlineDays` |

Deadline extensions still apply inside `getEffectiveDeadline`. If that type is expired, lookup returns `DEADLINE_EXPIRED`. Refund is not a request type. It is `requestedResolution` on a return or complaint.

### Resolution (how they want it settled)

After they pick a request type, show the resolution choices that match **Resolution & store credit** (`app/routes/app.settings.resolutions.tsx`):

**Return**

- **Refund** is available unless refund deflection is on (`deflectionEnabled`). When deflection is on, hide refund and explain that the refund is offered as store credit.
- **Store credit** only if `storeCreditEnabled` is on. Show the bonus percent from `storeCreditBonusPercent` when it is greater than 0. Do not mention gift card vs Shopify store credit; `storeCreditMethod` is applied later by the app.
- **Exchange** only if the exchange deadline is still open. Ship timing (`exchangeShipTiming`) and reserve days are merchant rules. Do not ask the customer to pick them.

**Exchange**

- Resolution is `exchange`. No refund or store credit picker on this path.
- Leave `offerCreditWhenUnavailable` unused in this pass. The app does not check replacement stock yet. Do not add a store-credit fallback until that check exists.

**Complaint** (`complaintResolutionMode`)

- `customer_chooses`: customer picks replacement or refund. Refund still hides when `deflectionEnabled` is on; store credit shows only when `storeCreditEnabled` is on.
- `always_replacement`: no choice. Save resolution as replacement.
- `always_refund`: no choice. Save resolution as refund, or store credit when deflection is on and store credit is enabled.
- `complaintRequireItemReturn` only changes the confirmation copy (item must be sent back, or not). It does not add a new option.

Save the chosen value on the return as `requestedResolution`: `refund`, `store_credit`, `exchange`, or `replacement`.

### Items and submit

1. Line items from the validated order. `isItemExcluded` already applies `appliesToReturns`, `appliesToExchanges`, and complaints for the request type passed into lookup. Skip `excluded` items the same way `portal.tsx` does.
2. Reason per selected item. Filter to active reasons whose `appliesTo` contains the request type (or `any`). The current portal lists every active reason; the proxy page filters.
3. Photos and comment length: copy the complaint checks in `portal.tsx` (`claimRequiresPhoto`, `claimMinPhotos`, `claimMinCommentLength`, images only, 5MB).
4. Submit calls `createReturnRequest` and `sendEventEmail` the same way as `portal.tsx`. Then set `requestedResolution` with `prisma.returnRequest.update`, the same pattern as `createWithdrawal`. Do not pass resolution into `createReturnRequest` until that function grows a field for it. Reject a posted resolution that the settings do not allow.

Confirmation screen: request number and short next-step text. No order details beyond what they already submitted.

## Step 6 — Merchant entry points

- Theme app extension later: a “Start a return” link to `/apps/returns`. Not required for the proxy page itself.
- Order status and shipping emails can link to `https://{shop}/apps/returns`.
- Do not link customers to `https://grandlem-return-exchange-app.vercel.app/portal`.

## Step 7 — Check on a dev store

Automated: `npm test` runs these checks (and the security rules above) against the real proxy route with Shopify and the database faked (`tests/proxy-returns.test.ts`). It does not replace the dev-store pass below: theme rendering, the real proxy signature, and photo uploads through the proxy only show up on a store.

- Guest, correct order number and email: items appear inside the theme header and footer.
- Guest, wrong email: generic error, no items.
- Logged-in customer: their orders only. Opening another customer’s order id in the form is rejected.
- Submit creates a return visible in the admin returns list.
- Second shop install: `/apps/returns` on that shop uses that shop’s theme and orders.

## Out of this pass

- Customer Account UI extension (new customer accounts).
- Withdrawal flow (`/proxy/withdraw`) restyle. Same proxy pattern can be copied after returns work.
- Replacing the admin `portal.tsx` page.
