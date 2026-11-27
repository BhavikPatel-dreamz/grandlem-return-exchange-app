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
} from "./proxy-returns-html";
import {
  checkRateLimit,
  listCustomerOrders,
  lookupAndValidateOrder,
  lookupOrderForCustomer,
  lookupAndValidateOrderBasic,
  lookupOrderForCustomerBasic,
  portalErrorCodeToMessage,
  revalidateOrderById,
  type CustomerOrderSummary,
  type PortalOrderResult,
} from "./portal.server";
import {
  issueOrderToken,
  verifyOrderToken,
  type ProxyOrderTokenPayload,
  type ProxyRequestType,
} from "./proxy-order-token.server";
import {
  pickResolution,
  resolutionChoices,
  type Resolution,
  type ResolutionChoices,
} from "./proxy-resolutions.server";
import {
  getLabelTimingForMarket,
  getOrCreateSettings,
  getReturnFormCustomization,
  getReturnImageCommentConfig,
} from "./settings.server";
import { getEffectiveDeadline, isExpired } from "./validation.server";
import { createReturnRequest } from "./returns.server";
import { createReturnLabel } from "./shippypro.server";
import { sendEventEmail } from "./email.server";
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
    eyebrow: "RETURNS & EXCHANGES",
    title: "Returns & exchanges",
    lead: "Start a return, exchange, or complaint for an order.",
    guestHeading: "Let's find your order",
    guestIntro: "Enter your order number and the email or phone number used at checkout, we'll pull up the rest.",
    loggedIn: "Choose the order you want to return or exchange.",
    yourOrders: "Your Orders",
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
    requestType: "What would you like to do with this order?",
    types: { return: "Return", exchange: "Exchange", complaint: "Complaint" },
    typeDescriptions: {
      return: "Send items back for a refund.",
      exchange: "Replace with a different size, color, or item.",
      complaint: "Report an issue with this order.",
    },
    orderNumber: "Order number",
    email: "Email/Phone number",
    orderNumberPlaceholder: "# 000001",
    emailPlaceholder: "example@mail.com",
     findOrder: "Find my order",
    returnPolicy: "Return policy",
    help: "Help?",
    next: "Next",
    submitRequest: "Submit request",
    dragAndDrop: "Choose files or drag and drop",
    chooseFilesBtn: "Choose files",
    backToDetails: "Back to details",
    returnSummaryTitle: "Your return summary",
    exchangeSummaryTitle: "Your exchange summary",
    complaintSummaryTitle: "Your complaint summary",
    itemsReturning: "Items you're returning",
    itemsExchanging: "Items you're exchanging",
    itemsReporting: "Items you're reporting",
    itemsCount: (n: number) => `${n} item(s)`,
    requestDetailsHeading: "Request details",
    requestTypeLabel: "Request type",
    reasonLabel: "Reason",
    commentLabel: "Comment",
    uploadedPhotosLabel: "Uploaded photos",
    estimatedRefund: "Estimated refund",
    refundDisclaimer: "* The final refund amount is subject to applied deductions, shipping costs and store policy.",
    confirmReturnRequest: "Confirm return request",
    confirmExchangeRequest: "Confirm exchange request",
    confirmComplaintRequest: "Confirm complaint request",
    agreePolicy: (shop: string) => `By confirming you agree to ${shop}'s `,
    notFound: "It seems like the order number and/or email you have entered did not match our records. Please double-check and try again.",
    unknownStage: "Something went wrong. Please start again.",
    verifiedHeading: "Order found",
    order: "Order",
    request: "Request",
    deadline: "Deadline",
    purchaseDate: "Purchase date",
    deadlineDependsOnType: "Depends on request type",
    items: "Items",
    notEligible: "not eligible",
    noEligibleItems: "No eligible items.",
changeType: "Change request type",
     resolutionLegend: "How would you like this settled?",
     resolutionFixed: "This request will be settled as:",
     edit: "Edit",
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

