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
  revalidateOrderById,
  type CustomerOrderSummary,
  type PortalOrderResult,
} from "../services/portal.server";
import {
  issueOrderToken,
  verifyOrderToken,
  type ProxyOrderTokenPayload,
  type ProxyRequestType,
} from "../services/proxy-order-token.server";
import {
  pickResolution,
  resolutionChoices,
  type Resolution,
  type ResolutionChoices,
} from "../services/proxy-resolutions.server";
import { getOrCreateSettings } from "../services/settings.server";
import { getEffectiveDeadline, isExpired } from "../services/validation.server";
import { createReturnRequest } from "../services/returns.server";
import { sendEventEmail } from "../services/email.server";
import prisma from "../db.server";

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
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const MAX_COMMENT_LENGTH = 2000;

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
    resolutionLegend: "How would you like this settled?",
    resolutionFixed: "This request will be settled as:",
    resolutions: {
      refund: "Refund to the original payment method",
      store_credit: "Store credit",
      exchange: "Exchange for another size or item",
      replacement: "Replacement item",
    } as Record<Resolution, string>,
    bonus: (n: number) => `+${n}% bonus`,
    refundDeflected: "Refunds for this request are issued as store credit.",
    chooseItems: "Which items?",
    quantity: "Quantity",
    reason: "Reason",
    chooseReason: "Choose a reason",
    comment: "Comment",
    commentMin: (n: number) => `Describe the problem (at least ${n} characters).`,
    photos: "Photos",
    photosHint: "Images only, up to 5 MB each.",
    photosMin: (n: number) => `Add at least ${n} photo(s).`,
    submit: "Submit request",
    // Validation
    sessionExpired: "Your session has expired. Please find your order again.",
    pickResolution: "Choose how you’d like this settled.",
    pickItem: "Select at least one item.",
    badQuantity: (title: string) => `Choose a valid quantity for ${title}.`,
    pickReason: (title: string) => `Choose a reason for ${title}.`,
    commentTooLong: `Comments can be at most ${MAX_COMMENT_LENGTH} characters.`,
    imagesOnly: "Only image files are allowed.",
    photoTooBig: "Each photo must be 5 MB or smaller.",
    needPhotos: (n: number, title: string) => `Add at least ${n} photo(s) for ${title}.`,
    needComment: (n: number, title: string) => `The comment for ${title} must be at least ${n} characters.`,
    submitFailed: "We couldn’t submit your request. Please try again.",
    // Confirmation
    confirmedHeading: "Request received",
    requestNumber: "Request number",
    confirmedEmail: "We’ve sent a confirmation to the email on the order.",
    nextReturn: "We’ll review your request and email you the return instructions.",
    nextExchange: "We’ll review your request and email you the next steps for your exchange.",
    complaintReturnItem: "Please keep the item: you’ll need to send it back. We’ll email you instructions.",
    complaintKeepItem: "You don’t need to send the item back. We’ll email you once we’ve reviewed it.",
    startAnother: "Start another request",
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
    resolutionLegend: "Hur vill du att ärendet ska lösas?",
    resolutionFixed: "Ärendet kommer att lösas med:",
    resolutions: {
      refund: "Återbetalning till ursprungligt betalsätt",
      store_credit: "Tillgodohavande",
      exchange: "Byte till annan storlek eller artikel",
      replacement: "Ersättningsartikel",
    } as Record<Resolution, string>,
    bonus: (n: number) => `+${n}% bonus`,
    refundDeflected: "Återbetalning för detta ärende sker som tillgodohavande.",
    chooseItems: "Vilka artiklar?",
    quantity: "Antal",
    reason: "Orsak",
    chooseReason: "Välj en orsak",
    comment: "Kommentar",
    commentMin: (n: number) => `Beskriv problemet (minst ${n} tecken).`,
    photos: "Bilder",
    photosHint: "Endast bilder, högst 5 MB per bild.",
    photosMin: (n: number) => `Lägg till minst ${n} bild(er).`,
    submit: "Skicka ärende",
    sessionExpired: "Din session har gått ut. Sök upp din order igen.",
    pickResolution: "Välj hur du vill att ärendet ska lösas.",
    pickItem: "Välj minst en artikel.",
    badQuantity: (title: string) => `Välj ett giltigt antal för ${title}.`,
    pickReason: (title: string) => `Välj en orsak för ${title}.`,
    commentTooLong: `Kommentarer får vara högst ${MAX_COMMENT_LENGTH} tecken.`,
    imagesOnly: "Endast bildfiler är tillåtna.",
    photoTooBig: "Varje bild får vara högst 5 MB.",
    needPhotos: (n: number, title: string) => `Lägg till minst ${n} bild(er) för ${title}.`,
    needComment: (n: number, title: string) => `Kommentaren för ${title} måste vara minst ${n} tecken.`,
    submitFailed: "Vi kunde inte skicka ditt ärende. Försök igen.",
    confirmedHeading: "Ärendet är mottaget",
    requestNumber: "Ärendenummer",
    confirmedEmail: "Vi har skickat en bekräftelse till e-postadressen på ordern.",
    nextReturn: "Vi granskar ditt ärende och mejlar returinstruktioner.",
    nextExchange: "Vi granskar ditt ärende och mejlar nästa steg för ditt byte.",
    complaintReturnItem: "Behåll artikeln: du behöver skicka tillbaka den. Vi mejlar instruktioner.",
    complaintKeepItem: "Du behöver inte skicka tillbaka artikeln. Vi mejlar när vi har granskat ärendet.",
    startAnother: "Starta ett nytt ärende",
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

