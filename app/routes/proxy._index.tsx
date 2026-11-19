import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  card,
  errorBox,
  esc,
  field,
  form,
  page,
  radioGroup,
  readProxyContext,
  type ProxyContext,
  type ProxyLang,
} from "../services/proxy-returns-html.server";
import {
  checkRateLimit,
  listCustomerOrders,
  lookupAndValidateOrder,
  lookupOrderForCustomer,
  portalErrorCodeToMessage,
  type CustomerOrderSummary,
  type PortalOrderResult,
} from "../services/portal.server";
import {
  issueOrderToken,
  type ProxyOrderTokenPayload,
  type ProxyRequestType,
} from "../services/proxy-order-token.server";

// Storefront return page served through the Shopify app proxy:
//   https://{shop}/apps/returns  ->  {appUrl}/proxy
//   (the withdraw pages live under the same proxy: /apps/returns/withdraw -> /proxy/withdraw)
// See docs/storefront-return-proxy.md.
//
// Resource route: no React component. Every response is Liquid so Shopify
// renders it inside the shop's theme. Both loader and action verify the
// proxy signature; the shop always comes from the signed query string.

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

const REQUEST_TYPES: ProxyRequestType[] = ["return", "exchange", "complaint"];

const COPY = {
  en: {
    title: "Returns & exchanges",
    lead: "Start a return, exchange, or complaint for an order.",
    guestHeading: "Find your order",
    guestIntro: "Enter the order number and the email used at checkout.",
    loggedIn: "Choose the order you want to return or exchange.",
    yourOrders: "Your orders",
    noOrders: "We couldn’t find any orders on your account. You can still look up an order below.",
    ordersUnavailable: "We couldn’t load your orders right now. You can look up an order below.",
    otherOrder: "Order not listed?",
    status: {
      FULFILLED: "Fulfilled",
      PARTIALLY_FULFILLED: "Partially fulfilled",
      IN_PROGRESS: "In progress",
      UNFULFILLED: "Unfulfilled",
      ON_HOLD: "On hold",
      SCHEDULED: "Scheduled",
    } as Record<string, string>,
    requestType: "What would you like to do?",
    types: { return: "Return", exchange: "Exchange", complaint: "Complaint" },
    orderNumber: "Order number",
    email: "Email",
    findOrder: "Find order",
    notFound: "We couldn’t find that order.",
    unknownStage: "Something went wrong. Please start again.",
    verifiedHeading: "Order found",
    order: "Order",
    request: "Request",
    deadline: "Deadline",
    items: "Items",
    notEligible: "not eligible",
    changeType: "Change request type",
    nextStepPending: "Item selection is the next step.",
  },
  sv: {
    title: "Returer & byten",
    lead: "Starta en retur, ett byte eller en reklamation för en order.",
    guestHeading: "Hitta din order",
    guestIntro: "Ange ordernumret och e-postadressen från köpet.",
    loggedIn: "Välj ordern du vill returnera eller byta.",
    yourOrders: "Dina ordrar",
    noOrders: "Vi hittade inga ordrar på ditt konto. Du kan fortfarande söka upp en order nedan.",
    ordersUnavailable: "Vi kunde inte hämta dina ordrar just nu. Du kan söka upp en order nedan.",
    otherOrder: "Saknas ordern?",
    status: {
      FULFILLED: "Levererad",
      PARTIALLY_FULFILLED: "Delvis levererad",
      IN_PROGRESS: "Pågår",
      UNFULFILLED: "Ej levererad",
      ON_HOLD: "Pausad",
      SCHEDULED: "Schemalagd",
    } as Record<string, string>,
    requestType: "Vad vill du göra?",
    types: { return: "Retur", exchange: "Byte", complaint: "Reklamation" },
    orderNumber: "Ordernummer",
    email: "E-post",
    findOrder: "Hitta order",
    notFound: "Vi kunde inte hitta den ordern.",
    unknownStage: "Något gick fel. Börja om.",
    verifiedHeading: "Order hittad",
    order: "Order",
    request: "Ärende",
    deadline: "Sista dag",
    items: "Artiklar",
    notEligible: "kan inte väljas",
    changeType: "Byt ärendetyp",
    nextStepPending: "Nästa steg är att välja artiklar.",
  },
} as const;