function guestLookupCard(ctx: ProxyContext, values: LookupValues = {}, error?: string): string {
  const t = COPY[ctx.lang];
  const isFilled = Boolean(values.orderNumber?.trim() && values.email?.trim());
  const inner = `<div class="glr-field-wrap">
  <label class="glr-field-label" for="glr-orderNumber">${esc(t.orderNumber)}</label>
  <input class="glr-field-input" id="glr-orderNumber" name="orderNumber" type="text"
    value="${esc(values.orderNumber ?? "")}" placeholder="${esc(t.orderNumberPlaceholder)}" required>
</div>
<div class="glr-field-wrap">
  <label class="glr-field-label" for="glr-email">${esc(t.email)}</label>
  <input class="glr-field-input" id="glr-email" name="email" type="text"
    value="${esc(values.email ?? "")}" placeholder="${esc(t.emailPlaceholder)}" required autocomplete="email">
</div>
${errorBox(error)}
<div class="glr-button-wrap">
  <button type="submit" class="glr-submit-button ${isFilled ? "glr-btn-active" : ""}">${esc(t.findOrder)}</button>
</div>
<script>
(function() {
  function initBtnSync() {
    var form = document.querySelector('.glr-order-card form');
    if (!form) return;
    var orderInput = form.querySelector('#glr-orderNumber');
    var emailInput = form.querySelector('#glr-email');
    var btn = form.querySelector('.glr-submit-button');
    if (!orderInput || !emailInput || !btn) return;
    function updateBtn() {
      var oVal = (orderInput.value || '').trim();
      var eVal = (emailInput.value || '').trim();
      if (oVal.length > 0 && eVal.length > 0) {
        btn.classList.add('glr-btn-active');
      } else {
        btn.classList.remove('glr-btn-active');
      }
    }
    ['input', 'change', 'keyup', 'paste'].forEach(function(evt) {
      orderInput.addEventListener(evt, updateBtn);
      emailInput.addEventListener(evt, updateBtn);
    });
    updateBtn();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBtnSync);
  } else {
    initBtnSync();
  }
})();
</script>`;
  return `<div class="glr-order-card">${form(ctx, "lookup", inner)}</div>`;
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
): string {
  const pageSize = 5;
  const totalPages = Math.ceil(orders.length / pageSize) || 1;

  const rows = orders
    .map((o, idx) => {
      const isHidden = idx >= pageSize;
      const isFulfilled = (o.fulfillmentStatus ?? "").toUpperCase() === "FULFILLED";
      const isPartially = (o.fulfillmentStatus ?? "").toUpperCase() === "PARTIALLY_FULFILLED";
      const statusClass = isFulfilled ? "fulfilled" : isPartially ? "partially" : "other";
      const displayStatus = o.fulfillmentStatus ? statusLabel(ctx, o.fulfillmentStatus) : "Fulfilled";

      return `<li class="glr-order-item-wrap"${isHidden ? ' style="display:none;"' : ""} data-order-name="${esc(o.name.toLowerCase())}">
  <button type="submit" name="orderId" value="${esc(o.id)}" class="glr-order-row-btn">
    <div class="glr-order-pkg-box">
      <svg class="glr-box-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
        <line x1="12" y1="22.08" x2="12" y2="12"></line>
      </svg>
    </div>
    <span class="glr-order-row-name">${esc(o.name)}</span>
    <span class="glr-order-row-date">
      <svg class="glr-cal-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
      <span>${esc(formatDate(o.createdAt))}</span>
    </span>
    <span class="glr-order-status-wrap">
      <span class="glr-status-badge glr-status-badge--${statusClass}">
        ${isFulfilled ? '<span class="glr-status-check">✓</span> ' : ""}${esc(displayStatus)}
      </span>
    </span>
    <span class="glr-order-row-chevron">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </span>
  </button>
</li>`;
    })
    .join("");

  let pageButtons = "";
  for (let p = 1; p <= totalPages; p++) {
    pageButtons += `<button type="button" class="glr-pag-num${p === 1 ? " glr-pag-num--active" : ""}" data-page="${p}">${p}</button>`;
  }

  const paginationHtml = `<div class="glr-orders-pagination" id="glr-orders-pagination"${totalPages <= 1 ? ' style="display:none;"' : ""}>
    <button type="button" class="glr-pag-arrow glr-pag-disabled" id="glr-prev-btn" aria-label="Previous page" disabled>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
    </button>
    <div class="glr-pag-pages" id="glr-pag-pages">
      ${pageButtons}
    </div>
    <button type="button" class="glr-pag-arrow${totalPages <= 1 ? " glr-pag-disabled" : ""}" id="glr-next-btn" aria-label="Next page"${totalPages <= 1 ? " disabled" : ""}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
    </button>
  </div>`;

  const searchBox = `<div class="glr-orders-search-wrap">
    <svg class="glr-orders-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
    <input type="text" id="glr-orders-search" class="glr-orders-search-input" placeholder="Search by order number (e.g. #1028)" autocomplete="off" style="border:none!important;outline:none!important;box-shadow:none!important;background:transparent!important;padding:0!important;height:100%!important;min-height:0!important;width:100%!important;-webkit-appearance:none!important;appearance:none!important;">
  </div>`;

  const script = `<script>
(function() {
  var pageSize = 5;
  var currentPage = 1;
  var list = document.getElementById('glr-orders-list');
  if (!list) return;
  var items = Array.prototype.slice.call(list.querySelectorAll('.glr-order-item-wrap'));
  var searchInput = document.getElementById('glr-orders-search');
  var pagContainer = document.getElementById('glr-orders-pagination');
  var pagPages = document.getElementById('glr-pag-pages');
  var prevBtn = document.getElementById('glr-prev-btn');
  var nextBtn = document.getElementById('glr-next-btn');
  var noResults = document.getElementById('glr-no-search-results');

  function getMatchingItems() {
    var q = searchInput ? (searchInput.value || '').trim().toLowerCase() : '';
    if (!q) return items;
    var cleanQ = q.replace(/^#/, '');
    return items.filter(function(el) {
      var name = (el.getAttribute('data-order-name') || '').toLowerCase();
      var cleanName = name.replace(/^#/, '');
      return name.indexOf(q) !== -1 || cleanName.indexOf(cleanQ) !== -1;
    });
  }

  function render() {
    var matched = getMatchingItems();
    var total = matched.length;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    if (noResults) {
      noResults.style.display = total === 0 ? 'block' : 'none';
    }

    items.forEach(function(el) { el.style.display = 'none'; });

    var start = (currentPage - 1) * pageSize;
    var end = start + pageSize;
    for (var i = start; i < end && i < total; i++) {
      matched[i].style.display = 'block';
    }

    if (pagContainer) {
      pagContainer.style.display = totalPages <= 1 ? 'none' : 'flex';
    }

    if (prevBtn) {
      prevBtn.disabled = currentPage <= 1;
      prevBtn.classList.toggle('glr-pag-disabled', currentPage <= 1);
    }
    if (nextBtn) {
      nextBtn.disabled = currentPage >= totalPages;
      nextBtn.classList.toggle('glr-pag-disabled', currentPage >= totalPages);
    }

    if (pagPages) {
      pagPages.innerHTML = '';
      for (var p = 1; p <= totalPages; p++) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'glr-pag-num' + (p === currentPage ? ' glr-pag-num--active' : '');
        btn.textContent = p;
        btn.setAttribute('data-page', p);
        (function(pageIndex) {
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            currentPage = pageIndex;
            render();
          });
        })(p);
        pagPages.appendChild(btn);
      }
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', function() {
      currentPage = 1;
      render();
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener('click', function(e) {
      e.preventDefault();
      if (currentPage > 1) {
        currentPage--;
        render();
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', function(e) {
      e.preventDefault();
      var matched = getMatchingItems();
      var totalPages = Math.ceil(matched.length / pageSize) || 1;
      if (currentPage < totalPages) {
        currentPage++;
        render();
      }
    });
  }
  render();
})();
</script>`;

  const formInner = `${searchBox}<ul class="glr-orders-list" id="glr-orders-list">${rows}<li id="glr-no-search-results" class="glr-no-search-results" style="display:none;">No orders found matching your search.</li></ul>${paginationHtml}${script}`;

  return `<div class="glr-orders-card">${form(ctx, "select_order", formInner)}</div>`;
}

async function startScreen(
  ctx: ProxyContext,
  opts: { error?: string; values?: LookupValues } = {},
): Promise<string> {
  const t = COPY[ctx.lang];
  const settings = await getOrCreateSettings(ctx.shop);
  const customization = getReturnFormCustomization(settings);
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
      const headerIcon = `<div class="glr-header-icon-box">
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
    <line x1="12" y1="22.08" x2="12" y2="12"></line>
  </svg>
</div>`;

      const unlistedCard = `<div class="glr-unlisted-card">
  <div class="glr-unlisted-left">
    <div class="glr-unlisted-icon">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    </div>
    <div class="glr-unlisted-content">
      <div class="glr-unlisted-title">${esc(t.otherOrder)}</div>
      <div class="glr-unlisted-subtitle">You can still request a return or exchange manually.</div>
    </div>
  </div>
  <button type="button" class="glr-unlisted-btn" id="glr-unlisted-toggle-btn">Find Order</button>
</div>
<div class="glr-unlisted-guest-wrap${opts.error ? "" : " glr-hidden"}" id="glr-unlisted-guest-wrap"${opts.error ? "" : ' style="display:none;"'}>
  ${guestLookupCard(ctx, opts.values, opts.error)}
</div>
<script>
(function() {
  var toggleBtn = document.getElementById('glr-unlisted-toggle-btn');
  var formWrap = document.getElementById('glr-unlisted-guest-wrap');
  if (toggleBtn && formWrap) {
    toggleBtn.addEventListener('click', function(e) {
      e.preventDefault();
      var isHidden = formWrap.style.display === 'none' || formWrap.classList.contains('glr-hidden');
      if (isHidden) {
        formWrap.style.display = 'block';
        formWrap.classList.remove('glr-hidden');
        formWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        formWrap.style.display = 'none';
        formWrap.classList.add('glr-hidden');
      }
    });
  }
})();
</script>`;

      body =
        (opts.error ? errorBox(opts.error) : "") +
        customerOrdersCard(ctx, orders) +
        unlistedCard;

      return page({
        headerIcon,
        eyebrow: t.eyebrow,
        title: t.yourOrders,
        lead: t.loggedIn,
        body,
        showTopbar: true,
        showFooter: true,
        lang: ctx.lang,
        isOrderPage: true,
        customization,
      });
    } else {
      body =
        `<p class="glr-notice" style="max-width:450px;margin:0 auto 1.5rem;">${esc(orders ? t.noOrders : t.ordersUnavailable)}</p>` +
        guestLookupCard(ctx, opts.values, opts.error);
    }
  } else {
    body = guestLookupCard(ctx, opts.values, opts.error);
  }

  return page({
    eyebrow: t.eyebrow,
    title: t.guestHeading,
    lead: t.guestIntro,
    body,
    showTopbar: true,
    showFooter: true,
    lang: ctx.lang,
    isOrderPage: true,
    customization,
  });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
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