// ---------------------------------------------------------------------------
// Step 5: request details (resolution, items, reasons, photos)
// ---------------------------------------------------------------------------

type ReasonOption = { id: string; label: string };

type DetailsModel = {
  settings: Awaited<ReturnType<typeof getOrCreateSettings>>;
  choices: ResolutionChoices;
  reasons: ReasonOption[];
};

/** Previously posted values, used to refill the form after a validation error. */
type DetailsValues = {
  resolution?: string;
  selected: Set<string>;
  qty: Record<string, string>;
  reason: Record<string, string>;
  comment: Record<string, string>;
};

function reasonApplies(appliesTo: string, requestType: ProxyRequestType): boolean {
  const list = appliesTo.split(",").map((x) => x.trim().toLowerCase());
  return list.includes(requestType) || list.includes("any");
}

/** Everything the form may offer, built on the server from this shop's settings. */
async function loadDetailsModel(ctx: ProxyContext, result: PortalOrderResult): Promise<DetailsModel> {
  const settings = await getOrCreateSettings(ctx.shop);

  // "Exchange" as a settlement for a return is only offered while the
  // exchange deadline for this order is still open.
  let exchangeOpen = false;
  if (result.requestType === "return") {
    const numericId = String(result.order.id).split("/").pop() || result.order.id;
    const exchangeDeadline = await getEffectiveDeadline(
      ctx.shop,
      numericId,
      "exchange",
      new Date(result.order.createdAt),
    );
    exchangeOpen = !isExpired(exchangeDeadline);
  }

  const choices = resolutionChoices(settings, result.requestType, exchangeOpen);
  const reasons = result.reasons
    .filter((r) => reasonApplies(r.appliesTo, result.requestType))
    .map((r) => ({ id: r.id, label: ctx.lang === "sv" && r.labelSv ? r.labelSv : r.labelEn }));
  return { settings, choices, reasons };
}

function readDetailsValues(formData: FormData): DetailsValues {
  const values: DetailsValues = {
    resolution: String(formData.get("resolution") || "") || undefined,
    selected: new Set(formData.getAll("selected").map(String)),
    qty: {},
    reason: {},
    comment: {},
  };
  for (const [key, val] of formData.entries()) {
    if (typeof val !== "string") continue;
    if (key.startsWith("qty_")) values.qty[key.slice(4)] = val;
    else if (key.startsWith("reason_")) values.reason[key.slice(7)] = val;
    else if (key.startsWith("comment_")) values.comment[key.slice(8)] = val;
  }
  return values;
}