function parseRequestType(value: FormDataEntryValue | null): ProxyRequestType | null {
  const v = String(value ?? "");
  return (REQUEST_TYPES as string[]).includes(v) ? (v as ProxyRequestType) : null;
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

type LookupValues = { requestType?: ProxyRequestType; orderNumber?: string; email?: string };

function guestLookupCard(ctx: ProxyContext, values: LookupValues = {}): string {
  const t = COPY[ctx.lang];
  const inner =
    `<p>${esc(t.guestIntro)}</p>` +
    requestTypeRadios(ctx, values.requestType) +
    field({ name: "orderNumber", label: t.orderNumber, value: values.orderNumber, required: true }) +
    field({ name: "email", label: t.email, type: "email", value: values.email, required: true, autocomplete: "email" }) +
    `<div class="glr-actions"><button type="submit" class="button button--primary">${esc(t.findOrder)}</button></div>`;
  return card(form(ctx, "lookup", inner), t.guestHeading);
}

function requestTypeRadios(ctx: ProxyContext, selected?: ProxyRequestType): string {
  const t = COPY[ctx.lang];
  return radioGroup({
    name: "requestType",
    legend: t.requestType,
    options: REQUEST_TYPES.map((v) => ({ value: v, label: t.types[v] })),
    selected,
  });
}

function statusLabel(ctx: ProxyContext, status: string | null): string {
  if (!status) return "";
  return COPY[ctx.lang].status[status] ?? status.replace(/_/g, " ").toLowerCase();
}

/** Logged-in list: one form, each order row is a submit button carrying its id. */
function customerOrdersCard(
  ctx: ProxyContext,
  orders: CustomerOrderSummary[],
  selectedType?: ProxyRequestType,
): string {
  const t = COPY[ctx.lang];
  const rows = orders
    .map(
      (o) => `<li><button type="submit" name="orderId" value="${esc(o.id)}" class="button button--secondary glr-order">
  <span class="glr-order__name">${esc(o.name)}</span>
  <span class="glr-muted">${esc(formatDate(o.createdAt, ctx.lang))}</span>
  <span class="glr-muted">${esc(statusLabel(ctx, o.fulfillmentStatus))}</span>
</button></li>`,
    )
    .join("");
  const inner = `<p>${esc(t.loggedIn)}</p>${requestTypeRadios(ctx, selectedType)}<ul class="glr-list">${rows}</ul>`;
  return card(form(ctx, "select_order", inner), t.yourOrders);
}

async function startScreen(
  ctx: ProxyContext,
  opts: { error?: string; values?: LookupValues } = {},
): Promise<string> {
  const t = COPY[ctx.lang];
  let body: string;

  if (ctx.loggedInCustomerId) {
    let orders: CustomerOrderSummary[] | null;
    try {
      orders = await listCustomerOrders(ctx.shop, ctx.loggedInCustomerId);
    } catch (e) {
      console.error("[proxy returns] listCustomerOrders failed", e);
      orders = null;
    }
    if (orders && orders.length > 0) {
      // Guest form stays available for orders placed without the account.
      body =
        customerOrdersCard(ctx, orders, opts.values?.requestType) +
        `<details class="glr-card"><summary>${esc(t.otherOrder)}</summary>${guestLookupCard(ctx, opts.values)}</details>`;
    } else {
      body =
        `<p class="glr-notice">${esc(orders ? t.noOrders : t.ordersUnavailable)}</p>` +
        guestLookupCard(ctx, opts.values);
    }
  } else {
    body = guestLookupCard(ctx, opts.values);
  }

  return page({ title: t.title, lead: t.lead, body: errorBox(opts.error) + body });
}

function formatDate(iso: string, lang: ProxyLang): string {
  try {
    return new Date(iso).toLocaleDateString(lang === "sv" ? "sv-SE" : "en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/**
 * Shown after the order is verified. Step 5 replaces the item list with the
 * resolution/items/reason form; the token is already carried in the form.
 */
function verifiedScreen(
  ctx: ProxyContext,
  result: PortalOrderResult,
  token: string,
  back: LookupValues,
): string {
  const t = COPY[ctx.lang];
  const eligible = new Set(result.eligibleLineItemIds);
  const items = result.order.lineItems
    .map(
      (li) =>
        `<li>${esc(li.title)} × ${esc(li.quantity)}${
          eligible.has(li.id) ? "" : ` <span class="glr-muted">(${esc(t.notEligible)})</span>`
        }</li>`,
    )
    .join("");

  const summary = `<dl class="glr-meta">
  <dt>${esc(t.order)}</dt><dd>${esc(result.order.name)}</dd>
  <dt>${esc(t.request)}</dt><dd>${esc(t.types[result.requestType])}</dd>
  <dt>${esc(t.deadline)}</dt><dd>${esc(formatDate(result.deadline, ctx.lang))}</dd>
</dl>
<h3 class="h5">${esc(t.items)}</h3>
<ul class="glr-list">${items}</ul>`;

  // Placeholder for Step 5. The token is the only order reference posted back.
  const next = form(
    ctx,
    "details",
    `<input type="hidden" name="orderToken" value="${esc(token)}">
<p class="glr-notice">${esc(t.nextStepPending)}</p>`,
  );

  // Changing the request type means running lookup again (doc, Step 3).
  const change = form(
    ctx,
    "restart",
    `<input type="hidden" name="orderNumber" value="${esc(back.orderNumber)}">
<input type="hidden" name="email" value="${esc(back.email)}">
<input type="hidden" name="requestType" value="${esc(back.requestType)}">
<div class="glr-actions"><button type="submit" class="button button--secondary">${esc(t.changeType)}</button></div>`,
  );

  return page({ title: t.title, body: card(summary + next + change, t.verifiedHeading) });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGuestLookup(request: Request, ctx: ProxyContext, formData: FormData) {
  const orderNumber = String(formData.get("orderNumber") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const requestType = parseRequestType(formData.get("requestType"));
  const values: LookupValues = { orderNumber, email, requestType: requestType ?? undefined };

  if (!orderNumber || !email || !requestType) {
    return await startScreen(ctx, { error: portalErrorCodeToMessage("INVALID_INPUT", ctx.lang), values });
  }

  // Two buckets: per client IP + shop, and per shop + order number so a single
  // order can't be brute-forced from many IPs.
  const normalizedOrder = orderNumber.replace(/^#/, "").toLowerCase();
  if (
    !checkRateLimit(`proxy:${clientIp(request)}:${ctx.shop}`) ||
    !checkRateLimit(`proxy-order:${ctx.shop}:${normalizedOrder}`)
  ) {
    return await startScreen(ctx, { error: portalErrorCodeToMessage("RATE_LIMITED", ctx.lang), values });
  }

  const result = await lookupAndValidateOrder(ctx.shop, orderNumber, email, requestType);
  if (!result.ok) {
    return await startScreen(ctx, { error: lookupErrorMessage(ctx, result.code), values });
  }

  const payload: Omit<ProxyOrderTokenPayload, "v" | "exp"> = {
    shop: ctx.shop,
    orderId: result.order.id,
    orderName: result.order.name,
    requestType,
    customerId: null,
  };
  return verifiedScreen(ctx, result, issueOrderToken(payload), values);
}

function lookupErrorMessage(ctx: ProxyContext, code: string): string {
  return code === "ORDER_NOT_FOUND" || code === "EMAIL_MISMATCH" || code === "SHOP_REQUIRED"
    ? COPY[ctx.lang].notFound
    : portalErrorCodeToMessage(code as Parameters<typeof portalErrorCodeToMessage>[0], ctx.lang);
}

async function handleSelectOrder(request: Request, ctx: ProxyContext, formData: FormData) {
  const customerId = ctx.loggedInCustomerId;
  const requestType = parseRequestType(formData.get("requestType"));
  const values: LookupValues = { requestType: requestType ?? undefined };
  if (!customerId) {
    // Session ended between page load and submit.
    return await startScreen(ctx, { error: COPY[ctx.lang].unknownStage });
  }
  // Untrusted: only used as a lookup key. Ownership is checked against the signed customer id.
  const orderId = String(formData.get("orderId") || "").trim();
  if (!orderId || !requestType) {
    return await startScreen(ctx, { error: portalErrorCodeToMessage("INVALID_INPUT", ctx.lang), values });
  }

  if (!checkRateLimit(`proxy-customer:${ctx.shop}:${customerId}`)) {
    return await startScreen(ctx, { error: portalErrorCodeToMessage("RATE_LIMITED", ctx.lang), values });
  }

  const result = await lookupOrderForCustomer(ctx.shop, orderId, customerId, requestType);
  if (!result.ok) {
    return await startScreen(ctx, { error: lookupErrorMessage(ctx, result.code), values });
  }

  const token = issueOrderToken({
    shop: ctx.shop,
    orderId: result.order.id,
    orderName: result.order.name,
    requestType,
    customerId,
  });
  return verifiedScreen(ctx, result, token, values);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Throws 400 if the proxy signature is missing or invalid.
  const { liquid } = await authenticate.public.appProxy(request);
  const ctx = readProxyContext(request);
  return liquid(await startScreen(ctx), NO_STORE);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { liquid } = await authenticate.public.appProxy(request);
  const signed = readProxyContext(request);
  const formData = await request.formData();
  // Posted `shop` is a display hint only and is deliberately ignored.
  const lang: ProxyLang = formData.get("lang") === "sv" ? "sv" : signed.lang;
  const ctx: ProxyContext = { ...signed, lang };
  const stage = String(formData.get("_stage") || "");

  // Error screens return 200 on purpose so they still render inside the theme.
  switch (stage) {
    case "lookup":
      // Guest form; also the fallback for logged-in customers (order not on their account).
      return liquid(await handleGuestLookup(request, ctx, formData), NO_STORE);

    case "select_order":
      return liquid(await handleSelectOrder(request, ctx, formData), NO_STORE);

    case "restart":
      return liquid(
        await startScreen(ctx, {
          values: {
            orderNumber: String(formData.get("orderNumber") || ""),
            email: String(formData.get("email") || ""),
            requestType: parseRequestType(formData.get("requestType")) ?? undefined,
          },
        }),
        NO_STORE,
      );

    // Step 5 adds "details" and "submit".
  }

  return liquid(await startScreen(ctx, { error: COPY[lang].unknownStage }), NO_STORE);
};