type ReasonOption = { id: string; label: string; parentLabel?: string };

type DetailsModel = {
  settings: Awaited<ReturnType<typeof getOrCreateSettings>>;
  choices: ResolutionChoices;
  reasons: ReasonOption[];
};

/** Previously posted values, used to refill the form after a validation error. */
type PhotoAttachment = { url: string; fileName?: string; mimeType?: string; size?: number };

type DetailsValues = {
  resolution?: string;
  selected: Set<string>;
  qty: Record<string, string>;
  reason: Record<string, string>;
  comment: Record<string, string>;
  photos: Record<string, PhotoAttachment[]>;
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
  const reasons = (result.reasons || [])
    .filter((r) => reasonApplies(r.appliesTo, result.requestType))
    .map((r) => ({ id: r.id, label: r.labelEn, parentLabel: r.parentLabel }));
  return { settings, choices, reasons };
}

async function readDetailsValues(formData: FormData): Promise<DetailsValues> {
  const values: DetailsValues = {
    resolution: String(formData.get("resolution") || "") || undefined,
    selected: new Set(formData.getAll("selected").map(String)),
    qty: {},
    reason: {},
    comment: {},
    photos: {},
  };
  for (const [key, val] of formData.entries()) {
    if (typeof val !== "string") continue;
    if (key.startsWith("qty_")) values.qty[key.slice(4)] = val;
    else if (key.startsWith("reason_")) values.reason[key.slice(7)] = val;
    else if (key.startsWith("comment_")) values.comment[key.slice(8)] = val;
  }

  const sharedPhotos: PhotoAttachment[] = [];
  for (const entry of formData.getAll("photo")) {
    if (!entry || typeof entry === "string") continue;
    const file = entry as File;
    if (file.size <= 0 || !file.type.startsWith("image/") || file.size > MAX_PHOTO_SIZE) continue;
    sharedPhotos.push({
      url: await fileToDataUrl(file),
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });
  }
  for (const id of values.selected) {
    values.photos[id] = sharedPhotos;
  }

  for (const [key, val] of formData.entries()) {
    if (!key.startsWith("photo_") || typeof val !== "string") continue;
    try {
      values.photos[key.slice(6)] = JSON.parse(val) as PhotoAttachment[];
    } catch {}
  }

  for (const id of values.selected) {
    const itemPhotos: PhotoAttachment[] = values.photos[id] ? [...values.photos[id]] : [];
    for (const entry of formData.getAll(`photo_${id}`)) {
      if (!entry || typeof entry === "string") continue;
      const file = entry as File;
      if (file.size <= 0 || !file.type.startsWith("image/") || file.size > MAX_PHOTO_SIZE) continue;
      itemPhotos.push({
        url: await fileToDataUrl(file),
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      });
    }
    if (itemPhotos.length > 0) {
      values.photos[id] = itemPhotos;
    }
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

function formatShopDisplayName(shop: string): string {
  const base = shop.replace(/\.myshopify\.com$/, "");
  return (
    base
      .split(/[-_.]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || shop
  );
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

  // 1. Identify selected line items
  const selectedIds = new Set<string>();
  if (values) {
    for (const id of values.selected) selectedIds.add(id);
  } else {
    for (const li of result.order.lineItems) {
      if (!li.excluded) selectedIds.add(li.id);
    }
  }

  // 2. Titles based on requestType
  let pageTitle: string = t.returnSummaryTitle;
  let itemsCardTitle: string = t.itemsReturning;
  let confirmBtnText: string = t.confirmReturnRequest;
  let badgeText = t.types.return.toUpperCase();
  if (result.requestType === "exchange") {
    pageTitle = t.exchangeSummaryTitle;
    itemsCardTitle = t.itemsExchanging;
    confirmBtnText = t.confirmExchangeRequest;
    badgeText = t.types.exchange.toUpperCase();
  } else if (result.requestType === "complaint") {
    pageTitle = t.complaintSummaryTitle;
    itemsCardTitle = t.itemsReporting;
    confirmBtnText = t.confirmComplaintRequest;
    badgeText = t.types.complaint.toUpperCase();
  }

  // 3. Line items in Card 1 & Price calculation
  let totalEstimated = 0;
  let hasValidPrice = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderCurrency = (result.order as any).currencyCode || "";

  const itemsHtml = result.order.lineItems
    .filter((li) => selectedIds.has(li.id))
    .map((li) => {
      const qty = values?.qty[li.id] || String(li.quantity);
      const numPrice = li.variantPrice ? parseFloat(li.variantPrice.replace(/[^0-9.]/g, "")) : NaN;
      if (!isNaN(numPrice)) {
        totalEstimated += numPrice * (parseInt(qty, 10) || 1);
        hasValidPrice = true;
      }
      if (!orderCurrency && li.variantPrice) {
        const m = li.variantPrice.match(/[A-Z]{3}/);
        if (m) orderCurrency = m[0];
      }

      const img = li.variantImage
        ? `<img src="${esc(li.variantImage.url)}" alt="${esc(li.variantImage.altText ?? li.title)}" class="glr-summary-item-img">`
        : `<div class="glr-summary-item-img glr-product-img--placeholder">📦</div>`;

      const reasonVal = values?.reason[li.id] || "";
      const reasonObj = model.reasons.find((r) => r.id === reasonVal);
      const reasonLabel = reasonObj ? reasonObj.label : "";

      const priceFormatted = li.variantPrice
        ? li.variantPrice.includes(" ") || li.variantPrice.startsWith("$")
          ? li.variantPrice
          : `${li.variantPrice}${orderCurrency ? ` ${orderCurrency}` : ""}`
        : "";

      return `
        <div class="glr-summary-item">
          <div class="glr-summary-item-img-wrap">${img}</div>
          <div class="glr-summary-item-info">
            <div class="glr-summary-item-title-row">
              <strong class="glr-summary-item-title">${esc(li.title)}</strong>
              <span class="glr-type-badge">${esc(badgeText)}</span>
            </div>
            ${reasonLabel ? `<div class="glr-summary-item-meta">${esc(reasonLabel)}</div>` : ""}
            <div class="glr-summary-item-qty">Qty: ${esc(qty)}</div>
          </div>
          ${priceFormatted ? `<div class="glr-summary-item-price">${esc(priceFormatted)}</div>` : ""}
        </div>
      `;
    })
    .join("");

  if (!orderCurrency) orderCurrency = "INR";
  const displayTotal = hasValidPrice
    ? `${totalEstimated.toFixed(2)} ${orderCurrency}`
    : result.order.lineItems[0]?.variantPrice
      ? `${result.order.lineItems[0].variantPrice}${orderCurrency ? ` ${orderCurrency}` : ""}`
      : `0.00 ${orderCurrency}`;

  // 4. Request details rows for Card 2
  const primaryReasonId = Object.values(values?.reason ?? {})[0] || (model.reasons[0]?.id ?? "");
  const reasonDetailsRows = Array.from(selectedIds)
    .map((id) => {
      const li = result.order.lineItems.find((item) => item.id === id);
      const reasonId = values?.reason[id] || primaryReasonId;
      const reason = model.reasons.find((item) => item.id === reasonId);
      const label = selectedIds.size > 1 ? `${li?.title ?? t.reasonLabel}: ${t.reasonLabel}` : t.reasonLabel;
      return `
        <div class="glr-details-row">
          <div class="glr-details-label-col">
            <span class="glr-details-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                <line x1="7" y1="7" x2="7.01" y2="7"/>
              </svg>
            </span>
            <span>${esc(label)}</span>
          </div>
          <div class="glr-details-value-col">${esc(reason?.label || "—")}</div>
        </div>
      `;
    })
    .join("");

  const primaryComment = Object.values(values?.comment ?? {}).find((c) => Boolean(c)) || "";

  const allPhotos = Array.from(new Set(Object.values(values?.photos ?? {}).flat().map((p) => p.url)))
    .map((u) => Object.values(values?.photos ?? {}).flat().find((p) => p.url === u))
    .filter(Boolean);

  const photosHtml =
    allPhotos.length > 0
      ? `<div class="glr-summary-photos">${allPhotos
          .map((p) => `<img src="${esc(p!.url)}" alt="${esc(p!.fileName || "Uploaded photo")}" class="glr-summary-photo-thumb">`)
          .join("")}</div>`
      : "";

  // 5. Hidden fields for submission
  const selectedInputs = Array.from(selectedIds)
    .map((id) => `<input type="hidden" name="selected" value="${esc(id)}">`)
    .join("\n");

  const qtyInputs = Array.from(selectedIds)
    .map((id) => {
      const li = result.order.lineItems.find((x) => x.id === id);
      const qty = values?.qty[id] || (li ? String(li.quantity) : "1");
      return `<input type="hidden" name="qty_${esc(id)}" value="${esc(qty)}">`;
    })
    .join("\n");

  const reasonInputs = Array.from(selectedIds)
    .map((id) => {
      const rId = values?.reason[id] || primaryReasonId;
      return `<input type="hidden" name="reason_${esc(id)}" value="${esc(rId)}">`;
    })
    .join("\n");

  const commentInputs = Array.from(selectedIds)
    .map((id) => {
      const c = values?.comment[id] || primaryComment;
      return `<input type="hidden" name="comment_${esc(id)}" value="${esc(c)}">`;
    })
    .join("\n");

  const photoInputs = Array.from(selectedIds)
    .map((id) => {
      const p = values?.photos[id] || allPhotos;
      return `<input type="hidden" name="photo_${esc(id)}" value="${esc(JSON.stringify(p))}">`;
    })
    .join("\n");

  // 6. Resolution input (hidden if fixed or single option, interactive if multiple options)
  let resolutionHtml = "";
  if (model.choices.fixed) {
    resolutionHtml = `<input type="hidden" name="resolution" value="${esc(model.choices.fixed)}">`;
  } else if (model.choices.options.length > 1) {
    resolutionHtml = `
      <div class="glr-summary-card" style="margin-top:20px;">
        <h2 class="glr-summary-card-title">${esc(t.resolutionLegend)}</h2>
        <div style="margin-top:12px;">
          ${radioGroup({
            name: "resolution",
            legend: "",
            options: model.choices.options.map((r) => ({ value: r, label: resolutionLabel(ctx, r, model.choices) })),
            selected: values?.resolution ?? model.choices.options[0],
          })}
        </div>
        ${model.choices.refundDeflected ? `<p class="glr-muted" style="margin-top:8px;font-size:13px;">${esc(t.refundDeflected)}</p>` : ""}
      </div>
    `;
  } else if (model.choices.options.length === 1) {
    resolutionHtml = `<input type="hidden" name="resolution" value="${esc(values?.resolution || model.choices.options[0])}">`;
  }

  // 7. Navigation back form
  const changeFields = ctx.loggedInCustomerId
    ? `<input type="hidden" name="orderId" value="${esc(result.order.id)}">`
    : `<input type="hidden" name="orderNumber" value="${esc(back.orderNumber)}">
<input type="hidden" name="email" value="${esc(back.email)}">`;

  const backForm = `
    <form id="glr-back-form" method="post" action="?" style="display:none;">
      <input type="hidden" name="_stage" value="select_request_type">
      ${changeFields}
      <input type="hidden" name="requestType" value="${esc(result.requestType)}">
    </form>
  `;

  // 8. Submit form markup
  const shopDisplayName = formatShopDisplayName(ctx.shop);

  const submitFormInner = `
    <input type="hidden" name="orderToken" value="${esc(token)}">
    <input type="hidden" name="orderNumber" value="${esc(back.orderNumber)}">
    <input type="hidden" name="email" value="${esc(back.email)}">
    ${selectedInputs}
    ${qtyInputs}
    ${reasonInputs}
    ${commentInputs}
    ${photoInputs}
    ${resolutionHtml}

    <div class="glr-refund-banner">
      <div class="glr-refund-banner-left">
        <div class="glr-refund-banner-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#de4066" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="3"/>
            <line x1="2" y1="10" x2="22" y2="10"/>
          </svg>
        </div>
        <span>${esc(t.estimatedRefund)}</span>
      </div>
      <div class="glr-refund-banner-amount">${esc(displayTotal)}</div>
    </div>
    <div class="glr-refund-disclaimer">${esc(t.refundDisclaimer)}</div>

    <button type="submit" class="glr-confirm-btn">${esc(confirmBtnText)}</button>

    <div class="glr-summary-policy-footer">
      ${esc(t.agreePolicy(shopDisplayName))}<a href="?policy=return" class="glr-summary-policy-link">${esc(t.returnPolicy).toLowerCase()}.</a>
    </div>
  `;

  const submitForm = form(ctx, "submit", submitFormInner, { multipart: true });

  const body = `
    ${errorBox(opts.error)}
    ${backForm}

    <div>
      <button type="button" class="glr-back-btn" onclick="if (window.history.length > 1) { window.history.back(); } else { document.getElementById('glr-back-form').submit(); }">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        <span>${esc(t.backToDetails)}</span>
      </button>

      <h1 class="glr-summary-title">${esc(pageTitle)}</h1>
      <div class="glr-summary-order">
        <span>${esc(t.order)}</span>
        <span class="glr-order-pill">${esc(result.order.name)}</span>
      </div>
    </div>

    <div class="glr-summary-card">
      <div class="glr-summary-card-header">
        <div>
          <h2 class="glr-summary-card-title">${esc(itemsCardTitle)}</h2>
          <div class="glr-summary-card-count">${esc(t.itemsCount(selectedIds.size))}</div>
        </div>
        <button type="button" class="glr-summary-edit-btn" onclick="if (window.history.length > 1) { window.history.back(); } else { document.getElementById('glr-back-form').submit(); }">
          ${esc(t.edit)}
        </button>
      </div>
      <div class="glr-summary-items-list">
        ${itemsHtml}
      </div>
    </div>

    <div class="glr-summary-card">
      <h2 class="glr-summary-card-title" style="margin-bottom:16px;">${esc(t.requestDetailsHeading)}</h2>
      <div class="glr-details-list">
        <div class="glr-details-row">
          <div class="glr-details-label-col">
            <span class="glr-details-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 10h14l-4-4"/>
                <path d="M17 14H3l4 4"/>
              </svg>
            </span>
            <span>${esc(t.requestTypeLabel)}</span>
          </div>
          <div class="glr-details-value-col">${esc(t.types[result.requestType])}</div>
        </div>

        ${reasonDetailsRows}

        <div class="glr-details-row">
          <div class="glr-details-label-col">
            <span class="glr-details-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </span>
            <span>${esc(t.commentLabel)}</span>
          </div>
          <div class="glr-details-value-col">${esc(primaryComment || "—")}</div>
        </div>

        ${
          photosHtml
            ? `
          <div class="glr-details-row">
            <div class="glr-details-label-col">
              <span class="glr-details-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </span>
              <span>${esc(t.uploadedPhotosLabel)}</span>
            </div>
            <div class="glr-details-value-col">${photosHtml}</div>
          </div>
        `
            : ""
        }
      </div>
    </div>

    ${submitForm}
  `;

  return page({
    title: pageTitle,
    body,
    isSummaryPage: true,
    lang: ctx.lang,
    customization: getReturnFormCustomization(model.settings),
  });
}

async function verifiedScreen(
  ctx: ProxyContext,
  result: PortalOrderResult,
  token: string,
  back: LookupValues,
  formData?: FormData,
): Promise<string> {
  const model = await loadDetailsModel(ctx, result);
  const values = formData ? await readDetailsValues(formData) : undefined;
  if (values && formData) {
    const sharedComment = String(formData.get("comment") || "").trim();
    if (sharedComment) {
      for (const id of values.selected) values.comment[id] = sharedComment;
    }
  }
  return detailsScreen(ctx, result, model, token, back, { values });
}

function confirmationScreen(
  ctx: ProxyContext,
  requestNumber: string,
  requestType: ProxyRequestType,
  requireItemReturn: boolean,
  labelUrl?: string | null,
  settings?: { labelTimingPerMarket?: string | null },
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

  const cardHtml = `
    <div class="glr-conf-card">
      <div class="glr-conf-icon-wrap">
        <svg width="76" height="76" viewBox="0 0 76 76" fill="none">
          <circle cx="38" cy="42" r="28" fill="#FCE7F3" fill-opacity="0.7"/>
          <circle cx="38" cy="42" r="16" stroke="#DE4066" stroke-width="2.2" fill="#FFFFFF"/>
          <path d="M31 42L36 47L45 37" stroke="#DE4066" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="58" y1="18" x2="64" y2="12" stroke="#DE4066" stroke-width="2.2" stroke-linecap="round"/>
          <line x1="50" y1="17" x2="53" y2="10" stroke="#DE4066" stroke-width="2.2" stroke-linecap="round"/>
          <line x1="62" y1="26" x2="69" y2="26" stroke="#DE4066" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
      </div>

      <h2 class="glr-conf-title">${esc(t.confirmedHeading)}</h2>

      <div class="glr-conf-number-strip">
        <div class="glr-conf-number-left">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#de4066" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/>
          </svg>
          <span>${esc(t.requestNumber)}</span>
        </div>
        <div class="glr-conf-divider"></div>
        <strong class="glr-conf-number-value">${esc(requestNumber)}</strong>
      </div>

      <p class="glr-conf-next-text">${esc(next)}</p>

      ${labelUrl ? `<div style="margin: 0 auto 20px auto;"><a href="${esc(labelUrl)}" target="_blank" rel="noreferrer" class="button button--secondary">Download return label</a></div>` : ""}

      <div class="glr-conf-email-banner">
        <div class="glr-conf-email-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#de4066" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
        </div>
        <span>${esc(t.confirmedEmail)}</span>
      </div>

      <div style="text-align:center;">
        <a class="glr-conf-btn" href="?">
          <span>${esc(t.startAnother)}</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </a>
      </div>
    </div>
  `;

  return page({
    title: t.title,
    lead: t.lead,
    body: cardHtml,
    isTypeSelectPage: true,
    lang: ctx.lang,
    customization: getReturnFormCustomization(settings),
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGuestLookup(request: Request, ctx: ProxyContext, formData: FormData) {
  const orderNumber = String(formData.get("orderNumber") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const values: LookupValues = { orderNumber, email };

  if (!orderNumber || !email) {
    return await startScreen(ctx, { error: portalErrorCodeToMessage("INVALID_INPUT"), values });
  }

  // Two buckets: per client IP + shop, and per shop + order number so a single
  // order can't be brute-forced from many IPs.
  const normalizedOrder = orderNumber.replace(/^#/, "").toLowerCase();
  if (
    !checkRateLimit(`proxy:${clientIp(request)}:${ctx.shop}`) ||
    !checkRateLimit(`proxy-order:${ctx.shop}:${normalizedOrder}`)
  ) {
    return await startScreen(ctx, { error: portalErrorCodeToMessage("RATE_LIMITED"), values });
  }

  // Basic validation: check order exists, email matches, order is fulfilled
  // (exclusions and deadline will be checked after request type is selected)
  const basicResult = await lookupAndValidateOrderBasic(ctx.shop, orderNumber, email);
  if (!basicResult.ok) {
    return await startScreen(ctx, { error: lookupErrorMessage(ctx, basicResult.code), values });
  }

  const settings = await getOrCreateSettings(ctx.shop);
  return orderFoundScreen(ctx, basicResult, values, {}, settings);
}

function lookupErrorMessage(ctx: ProxyContext, code: string): string {
  return code === "ORDER_NOT_FOUND" || code === "EMAIL_MISMATCH" || code === "SHOP_REQUIRED"
    ? COPY[ctx.lang].notFound
    : portalErrorCodeToMessage(code as Parameters<typeof portalErrorCodeToMessage>[0]);
}

function orderFoundScreen(
  ctx: ProxyContext,
  result: PortalOrderResult,
  back: LookupValues,
  opts: { error?: string } = {},
  settings?: { labelTimingPerMarket?: string | null },
): string {
  const order = result.order;
  const t = COPY[ctx.lang];

  // 1. Order meta strip
  const deadlineDate = formatDate(result.deadline);
  const summary = `<div class="glr-order-meta-strip">
  <div class="glr-meta-item">
    <span class="glr-meta-label">${esc(t.order)}</span>
    <strong class="glr-meta-value">${esc(order.name)}</strong>
  </div>
  <div class="glr-meta-item">
    <span class="glr-meta-label">${esc(t.purchaseDate ?? "Purchase date")}</span>
    <strong class="glr-meta-value">${esc(formatDate(order.createdAt))}</strong>
  </div>
  <div class="glr-meta-item">
    <span class="glr-meta-label">${esc(t.deadline)}</span>
    <strong class="glr-meta-value">${esc(deadlineDate)}</strong>
  </div>
</div>`;

  // 2. Product item cards
  const eligibleItems = order.lineItems.filter((li) => !li.excluded);
  const productList = eligibleItems
    .map((li, index) => {
      const img = li.variantImage
        ? `<img src="${esc(li.variantImage.url)}" alt="${esc(li.variantImage.altText ?? li.title)}" class="glr-product-img">`
        : `<div class="glr-product-img glr-product-img--placeholder">📦</div>`;
      const price = li.variantPrice
        ? `<div class="glr-product-cost">${esc(li.variantPrice)}</div>`
        : "";
      return `
        <div class="glr-product-card">
          <input type="checkbox" name="selected" value="${esc(li.id)}" class="glr-product-select" aria-label="Select ${esc(li.title)}" ${eligibleItems.length === 1 ? "checked" : ""} ${index === 0 ? "required" : ""}>
          <div class="glr-product-thumb-wrap">${img}</div>
          <div class="glr-product-details">
            <strong class="glr-product-name">${esc(li.title)}</strong>
            <span class="glr-product-quantity">Qty: ${esc(String(li.quantity))}</span>
            ${price}
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#475569;">
              Return quantity
              <input type="number" name="qty_${esc(li.id)}" value="${esc(String(li.quantity))}" min="1" max="${esc(String(li.quantity))}" step="1" disabled style="width:72px;height:34px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;">
            </label>
          </div>
        </div>
      `;
    })
    .join("");
  const productsHtml = productList || `<p class="glr-muted">${esc(t.noEligibleItems ?? "No eligible items.")}</p>`;

  const deadlineTime = new Date(result.deadline).getTime();
  const deadlineFormatted = deadlineDate;
  const daysLeft = Math.max(0, Math.ceil((deadlineTime - Date.now()) / (24 * 60 * 60 * 1000)));
  const deadlineNoticeText = `You have until <strong>${esc(deadlineFormatted)}</strong> to request a return or exchange (${daysLeft} days).`;

  const deadlineBanner = `<div class="glr-deadline-banner">
  <svg class="glr-clock-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#de4066" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
  <span>${deadlineNoticeText}</span>
</div>`;

  // 4. Request type interactive cards
  const typeCards = `
<div class="glr-type-select-heading">${esc(t.requestType)}</div>
<div class="glr-type-cards">
  <label class="glr-type-card glr-type-card--selected" data-type="return">
    <input type="radio" name="requestType" value="return" checked required>
    <div class="glr-type-card-header">
      <div class="glr-radio-circle"></div>
      <div class="glr-type-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
      </div>
    </div>
    <div class="glr-type-content">
      <div class="glr-type-name">${esc(t.types.return)}</div>
      <div class="glr-type-desc">${esc(t.typeDescriptions.return)}</div>
    </div>
  </label>
  <label class="glr-type-card" data-type="exchange">
    <input type="radio" name="requestType" value="exchange" required>
    <div class="glr-type-card-header">
      <div class="glr-radio-circle"></div>
      <div class="glr-type-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>
        </svg>
      </div>
    </div>
    <div class="glr-type-content">
      <div class="glr-type-name">${esc(t.types.exchange)}</div>
      <div class="glr-type-desc">${esc(t.typeDescriptions.exchange)}</div>
    </div>
  </label>
  <label class="glr-type-card" data-type="complaint">
    <input type="radio" name="requestType" value="complaint" required>
    <div class="glr-type-card-header">
      <div class="glr-radio-circle"></div>
      <div class="glr-type-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
    </div>
    <div class="glr-type-content">
      <div class="glr-type-name">${esc(t.types.complaint)}</div>
      <div class="glr-type-desc">${esc(t.typeDescriptions.complaint)}</div>
    </div>
  </label>
</div>`;

  // 5. Reasons for each request type
  const requestTypes: ProxyRequestType[] = ["return", "exchange", "complaint"];
  const reasonSections = requestTypes.map((rt) => {
    const reasons = (result.reasons || []).filter((r) => {
      const applies = r.appliesTo.split(",").map((x) => x.trim().toLowerCase());
      return applies.includes(rt) || applies.includes("any");
    });
    if (reasons.length === 0) return "";
    const reasonOptions = reasons
      .map((r) => `<option value="${esc(r.id)}">${esc(r.parentLabel ? `${r.parentLabel} / ${r.labelEn}` : r.labelEn)}</option>`)
      .join("");
    const reasonItems = order.lineItems
      .filter((li) => !li.excluded)
      .map((li) => `
        <div class="glr-field-block glr-reason-item" data-item-id="${esc(li.id)}" style="display: none;">
          <label class="glr-form-label">${esc(t.reason)} <span class="glr-required">*</span></label>
          <div class="glr-select-wrap">
            <select name="reason_${esc(li.id)}" class="glr-custom-select" required>
              <option value="">${esc(t.chooseReason)}</option>
              ${reasonOptions}
            </select>
            <svg class="glr-select-chevron" width="12" height="7" viewBox="0 0 12 7" fill="none">
              <path d="M1 1L6 6L11 1" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
      `)
      .join("");
    return `
      <div class="glr-reason-section glr-reason-section--${rt}" data-request-type="${rt}" style="${rt === "return" ? "display: block;" : "display: none;"}">
        ${reasonItems}
      </div>
    `;
  }).join("");

  // 7. Hidden fields
  const hiddenFields = ctx.loggedInCustomerId
    ? `<input type="hidden" name="orderId" value="${esc(order.id)}">`
    : `<input type="hidden" name="orderNumber" value="${esc(back.orderNumber)}">
<input type="hidden" name="email" value="${esc(back.email)}">`;

  // 8. Comment & photo blocks
  const returnAttachConfig = getReturnImageCommentConfig(settings);
  const photoInstructionsText = returnAttachConfig.includeInstructions && returnAttachConfig.instructions
    ? `<div style="font-size:12px;color:#6b7280;margin-bottom:8px;">${esc(returnAttachConfig.instructions)}</div>`
    : "";

  const commentSection = `
    <div class="glr-field-block return-comment-row">
      <label class="glr-form-label">${esc(COPY[ctx.lang].comment)}</label>
      <div class="glr-textarea-wrap">
        <textarea
          id="glr-comment-field"
          name="comment"
          rows="3"
          maxlength="500"
          class="glr-custom-textarea"
          placeholder="${esc(COPY[ctx.lang].commentMin(3))}"
        ></textarea>
      </div>
      <div class="glr-char-counter" id="glr-char-count">0 / 500</div>
    </div>
  `;

  const photoSection = `
    <div class="glr-field-block return-photo-row">
      <label class="glr-form-label">${esc(COPY[ctx.lang].photos)}</label>
      ${photoInstructionsText}
      <div class="glr-dropzone" id="glr-dropzone">
        <div class="glr-dropzone-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </div>
        <div class="glr-dropzone-text">
          <strong class="glr-dropzone-title">${esc(t.dragAndDrop)}</strong>
          <span class="glr-dropzone-subtitle">${esc(COPY[ctx.lang].photosHint)} ${esc(COPY[ctx.lang].photosMin(1))}</span>
        </div>
        <button type="button" class="glr-dropzone-btn">${esc(t.chooseFilesBtn)}</button>
        <input type="file" id="glr-photo-input" name="photo" accept="image/*" multiple style="display:none;">
      </div>
      <div id="glr-files-selected-text" style="display:none; margin-top:6px; font-size:12px; color:#111827; font-weight:500;"></div>
    </div>
  `;

  // 9. Submit button
  const submitButton = `
    <div class="glr-submit-row">
      <button type="submit" class="glr-submit-request-btn">
        <span>${esc(t.submitRequest ?? "Submit request")}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="12 5 19 12 12 19"/>
        </svg>
      </button>
    </div>
  `;

  // 10. Client script
  const clientScript = `
<script>
  (function() {
    function initTypeSelect() {
      var returnAttachConfig = ${JSON.stringify(returnAttachConfig)};
      var cards = document.querySelectorAll('.glr-type-card');
      var sections = document.querySelectorAll('.glr-reason-section');
      var commentRows = document.querySelectorAll('.return-comment-row');
      var photoRows = document.querySelectorAll('.return-photo-row');
      var commentField = document.getElementById('glr-comment-field');
      var charCount = document.getElementById('glr-char-count');
      var fileInput = document.getElementById('glr-photo-input');
      var fileInfo = document.getElementById('glr-files-selected-text');
      var dropzone = document.getElementById('glr-dropzone');
      var itemCheckboxes = document.querySelectorAll('input[name="selected"]');
      var reasonFields = document.querySelectorAll('.glr-reason-item');

      function updateItemSelection() {
        var hasSelection = Array.from(itemCheckboxes).some(function(input) { return input.checked; });
        var checkedType = document.querySelector('input[name="requestType"]:checked');
        var selectedType = checkedType ? checkedType.value : 'return';
        if (itemCheckboxes.length) itemCheckboxes[0].required = !hasSelection;
        itemCheckboxes.forEach(function(checkbox) {
          var quantityInput = document.querySelector('input[name="qty_' + checkbox.value + '"]');
          if (quantityInput) {
            quantityInput.disabled = !checkbox.checked;
            quantityInput.required = checkbox.checked;
          }
        });
        reasonFields.forEach(function(field) {
          var checkbox = Array.from(itemCheckboxes).find(function(input) {
            return input.value === field.dataset.itemId;
          });
          var selected = checkbox && checkbox.checked;
          var typeMatches = field.parentElement && field.parentElement.dataset.requestType === selectedType;
          var visible = Boolean(selected && typeMatches);
          field.style.display = visible ? 'block' : 'none';
          var reasonSelect = field.querySelector('select');
          if (reasonSelect) reasonSelect.required = visible;
        });
      }

      itemCheckboxes.forEach(function(input) {
        input.addEventListener('change', updateItemSelection);
      });
      updateItemSelection();

      function updateType() {
        var checkedRadio = document.querySelector('input[name="requestType"]:checked');
        var selectedVal = checkedRadio ? checkedRadio.value : 'return';
        cards.forEach(function(card) {
          if (card.dataset.type === selectedVal) {
            card.classList.add('glr-type-card--selected');
          } else {
            card.classList.remove('glr-type-card--selected');
          }
        });
        sections.forEach(function(sec) {
          sec.style.display = sec.dataset.requestType === selectedVal ? 'block' : 'none';
        });
        var showCommentForReturn = Boolean(returnAttachConfig.enabled && returnAttachConfig.commentMode !== 'disabled');
        var showPhotoForReturn = Boolean(returnAttachConfig.enabled && returnAttachConfig.imageUploadMode !== 'disabled');

        commentRows.forEach(function(row) {
          if (selectedVal === 'complaint') {
            row.style.display = 'block';
          } else if (selectedVal === 'return') {
            row.style.display = showCommentForReturn ? 'block' : 'none';
          } else {
            row.style.display = 'none';
          }
        });

        photoRows.forEach(function(row) {
          if (selectedVal === 'complaint') {
            row.style.display = 'block';
          } else if (selectedVal === 'return') {
            row.style.display = showPhotoForReturn ? 'block' : 'none';
          } else {
            row.style.display = 'none';
          }
        });

        updateItemSelection();
      }

      cards.forEach(function(card) {
        card.addEventListener('click', function(e) {
          var radio = card.querySelector('input[type="radio"]');
          if (radio) {
            radio.checked = true;
            updateType();
          }
        });
      });

      if (commentField && charCount) {
        commentField.addEventListener('input', function() {
          charCount.textContent = commentField.value.length + ' / 500';
        });
      }

      if (fileInput && fileInfo) {
        fileInput.addEventListener('change', function() {
          if (fileInput.files && fileInput.files.length > 0) {
            fileInfo.style.display = 'block';
            fileInfo.textContent = fileInput.files.length + ' file(s) selected: ' + Array.from(fileInput.files).map(function(f) { return f.name; }).join(', ');
          } else {
            fileInfo.style.display = 'none';
          }
        });
      }

      if (dropzone && fileInput) {
        dropzone.addEventListener('click', function(e) {
          fileInput.click();
        });
        ['dragenter', 'dragover'].forEach(function(eventName) {
          dropzone.addEventListener(eventName, function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('glr-dropzone--dragover');
          });
        });
        ['dragleave', 'drop'].forEach(function(eventName) {
          dropzone.addEventListener(eventName, function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('glr-dropzone--dragover');
          });
        });
        dropzone.addEventListener('drop', function(e) {
          if (e.dataTransfer && e.dataTransfer.files) {
            fileInput.files = e.dataTransfer.files;
            fileInput.dispatchEvent(new Event('change'));
          }
        });
      }

      updateType();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTypeSelect);
    } else {
      initTypeSelect();
    }
  })();
</script>`;

  const inner = form(
    ctx,
    "select_request_type",
    `${hiddenFields}
${summary}
${productsHtml}
${deadlineBanner}
${typeCards}
${reasonSections}
${commentSection}
${photoSection}
${submitButton}
${clientScript}`,
    { multipart: true },
  );

  return page({
    title: t.title,
    lead: t.lead,
    body: errorBox(opts.error) + `<section class="glr-order-found-card"><h2 class="glr-card-heading">${esc(t.verifiedHeading ?? "Order found")}</h2>${inner}</section>`,
    isTypeSelectPage: true,
    lang: ctx.lang,
    customization: getReturnFormCustomization(settings),
  });
}

async function handleSelectOrder(request: Request, ctx: ProxyContext, formData: FormData) {
  const customerId = ctx.loggedInCustomerId;
  const values: LookupValues = {};
  if (!customerId) {
    // Session ended between page load and submit.
    return await startScreen(ctx, { error: COPY[ctx.lang].unknownStage });
  }
  // Untrusted: only used as a lookup key. Ownership is checked against the signed customer id.
  const orderId = String(formData.get("orderId") || "").trim();
  if (!orderId) {
    return await startScreen(ctx, { error: portalErrorCodeToMessage("INVALID_INPUT"), values });
  }

  if (!checkRateLimit(`proxy-customer:${ctx.shop}:${customerId}`)) {
    return await startScreen(ctx, { error: portalErrorCodeToMessage("RATE_LIMITED"), values });
  }

  // Basic validation for logged-in customer (checks ownership, fulfillment)
  const basicResult = await lookupOrderForCustomerBasic(ctx.shop, orderId, customerId);
  if (!basicResult.ok) {
    return await startScreen(ctx, { error: lookupErrorMessage(ctx, basicResult.code), values });
  }

  // For logged-in, we don't have orderNumber/email in the same way, but we need them for the form
  const back: LookupValues = {
    orderNumber: basicResult.order.name,
    email: basicResult.order.email || "",
  };
  const settings = await getOrCreateSettings(ctx.shop);
  return orderFoundScreen(ctx, basicResult, back, {}, settings);
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
  const values = await readDetailsValues(formData);
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

    const photos: { url: string; fileName?: string; mimeType?: string; size?: number }[] = values.photos[id] ?? [];

    if (isComplaint && settings.claimRequiresPhoto && photos.length < settings.claimMinPhotos) {
      return fail(t.needPhotos(settings.claimMinPhotos, li.title));
    }
    if (isComplaint && (comment?.length ?? 0) < settings.claimMinCommentLength) {
      return fail(t.needComment(settings.claimMinCommentLength, li.title));
    }

    const returnAttachConfig = getReturnImageCommentConfig(settings);
    if (!isComplaint && returnAttachConfig.enabled) {
      if (returnAttachConfig.imageUploadMode === "mandatory" && photos.length === 0) {
        return fail(t.needPhotos(1, li.title));
      }
      if (returnAttachConfig.commentMode === "mandatory" && !comment) {
        return fail(t.needComment(3, li.title));
      }
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
      market: result.order.market ?? null,
      customerEmail: result.order.email,
      customerName: result.order.customerName,
      type: token.requestType,
      autoApprove: settings.autoApproveRequests,
      items,
      fulfillmentLocationId: result.order.fulfillmentLocationId ?? null,
    });
    await prisma.returnRequest.update({
      where: { id: created.id },
      data: { requestedResolution: resolution },
    });
  } catch (e) {
    console.error("[proxy returns] submit failed", e);
    return fail(t.submitFailed);
  }

  let labelUrl: string | null = null;
  let trackingUrl: string | null = null;
  if (settings.autoApproveRequests || getLabelTimingForMarket(settings.labelTimingPerMarket, result.order.market) === "immediate") {
    const generated = await createReturnLabel(created.id);
    if (generated.ok) {
      const label = await prisma.returnLabel.findUnique({ where: { returnRequestId: created.id } });
      labelUrl = label?.labelUrl ?? null;
      trackingUrl = label?.trackingUrl ?? null;
    }
  }

  const customerEmail = result.order.email || "";
  if (!customerEmail) {
    console.warn("[Return Portal] No customer email found on order, skipping confirmation email");
  } else {
    const approvedEvent = token.requestType === "exchange" ? "exchange_approved" : "approved";
    const sent = await sendEventEmail(ctx.shop, settings.autoApproveRequests ? approvedEvent : "received", ctx.lang, customerEmail, {
      customerName: result.order.customerName || customerEmail || "customer",
      orderNumber: result.order.name,
      requestNumber: created.requestNumber,
      items: items.map((it) => it.title).join(", "),
      labelLink: labelUrl || "",
      trackingLink: trackingUrl || "",
    }).catch((e) => {
      console.error("[Return Portal] Failed to send confirmation email:", e);
      return { ok: false };
    });
    // Auto-approved with its label delivered: same state as an admin approval email.
    if (settings.autoApproveRequests && labelUrl && sent.ok) {
      await prisma.returnRequest.update({ where: { id: created.id }, data: { approvalEmailSentAt: new Date() } }).catch(() => null);
    }
  }

  return confirmationScreen(ctx, created.requestNumber ?? "", token.requestType, settings.complaintRequireItemReturn, labelUrl, settings);
}

export async function handleProxyLoader({ request }: LoaderFunctionArgs) {
  // Throws 400 if the proxy signature is missing or invalid.
  const { liquid } = await authenticate.public.appProxy(request);
  const ctx = readProxyContext(request);
  return liquid(await startScreen(ctx), NO_STORE);
};

async function handleSelectRequestType(request: Request, ctx: ProxyContext, formData: FormData) {
  const requestType = parseRequestType(formData.get("requestType"));

  if (ctx.loggedInCustomerId) {
    // Logged-in customer: use orderId from form
    const orderId = String(formData.get("orderId") || "").trim();
    const back: LookupValues = {};
    if (!orderId || !requestType) {
      return await startScreen(ctx, { error: portalErrorCodeToMessage("INVALID_INPUT"), values: back });
    }

    if (!checkRateLimit(`proxy-customer:${ctx.shop}:${ctx.loggedInCustomerId}`)) {
      return await startScreen(ctx, { error: portalErrorCodeToMessage("RATE_LIMITED"), values: back });
    }

    const result = await lookupOrderForCustomer(ctx.shop, orderId, ctx.loggedInCustomerId, requestType);
    if (!result.ok) {
      return await startScreen(ctx, { error: lookupErrorMessage(ctx, result.code), values: back });
    }

    const token = issueOrderToken({
      shop: ctx.shop,
      orderId: result.order.id,
      orderName: result.order.name,
      requestType,
      customerId: ctx.loggedInCustomerId,
    });
    return await verifiedScreen(ctx, result, token, back, formData);
  } else {
    // Guest: use orderNumber and email
    const orderNumber = String(formData.get("orderNumber") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const back: LookupValues = { orderNumber, email };

    if (!orderNumber || !email || !requestType) {
      return await startScreen(ctx, { error: portalErrorCodeToMessage("INVALID_INPUT"), values: back });
    }

    // Rate limiting
    const normalizedOrder = orderNumber.replace(/^#/, "").toLowerCase();
    if (
      !checkRateLimit(`proxy:${clientIp(request)}:${ctx.shop}`) ||
      !checkRateLimit(`proxy-order:${ctx.shop}:${normalizedOrder}`)
    ) {
      return await startScreen(ctx, { error: portalErrorCodeToMessage("RATE_LIMITED"), values: back });
    }

    // Full validation with the selected requestType
    const result = await lookupAndValidateOrder(ctx.shop, orderNumber, email, requestType);
    if (!result.ok) {
      return await startScreen(ctx, { error: lookupErrorMessage(ctx, result.code), values: back });
    }

    const payload: Omit<ProxyOrderTokenPayload, "v" | "exp"> = {
      shop: ctx.shop,
      orderId: result.order.id,
      orderName: result.order.name,
      requestType,
      customerId: null,
    };
    return await verifiedScreen(ctx, result, issueOrderToken(payload), back, formData);
  }
}

export async function handleProxyAction({ request }: ActionFunctionArgs) {
  const { liquid } = await authenticate.public.appProxy(request);
  const signed = readProxyContext(request);
  const formData = await request.formData();
  // Posted `shop` is a display hint only and is deliberately ignored.
  const lang: ProxyLang = "en";
  const ctx: ProxyContext = { ...signed, lang };
  const stage = String(formData.get("_stage") || "");

  // Error screens return 200 on purpose so they still render inside the theme.
  switch (stage) {
    case "lookup":
      // Guest form; also the fallback for logged-in customers (order not on their account).
      return liquid(await handleGuestLookup(request, ctx, formData), NO_STORE);

    case "select_order":
      return liquid(await handleSelectOrder(request, ctx, formData), NO_STORE);

    case "select_request_type":
      return liquid(await handleSelectRequestType(request, ctx, formData), NO_STORE);

    case "restart":
      return liquid(
        await startScreen(ctx, {
          values: {
            orderNumber: String(formData.get("orderNumber") || ""),
            email: String(formData.get("email") || ""),
          },
        }),
        NO_STORE,
      );

    case "submit":
      return liquid(await handleSubmit(ctx, formData), NO_STORE);
  }

  return liquid(await startScreen(ctx, { error: COPY[lang].unknownStage }), NO_STORE);
};