function resolutionLabel(ctx: ProxyContext, r: Resolution, choices: ResolutionChoices): string {
  const t = COPY[ctx.lang];
  const base = t.resolutions[r];
  return r === "store_credit" && choices.storeCreditBonusPercent > 0
    ? `${base} (${t.bonus(choices.storeCreditBonusPercent)})`
    : base;
}

function resolutionSection(ctx: ProxyContext, model: DetailsModel, selected?: string): string {
  const t = COPY[ctx.lang];
  const { choices } = model;
  const note = choices.refundDeflected ? `<p class="glr-muted">${esc(t.refundDeflected)}</p>` : "";
  if (choices.fixed) {
    return `<div class="glr-section"><p><strong>${esc(t.resolutionFixed)}</strong> ${esc(
      resolutionLabel(ctx, choices.fixed, choices),
    )}</p>${note}</div>`;
  }
  return (
    `<div class="glr-section">` +
    radioGroup({
      name: "resolution",
      legend: t.resolutionLegend,
      options: choices.options.map((r) => ({ value: r, label: resolutionLabel(ctx, r, choices) })),
      selected,
    }) +
    note +
    `</div>`
  );
}

function itemBlock(
  ctx: ProxyContext,
  model: DetailsModel,
  requestType: ProxyRequestType,
  li: PortalOrderResult["order"]["lineItems"][number],
  index: number,
  values: DetailsValues | null,
): string {
  const t = COPY[ctx.lang];
  if (li.excluded) {
    return `<li class="glr-item glr-item--disabled"><label class="glr-choice"><input type="checkbox" disabled> <span>${esc(
      li.title,
    )} × ${esc(li.quantity)} <span class="glr-muted">(${esc(t.notEligible)})</span></span></label></li>`;
  }

  const id = li.id;
  const domId = `glr-item-${index}`;
  const checked = values ? values.selected.has(id) : false;
  const qtyVal = values?.qty[id] ?? "1";
  const qtyOptions = Array.from({ length: li.quantity }, (_, i) => String(i + 1))
    .map((q) => `<option value="${q}"${q === qtyVal ? " selected" : ""}>${q}</option>`)
    .join("");

  const reasonVal = values?.reason[id] ?? "";
  const reasonSelect = model.reasons.length
    ? `<div class="glr-row"><label for="${domId}-reason">${esc(t.reason)}</label>
<select id="${domId}-reason" name="reason_${esc(id)}" class="select__select">
  <option value="">${esc(t.chooseReason)}</option>
  ${model.reasons
    .map((r) => `<option value="${esc(r.id)}"${r.id === reasonVal ? " selected" : ""}>${esc(r.label)}</option>`)
    .join("")}
</select></div>`
    : "";

  const isComplaint = requestType === "complaint";
  const minComment = isComplaint ? model.settings.claimMinCommentLength : 0;
  const minPhotos = isComplaint && model.settings.claimRequiresPhoto ? model.settings.claimMinPhotos : 0;

  return `<li class="glr-item">
  <label class="glr-choice"><input type="checkbox" name="selected" value="${esc(id)}"${checked ? " checked" : ""}>
    <span><strong>${esc(li.title)}</strong> <span class="glr-muted">× ${esc(li.quantity)}</span></span></label>
  <div class="glr-item__fields">
    <div class="glr-row"><label for="${domId}-qty">${esc(t.quantity)}</label>
      <select id="${domId}-qty" name="qty_${esc(id)}" class="select__select">${qtyOptions}</select></div>
    ${reasonSelect}
    <div class="glr-row"><label for="${domId}-comment">${esc(t.comment)}</label>
      <textarea id="${domId}-comment" name="comment_${esc(id)}" rows="3" maxlength="${MAX_COMMENT_LENGTH}" class="field__input glr-textarea">${esc(
        values?.comment[id] ?? "",
      )}</textarea>
      ${minComment > 0 ? `<p class="glr-muted">${esc(t.commentMin(minComment))}</p>` : ""}</div>
    <div class="glr-row"><label for="${domId}-photos">${esc(t.photos)}</label>
      <input id="${domId}-photos" type="file" name="photo_${esc(id)}" accept="image/*" multiple>
      <p class="glr-muted">${esc(t.photosHint)}${minPhotos > 0 ? ` ${esc(t.photosMin(minPhotos))}` : ""}</p></div>
  </div>
</li>`;
}

function detailsScreen(
  ctx: ProxyContext,
  result: PortalOrderResult,
  model: DetailsModel,
  token: string,
  back: LookupValues,
  opts: { error?: string; values?: DetailsValues } = {},
): string {
  const t = COPY[ctx.lang];
  const values = opts.values ?? null;

  const summary = `<dl class="glr-meta">
  <dt>${esc(t.order)}</dt><dd>${esc(result.order.name)}</dd>
  <dt>${esc(t.request)}</dt><dd>${esc(t.types[result.requestType])}</dd>
  <dt>${esc(t.deadline)}</dt><dd>${esc(formatDate(result.deadline, ctx.lang))}</dd>
</dl>`;

  const items = result.order.lineItems
    .map((li, i) => itemBlock(ctx, model, result.requestType, li, i, values))
    .join("");

  // The signed token is the only order reference posted back. orderNumber /
  // email are carried only to refill the lookup form on "Change request type".
  const details = form(
    ctx,
    "submit",
    `<input type="hidden" name="orderToken" value="${esc(token)}">
<input type="hidden" name="orderNumber" value="${esc(back.orderNumber)}">
<input type="hidden" name="email" value="${esc(back.email)}">
${resolutionSection(ctx, model, values?.resolution)}
<div class="glr-section"><h3 class="h5">${esc(t.chooseItems)}</h3><ul class="glr-list">${items}</ul></div>
<div class="glr-actions"><button type="submit" class="button button--primary">${esc(t.submit)}</button></div>`,
    { multipart: true },
  );

  // Changing the request type means running lookup again (doc, Step 3).
  const change = form(
    ctx,
    "restart",
    `<input type="hidden" name="orderNumber" value="${esc(back.orderNumber)}">
<input type="hidden" name="email" value="${esc(back.email)}">
<input type="hidden" name="requestType" value="${esc(back.requestType)}">
<button type="submit" class="link glr-link">${esc(t.changeType)}</button>`,
  );

  return page({
    title: t.title,
    body: errorBox(opts.error) + card(summary + details, t.verifiedHeading) + change,
  });
}

async function verifiedScreen(
  ctx: ProxyContext,
  result: PortalOrderResult,
  token: string,
  back: LookupValues,
): Promise<string> {
  const model = await loadDetailsModel(ctx, result);
  return detailsScreen(ctx, result, model, token, back);
}

function confirmationScreen(
  ctx: ProxyContext,
  requestNumber: string,
  requestType: ProxyRequestType,
  requireItemReturn: boolean,
): string {
  const t = COPY[ctx.lang];
  const next =
    requestType === "complaint"
      ? requireItemReturn
        ? t.complaintReturnItem
        : t.complaintKeepItem
      : requestType === "exchange"
        ? t.nextExchange
        : t.nextReturn;
  const body = card(
    `<dl class="glr-meta"><dt>${esc(t.requestNumber)}</dt><dd><strong>${esc(requestNumber)}</strong></dd></dl>
<p>${esc(next)}</p>
<p class="glr-muted">${esc(t.confirmedEmail)}</p>
<div class="glr-actions"><a class="button button--secondary" href="?">${esc(t.startAnother)}</a></div>`,
    t.confirmedHeading,
  );
  return page({ title: t.title, body });
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
  return await verifiedScreen(ctx, result, issueOrderToken(payload), values);
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
  return await verifiedScreen(ctx, result, token, values);
}

async function fileToDataUrl(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${buf.toString("base64")}`;
}

async function handleSubmit(ctx: ProxyContext, formData: FormData) {
  const t = COPY[ctx.lang];
  const back: LookupValues = {
    orderNumber: String(formData.get("orderNumber") || ""),
    email: String(formData.get("email") || ""),
  };

  // 1. The order comes only from the signed token, issued for this shop.
  const rawToken = String(formData.get("orderToken") || "");
  const token = verifyOrderToken(rawToken, ctx.shop);
  if (!token || (token.customerId && token.customerId !== ctx.loggedInCustomerId)) {
    return await startScreen(ctx, { error: t.sessionExpired, values: back });
  }
  back.requestType = token.requestType;

  // 2. Re-check fulfillment, exclusions, already-returned and deadline now.
  const result = await revalidateOrderById(ctx.shop, token.orderId, token.requestType);
  if (!result.ok) {
    return await startScreen(ctx, { error: lookupErrorMessage(ctx, result.code), values: back });
  }
  const model = await loadDetailsModel(ctx, result);
  const values = readDetailsValues(formData);
  const fail = (error: string) => detailsScreen(ctx, result, model, rawToken, back, { error, values });

  // 3. Resolution must be one this shop allows for this request type.
  const resolution = pickResolution(model.choices, values.resolution ?? null);
  if (!resolution) return fail(t.pickResolution);

  // 4. Items (same rules as portal.tsx, with reasons filtered by appliesTo).
  const { settings } = model;
  const isComplaint = token.requestType === "complaint";
  const items: Parameters<typeof createReturnRequest>[0]["items"] = [];

  for (const id of values.selected) {
    const li = result.order.lineItems.find((x) => x.id === id);
    if (!li || li.excluded) continue;

    const qty = Number(values.qty[id]);
    if (!Number.isInteger(qty) || qty < 1 || qty > li.quantity) return fail(t.badQuantity(li.title));

    const reasonId = (values.reason[id] || "").trim() || null;
    if (model.reasons.length > 0 && !reasonId) return fail(t.pickReason(li.title));
    if (reasonId && !model.reasons.some((r) => r.id === reasonId)) return fail(t.pickReason(li.title));

    const comment = (values.comment[id] || "").trim() || null;
    if (comment && comment.length > MAX_COMMENT_LENGTH) return fail(t.commentTooLong);

    const photos: { url: string; fileName?: string; mimeType?: string; size?: number }[] = [];
    for (const entry of formData.getAll(`photo_${id}`)) {
      if (!entry || typeof entry === "string") continue;
      const f = entry as File;
      if (f.size <= 0) continue;
      if (!f.type.startsWith("image/")) return fail(t.imagesOnly);
      if (f.size > MAX_PHOTO_SIZE) return fail(t.photoTooBig);
      photos.push({ url: await fileToDataUrl(f), fileName: f.name, mimeType: f.type, size: f.size });
    }

    if (isComplaint && settings.claimRequiresPhoto && photos.length < settings.claimMinPhotos) {
      return fail(t.needPhotos(settings.claimMinPhotos, li.title));
    }
    if (isComplaint && (comment?.length ?? 0) < settings.claimMinCommentLength) {
      return fail(t.needComment(settings.claimMinCommentLength, li.title));
    }

    items.push({
      shopifyLineItemId: li.id,
      productId: li.productId,
      variantId: li.variantId,
      title: li.title,
      quantity: qty,
      reasonId,
      comment,
      photos,
    });
  }
  if (items.length === 0) return fail(t.pickItem);

  // 5. Create, then set requestedResolution (same pattern as createWithdrawal).
  let created;
  try {
    created = await createReturnRequest({
      shop: ctx.shop,
      shopifyOrderId: result.order.id,
      orderNumber: result.order.name,
      market: null,
      customerEmail: result.order.email,
      customerName: null,
      type: token.requestType,
      items,
    });
    await prisma.returnRequest.update({
      where: { id: created.id },
      data: { requestedResolution: resolution },
    });
  } catch (e) {
    console.error("[proxy returns] submit failed", e);
    return fail(t.submitFailed);
  }

  await sendEventEmail(ctx.shop, "received", ctx.lang, result.order.email || "", {
    customerName: result.order.email || "customer",
    orderNumber: result.order.name,
    items: items.map((it) => it.title).join(", "),
  }).catch(() => null);

  return confirmationScreen(ctx, created.requestNumber ?? "", token.requestType, settings.complaintRequireItemReturn);
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

    case "submit":
      return liquid(await handleSubmit(ctx, formData), NO_STORE);
  }

  return liquid(await startScreen(ctx, { error: COPY[lang].unknownStage }), NO_STORE);
};
