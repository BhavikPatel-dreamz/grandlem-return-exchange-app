// HTML helpers for the storefront return page served through the app proxy.
// See docs/storefront-return-proxy.md.
//
// The response is Liquid, so Shopify renders it inside the shop's theme.
// Every dynamic value MUST go through `esc` — it escapes HTML and also the
// Liquid delimiters `{` / `}`, so customer input can never be evaluated as
// Liquid by Shopify.

import type { ReturnFormCustomization } from "./settings.server";

export type ProxyLang = "en";

export type ProxyContext = {
  /** Shop domain from the signed proxy query string. The only trusted shop value. */
  shop: string;
  /** Shopify customer id when a customer is logged in, otherwise null. */
  loggedInCustomerId: string | null;
  lang: ProxyLang;
};

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

/** Read the signed proxy context. Call only after `authenticate.public.appProxy` succeeded. */
export function readProxyContext(request: Request): ProxyContext {
  const params = new URL(request.url).searchParams;
  return {
    shop: params.get("shop") ?? "",
    loggedInCustomerId: params.get("logged_in_customer_id") || null,
    lang: "en",
  };
}

/**
 * A POST form back to the current proxy URL (no `action` attribute, so it keeps
 * the shop's own prefix/subpath). `shop` is included only as a display hint;
 * the server always uses the signed shop from the query string.
 */
export function form(
  ctx: ProxyContext,
  stage: string,
  inner: string,
  opts: { multipart?: boolean; className?: string } = {},
): string {
  const enctype = opts.multipart ? ` enctype="multipart/form-data"` : "";
  const cls = opts.className ? ` class="${esc(opts.className)}"` : "";
  return `<form method="post"${enctype}${cls}>
  <input type="hidden" name="shop" value="${esc(ctx.shop)}">
  <input type="hidden" name="lang" value="${esc(ctx.lang)}">
  <input type="hidden" name="_stage" value="${esc(stage)}">
  ${inner}
</form>`;
}

export function field(opts: {
  name: string;
  label: string;
  type?: string;
  value?: string;
  required?: boolean;
  autocomplete?: string;
}): string {
  const id = `glr-${opts.name}`;
  return `<div class="field glr-field">
  <input class="field__input" id="${esc(id)}" name="${esc(opts.name)}" type="${esc(opts.type ?? "text")}"
    value="${esc(opts.value ?? "")}" placeholder="${esc(opts.label)}"${opts.required ? " required" : ""}${
      opts.autocomplete ? ` autocomplete="${esc(opts.autocomplete)}"` : ""
    }>
  <label class="field__label" for="${esc(id)}">${esc(opts.label)}</label>
</div>`;
}

export function radioGroup(opts: {
  name: string;
  legend: string;
  options: { value: string; label: string }[];
  selected?: string;
}): string {
  const items = opts.options
    .map((o, i) => {
      const checked = opts.selected ? o.value === opts.selected : i === 0;
      return `<label class="glr-choice"><input type="radio" name="${esc(opts.name)}" value="${esc(o.value)}"${
        checked ? " checked" : ""
      } required> <span>${esc(o.label)}</span></label>`;
    })
    .join("");
  return `<fieldset class="glr-choices"><legend>${esc(opts.legend)}</legend>${items}</fieldset>`;
}

export function errorBox(message: string | null | undefined): string {
  if (!message) return "";
  return `<div class="glr-error" role="alert"><span class="glr-error-icon" aria-hidden="true">!</span><span>${esc(message)}</span></div>`;
}

export function card(inner: string, heading?: string): string {
  return `<section class="glr-card">${heading ? `<h2 class="h4">${esc(heading)}</h2>` : ""}${inner}</section>`;
}

export function topBar(): string {
  const flagSvg = `<svg class="glr-flag-svg" width="24" height="16" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="24" height="16" rx="2" fill="#B22234"/>
        <path d="M0 2.46H24M0 4.92H24M0 7.38H24M0 9.85H24M0 12.31H24M0 14.77H24" stroke="white" stroke-width="1.23"/>
        <rect width="9.6" height="8.62" rx="1" fill="#3C3B6E"/>
        <circle cx="2" cy="1.8" r="0.6" fill="white"/>
        <circle cx="4.8" cy="1.8" r="0.6" fill="white"/>
        <circle cx="7.6" cy="1.8" r="0.6" fill="white"/>
        <circle cx="3.4" cy="4.3" r="0.6" fill="white"/>
        <circle cx="6.2" cy="4.3" r="0.6" fill="white"/>
        <circle cx="2" cy="6.8" r="0.6" fill="white"/>
        <circle cx="4.8" cy="6.8" r="0.6" fill="white"/>
        <circle cx="7.6" cy="6.8" r="0.6" fill="white"/>
      </svg>`;

  return `<div class="glr-topbar">
  <div class="glr-locale-static">
    ${flagSvg}
    <span>English</span>
  </div>
</div>`;
}

export function orderFooter(): string {
  return `<div class="glr-footer">
  <a href="#" class="glr-footer-link" onclick="return false;">Return policy</a>
  <span class="glr-dot">•</span>
  <a href="#" class="glr-footer-link" onclick="return false;">Help?</a>
</div>`;
}

const STYLES = `<style>
.glr { max-width: 680px; width: 100%; margin: 0 auto; padding: 3rem 1.5rem 4rem; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; box-sizing: border-box; }
.glr-order-page { max-width: 680px; width: 100%; padding: 2rem 1rem 4rem; margin: 0 auto; box-sizing: border-box; }
.glr-order-page .glr-stack { width: 100%; max-width: 100%; display: flex; flex-direction: column; gap: 1.25rem; align-items: stretch; }
.glr h1 { margin: 0 0 .5rem; }
.glr-lead { margin: 0 0 2rem; opacity: .75; }
.glr-stack { display: flex; flex-direction: column; gap: 1.25rem; }
.glr-card { border: 1px solid rgba(var(--color-foreground, 0,0,0), .15); border-radius: var(--inputs-radius, 12px); padding: 1.5rem; }
.glr-card > h2 { margin: 0 0 1rem; }
.glr-field { margin: 0 0 1rem; }
.glr-error { display: flex; align-items: flex-start; gap: .6rem; border: 1px solid #fca5a5; background: #fef2f2; color: #b91c1c; border-radius: 12px; padding: .75rem 1rem; font-size: 14px; text-align: left; margin-bottom: 1.25rem; line-height: 1.4; }
.glr-error-icon { flex: 0 0 auto; font-weight: 700; }
.glr-notice { border: 1px solid rgba(var(--color-foreground, 0,0,0), .2); border-radius: 8px; padding: .75rem 1rem; }
.glr-actions { display: flex; gap: .75rem; flex-wrap: wrap; margin-top: 1rem; }
.glr-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .75rem; }
.glr-muted { opacity: .7; font-size: .9em; }
.glr button[disabled] { opacity: .5; cursor: not-allowed; }
.glr-choices { border: 0; padding: 0; margin: 0 0 1.25rem; }
.glr-choices legend { padding: 0; margin-bottom: .5rem; font-weight: 600; }
.glr-choice { display: flex; align-items: center; gap: .5rem; padding: .35rem 0; cursor: pointer; }
.glr-choice input { margin: 0; width: 1.1rem; height: 1.1rem; }
.glr-meta { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; margin: 0 0 1rem; }
.glr-meta dt { opacity: .7; }
.glr-meta dd { margin: 0; }
.glr-order { width: 100%; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: .25rem 1rem; text-align: left; }
.glr-order__name { font-weight: 600; }
details.glr-card > summary { cursor: pointer; font-weight: 600; }
details.glr-card[open] > summary { margin-bottom: 1rem; }
details.glr-card > .glr-card { border: 0; padding: 0; }
.glr-section { margin: 1.5rem 0; }
.glr-item { border: 1px solid rgba(var(--color-foreground, 0,0,0), .12); border-radius: 8px; padding: .75rem 1rem; }
.glr-item--disabled { opacity: .6; }
.glr-item__fields { display: flex; flex-direction: column; gap: .75rem; margin: .75rem 0 0 1.6rem; }
.glr-item:has(input[name="selected"]):not(:has(input[name="selected"]:checked)) .glr-item__fields { display: none; }
.glr-row { display: flex; flex-direction: column; gap: .3rem; }
.glr-row label { font-weight: 600; font-size: .95em; }
.glr-row select, .glr-row textarea { width: 100%; max-width: 100%; box-sizing: border-box; padding: .5rem .75rem; }
.glr-row .glr-muted { margin: 0; }
.glr-textarea { min-height: 5rem; resize: vertical; }
.glr-link { background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer; font: inherit; color: inherit; }

/* Topbar & Language switcher */
.glr-topbar { display: flex; justify-content: flex-end; width: 100%; margin-bottom: 1.75rem; }
.glr-locale-dropdown { position: relative; display: inline-block; }
.glr-locale-btn { display: inline-flex; align-items: center; gap: 7px; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px 6px; cursor: pointer; transition: background-color 0.15s ease; -webkit-appearance: none; appearance: none; }
.glr-locale-btn:hover { background-color: rgba(0, 0, 0, 0.04); }
.glr-locale-menu { display: none; position: absolute; right: 0; top: 100%; margin-top: 4px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); min-width: 130px; z-index: 100; padding: 4px 0; }
.glr-locale-dropdown:hover .glr-locale-menu, .glr-locale-dropdown:focus-within .glr-locale-menu, .glr-locale-menu.glr-show { display: block; }
.glr-locale-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 13px; color: #374151; text-decoration: none; transition: background-color 0.1s ease; }
.glr-locale-item:hover { background-color: #f3f4f6; color: #111827; }
.glr-locale-item.glr-active { font-weight: 600; background-color: #f9fafb; }
.glr-flag-svg { display: block; border-radius: 2px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); flex-shrink: 0; }
.glr-caret-svg { display: block; flex-shrink: 0; }

/* Header & Typography */
.glr-header-center { text-align: center; margin-bottom: 2rem; }
.glr-eyebrow { color: #e24d5b; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 12px 0; text-align: center; display: block; }
.glr-title { color: #0f172a; font-size: 34px; font-weight: 700; line-height: 1.2; letter-spacing: -0.025em; margin: 0 0 12px 0; text-align: center; }
@media (max-width: 480px) { .glr-title { font-size: 26px; } }
.glr-subtitle { color: #64748b; font-size: 15px; line-height: 1.5; max-width: 560px; margin: 0 auto; text-align: center; opacity: 1; }

/* Order card */
.glr-order-card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 24px; padding: 32px 32px 28px 32px; max-width: 450px; width: 100%; margin: 0 auto; box-sizing: border-box; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02); }
@media (max-width: 480px) { .glr-order-card { padding: 24px 20px; border-radius: 20px; } }

/* Form fields */
.glr-field-wrap { margin-bottom: 20px; text-align: left; display: block; }
.glr-field-label { display: block; font-size: 14px; font-weight: 600; color: #111827; margin-bottom: 8px; text-align: left; line-height: 1.3; }
.glr-field-input { width: 100%; height: 48px; padding: 0 16px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; font-size: 15px; color: #111827; box-sizing: border-box; outline: none; transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease; font-family: inherit; -webkit-appearance: none; appearance: none; box-shadow: none; }
.glr-field-input::placeholder { color: #9ca3af; opacity: 1; }
.glr-field-input:not(:placeholder-shown), .glr-field-input:-webkit-autofill { background-color: #eef4fc; }
.glr-field-input:focus { border-color: var(--glr-primary, #de4066); box-shadow: 0 0 0 1px var(--glr-primary, #de4066); background-color: #eef4fc; }

/* Submit button */
.glr-button-wrap { margin-top: 24px; }
.glr-submit-button { width: 100%; height: 48px; background: #f3f4f6; color: #6b7280; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.1s ease; display: flex; align-items: center; justify-content: center; font-family: inherit; -webkit-appearance: none; appearance: none; box-shadow: none; }
.glr-submit-button:hover { background: #e5e7eb; color: #374151; }
.glr-submit-button:active { background: #d1d5db; }

/* Active state when all fields are filled */
.glr-submit-button.glr-btn-active,
.glr-order-card form:has(#glr-orderNumber:not(:placeholder-shown)):has(#glr-email:not(:placeholder-shown)) .glr-submit-button {
  background: var(--glr-primary, #de4066);
  color: var(--glr-btn-text, #ffffff);
  box-shadow: 0 4px 14px 0 rgba(0, 0, 0, 0.15);
}
.glr-submit-button.glr-btn-active:hover,
.glr-order-card form:has(#glr-orderNumber:not(:placeholder-shown)):has(#glr-email:not(:placeholder-shown)) .glr-submit-button:hover {
  filter: brightness(0.92);
  color: var(--glr-btn-text, #ffffff);
}
.glr-submit-button.glr-btn-active:active,
.glr-order-card form:has(#glr-orderNumber:not(:placeholder-shown)):has(#glr-email:not(:placeholder-shown)) .glr-submit-button:active {
  filter: brightness(0.85);
  transform: scale(0.99);
}

/* Footer links */
.glr-footer { margin-top: 28px; text-align: center; font-size: 13px; color: #9ca3af; display: flex; align-items: center; justify-content: center; gap: 8px; }
.glr-footer-link { color: #9ca3af; text-decoration: none; cursor: pointer; transition: color 0.15s ease; }
.glr-footer-link:hover { color: #4b5563; text-decoration: underline; }
.glr-dot { color: #9ca3af; user-select: none; }

/* Product list on order found screen */
.glr-product-list { list-style: none; margin: 1rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .75rem; }
.glr-product-item { display: flex; gap: 1rem; align-items: center; padding: .75rem; border: 1px solid rgba(var(--color-foreground, 0,0,0), .12); border-radius: 8px; }
.glr-product-img-wrap { flex-shrink: 0; width: 60px; height: 60px; border-radius: 6px; overflow: hidden; background: rgba(var(--color-foreground, 0,0,0), .05); }
.glr-product-img { width: 100%; height: 100%; object-fit: cover; }
.glr-product-img--placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: rgba(var(--color-foreground, 0,0,0), .4); font-size: 1.5rem; }
.glr-product-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .25rem; }
.glr-product-title { font-size: .95rem; word-break: break-word; }
.glr-product-qty { font-size: .85rem; opacity: .7; }
.glr-product-price { font-size: .95rem; font-weight: 600; color: inherit; }

/* Reason selection screen */
.glr-reason-list { display: flex; flex-direction: column; gap: 1rem; }
.glr-reason-item { display: flex; flex-direction: column; gap: .5rem; }
.glr-reason-item strong { font-size: .95rem; }
.glr-reason-item select { width: 100%; max-width: 100%; box-sizing: border-box; padding: .5rem .75rem; }

/* Type Select Screen (Order Found) */
.glr-type-select-page { max-width: 580px; margin: 0 auto; padding: 2rem 1rem 4rem; }
.glr-brand-header { display: flex; align-items: center; gap: 12px; margin-bottom: 1.25rem; }
.glr-brand-logo { max-height: 48px; max-width: 160px; object-fit: contain; }
.glr-brand-name { font-size: 18px; font-weight: 700; color: var(--glr-primary-text, #0f172a); }
.glr-header-left { margin-bottom: 1.25rem; text-align: left; }
.glr-title-left { font-size: 28px; font-weight: 800; color: var(--glr-primary-text, #0f172a); margin: 0 0 6px 0; letter-spacing: -0.02em; text-align: left; font-family: inherit; }
.glr-lead-left { font-size: 14px; color: #64748b; margin: 0; line-height: 1.4; text-align: left; opacity: 1; }
.glr-order-found-card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px 22px 24px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
.glr-card-heading { font-size: 16px; font-weight: 600; color: var(--glr-primary-text, #0f172a); margin: 0 0 14px 0; font-family: inherit; }
.glr-order-meta-strip { display: flex; align-items: center; flex-wrap: wrap; gap: 24px; margin-bottom: 16px; font-size: 13px; line-height: 1.4; }
.glr-meta-item { display: flex; align-items: center; gap: 8px; }
.glr-meta-label { color: #64748b; font-weight: 500; }
.glr-meta-value { color: var(--glr-primary-text, #0f172a); font-weight: 700; }
.glr-product-card { display: flex; align-items: center; gap: 14px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; background: #ffffff; }
.glr-product-select { width: 18px; height: 18px; margin: 0; accent-color: var(--glr-primary, #de4066); flex-shrink: 0; cursor: pointer; }
.glr-product-thumb-wrap { width: 52px; height: 52px; border-radius: 6px; overflow: hidden; background: #f1f5f9; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.glr-product-details { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.glr-product-name { font-size: 13px; font-weight: 600; color: var(--glr-primary-text, #0f172a); }
.glr-product-quantity { font-size: 12px; color: #64748b; }
.glr-product-cost { font-size: 13px; font-weight: 700; color: var(--glr-primary-text, #0f172a); }
.glr-deadline-banner { background: var(--glr-secondary-bg, #fff1f2); border: 1px solid #fecdd3; border-radius: 8px; padding: 8px 12px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; color: var(--glr-primary, #de4066); font-size: 12.5px; font-weight: 500; }
.glr-type-select-heading { font-size: 14px; font-weight: 700; color: var(--glr-primary-text, #0f172a); margin-bottom: 10px; }
.glr-type-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
@media (max-width: 580px) {
  .glr-type-cards { grid-template-columns: 1fr; }
}
.glr-type-card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 10px; background: #ffffff; cursor: pointer; transition: all 0.15s ease; user-select: none; position: relative; text-align: left; box-sizing: border-box; }
.glr-type-card:hover { border-color: #cbd5e1; background: #fbfcfd; }
.glr-type-card.glr-type-card--selected, .glr-type-card:has(input[type="radio"]:checked) { border-color: var(--glr-primary, #f43f5e); background: var(--glr-secondary-bg, #fff1f2); }
.glr-type-card input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; margin: 0; }
.glr-type-card-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.glr-radio-circle { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #d1d5db; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: border-color 0.15s ease; box-sizing: border-box; }
.glr-radio-circle::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--glr-primary, #de4066); opacity: 0; transition: opacity 0.15s ease; }
.glr-type-card.glr-type-card--selected .glr-radio-circle, .glr-type-card:has(input[type="radio"]:checked) .glr-radio-circle { border-color: var(--glr-primary, #de4066); }
.glr-type-card.glr-type-card--selected .glr-radio-circle::after, .glr-type-card:has(input[type="radio"]:checked) .glr-radio-circle::after { opacity: 1; }
.glr-type-icon { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex-shrink: 0; }
.glr-type-content { display: flex; flex-direction: column; gap: 2px; flex: 1; text-align: left; width: 100%; }
.glr-type-name { font-size: 13.5px; font-weight: 700; color: var(--glr-primary-text, #0f172a); }
.glr-type-desc { font-size: 11.5px; color: #64748b; font-weight: 400; line-height: 1.35; }
.glr-field-block { margin-bottom: 16px; text-align: left; }
.glr-form-label { display: block; font-size: 13px; font-weight: 600; color: var(--glr-primary-text, #0f172a); margin-bottom: 6px; text-align: left; }
.glr-required { color: #e11d48; margin-left: 2px; }
.glr-select-wrap { position: relative; width: 100%; }
.glr-custom-select { width: 100%; height: 40px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 0 32px 0 12px; font-size: 13px; color: #0f172a; background: #ffffff; cursor: pointer; box-sizing: border-box; outline: none; -webkit-appearance: none; appearance: none; transition: border-color 0.15s ease; font-family: inherit; }
.glr-custom-select:focus { border-color: #0f172a; }
.glr-select-chevron { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; }
.glr-textarea-wrap { position: relative; width: 100%; }
.glr-custom-textarea { width: 100%; min-height: 70px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #0f172a; background: #ffffff; box-sizing: border-box; outline: none; resize: vertical; font-family: inherit; transition: border-color 0.15s ease; }
.glr-custom-textarea:focus { border-color: #0f172a; }
.glr-char-counter { text-align: right; font-size: 11px; color: #9ca3af; margin-top: 4px; font-weight: 500; }
.glr-dropzone { border: 1px dashed #d1d5db; border-radius: 8px; padding: 12px 14px; display: flex; align-items: center; gap: 12px; background: #ffffff; cursor: pointer; transition: all 0.15s ease; user-select: none; }
.glr-dropzone:hover, .glr-dropzone--dragover { border-color: #9ca3af; background: #fafafa; }
.glr-dropzone-icon { display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.glr-dropzone-text { display: flex; flex-direction: column; gap: 2px; flex: 1; text-align: left; }
.glr-dropzone-title { font-size: 12.5px; font-weight: 600; color: #0f172a; }
.glr-dropzone-subtitle { font-size: 11.5px; color: #64748b; }
.glr-dropzone-btn { background: #ffffff; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 500; color: #0f172a; cursor: pointer; pointer-events: none; flex-shrink: 0; }
.glr-submit-row { margin-top: 20px; text-align: left; }
.glr-submit-request-btn { background: var(--glr-primary, #111827); color: var(--glr-btn-text, #ffffff); border: none; border-radius: 8px; height: 40px; padding: 0 20px; font-size: 13.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: opacity 0.15s ease; font-family: inherit; -webkit-appearance: none; appearance: none; }
.glr-submit-request-btn:hover { background: #27272a; }
.glr-submit-request-btn:active { background: #09090b; }

/* Order Summary Page */
.glr-summary-page { max-width: 680px; margin: 0 auto; padding: 2rem 1rem 4rem; }
.glr-back-btn { display: inline-flex; align-items: center; gap: 6px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 9999px; padding: 6px 14px; font-size: 13px; font-weight: 600; color: #0f172a; text-decoration: none; cursor: pointer; transition: all 0.15s ease; margin-bottom: 16px; outline: none; }
.glr-back-btn:hover { border-color: #cbd5e1; background: #f8fafc; }
.glr-summary-title { font-size: 30px; font-weight: 800; color: #0f172a; margin: 0 0 10px 0; letter-spacing: -0.025em; text-align: left; font-family: inherit; }
.glr-summary-order { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #64748b; font-weight: 500; margin-bottom: 24px; text-align: left; }
.glr-order-pill { background: #f1f5f9; color: #0f172a; font-weight: 700; padding: 3px 10px; border-radius: 6px; font-size: 13.5px; }

.glr-summary-card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 22px 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); text-align: left; }
.glr-summary-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
.glr-summary-card-title { font-size: 17px; font-weight: 700; color: #0f172a; margin: 0; font-family: inherit; }
.glr-summary-card-count { font-size: 13px; color: #64748b; margin-top: 3px; font-weight: 400; }
.glr-summary-edit-btn { background: none; border: none; padding: 0; color: #de4066; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; font-family: inherit; }
.glr-summary-edit-btn:hover { text-decoration: underline; color: #b52749; }

.glr-summary-items-list { display: flex; flex-direction: column; gap: 16px; }
.glr-summary-item { display: flex; align-items: center; gap: 16px; }
.glr-summary-item-img-wrap { width: 64px; height: 64px; border-radius: 10px; overflow: hidden; background: #f8fafc; border: 1px solid #f1f5f9; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.glr-summary-item-img { width: 100%; height: 100%; object-fit: cover; }
.glr-summary-item-info { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.glr-summary-item-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.glr-summary-item-title { font-size: 15px; font-weight: 700; color: #0f172a; }
.glr-type-badge { background: #dcfce7; color: #15803d; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; display: inline-flex; align-items: center; }
.glr-summary-item-meta { font-size: 13.5px; color: #64748b; }
.glr-summary-item-qty { font-size: 13.5px; color: #64748b; }
.glr-summary-item-price { font-size: 15px; font-weight: 700; color: #0f172a; flex-shrink: 0; margin-left: 12px; }

.glr-details-list { display: flex; flex-direction: column; gap: 16px; margin-top: 14px; }
.glr-details-row { display: flex; align-items: flex-start; gap: 16px; font-size: 14px; line-height: 1.5; }
.glr-details-label-col { display: flex; align-items: center; gap: 10px; width: 170px; flex-shrink: 0; color: #64748b; font-weight: 500; }
.glr-details-icon { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; flex-shrink: 0; color: #64748b; }
.glr-details-value-col { color: #0f172a; font-weight: 500; flex: 1; word-break: break-word; }
.glr-summary-photos { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 2px; }
.glr-summary-photo-thumb { width: 58px; height: 58px; border-radius: 8px; border: 1px solid #e5e7eb; object-fit: cover; }

.glr-refund-banner { background: #feeff4; border-radius: 14px; padding: 18px 24px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.glr-refund-banner-left { display: flex; align-items: center; gap: 12px; font-size: 16px; font-weight: 700; color: #0f172a; }
.glr-refund-banner-icon { display: flex; align-items: center; justify-content: center; color: #de4066; flex-shrink: 0; }
.glr-refund-banner-amount { font-size: 20px; font-weight: 800; color: #de4066; }
.glr-refund-disclaimer { font-size: 12.5px; color: #64748b; margin: 8px 0 24px 0; text-align: left; line-height: 1.4; }

.glr-confirm-btn { width: 100%; height: 48px; background: var(--glr-primary, #e52b5a); color: var(--glr-btn-text, #ffffff); border: none; border-radius: 12px; font-size: 15px; font-weight: 700; cursor: pointer; transition: background 0.15s ease, transform 0.15s ease; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); font-family: inherit; -webkit-appearance: none; appearance: none; display: flex; align-items: center; justify-content: center; }
.glr-confirm-btn:hover { filter: brightness(0.92); }
.glr-confirm-btn:active { filter: brightness(0.85); transform: scale(0.99); }

.glr-summary-policy-footer { font-size: 13px; color: #64748b; text-align: center; margin-top: 14px; line-height: 1.4; }
.glr-summary-policy-link { color: var(--glr-primary, #de4066); text-decoration: underline; cursor: pointer; font-weight: 500; }
.glr-summary-policy-link:hover { filter: brightness(0.85); }

/* Confirmation Screen */
.glr-conf-card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 36px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); text-align: center; box-sizing: border-box; }
.glr-conf-icon-wrap { display: flex; justify-content: center; align-items: center; margin-bottom: 20px; }
.glr-conf-title { font-size: 28px; font-weight: 800; color: #0f172a; margin: 0 0 20px 0; letter-spacing: -0.02em; font-family: inherit; text-align: center; }
.glr-conf-number-strip { background: var(--glr-secondary-bg, #feeff4); border: 1px solid #fce7f3; border-radius: 10px; padding: 12px 20px; max-width: 420px; margin: 0 auto 20px auto; display: flex; align-items: center; justify-content: space-between; }
.glr-conf-number-left { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 500; color: #0f172a; }
.glr-conf-divider { width: 1px; height: 20px; background: #e2e8f0; margin: 0 12px; }
.glr-conf-number-value { color: var(--glr-primary, #de4066); font-size: 16px; font-weight: 700; letter-spacing: 0.02em; }
.glr-conf-next-text { font-size: 14px; line-height: 1.5; color: #0f172a; max-width: 380px; margin: 0 auto 20px auto; text-align: center; }
.glr-conf-email-banner { background: var(--glr-secondary-bg, #feeff4); border: 1px solid #fce7f3; border-radius: 8px; padding: 12px 18px; max-width: 480px; margin: 0 auto 24px auto; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 13px; font-weight: 500; color: #0f172a; text-align: center; }
.glr-conf-email-icon { display: flex; align-items: center; justify-content: center; color: var(--glr-primary, #de4066); flex-shrink: 0; }
.glr-conf-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; max-width: 380px; height: 48px; background: var(--glr-primary, #e52b5a); color: var(--glr-btn-text, #ffffff); border-radius: 12px; font-size: 15px; font-weight: 700; text-decoration: none; transition: background 0.15s ease, transform 0.15s ease; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); font-family: inherit; margin: 0 auto; }
.glr-conf-btn:hover { filter: brightness(0.92); color: var(--glr-btn-text, #ffffff); text-decoration: none; }
.glr-conf-btn:active { filter: brightness(0.85); transform: scale(0.99); }

/* Logged-in Customer Orders Card & Styles */
.glr-header-icon-box { width: 52px; height: 52px; border-radius: 14px; background: var(--glr-secondary-bg, #feeef2); color: var(--glr-primary, #de4066); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; }
.glr-orders-card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 24px; padding: 26px 32px; width: 100% !important; max-width: 680px !important; margin: 0 auto; box-sizing: border-box !important; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02); }
.glr-orders-card form { width: 100% !important; box-sizing: border-box !important; }
.glr-orders-search-wrap { display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 16px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 14px; width: 100% !important; box-sizing: border-box !important; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
.glr-orders-search-wrap:focus-within { border-color: var(--glr-primary, #de4066); box-shadow: 0 0 0 1px var(--glr-primary, #de4066); }
.glr-orders-search-icon { flex-shrink: 0; color: #9ca3af; }
.glr-orders-search-input,
.glr-orders-search-wrap input.glr-orders-search-input,
input#glr-orders-search {
  width: 100% !important;
  border: none !important;
  border-width: 0 !important;
  outline: none !important;
  box-shadow: none !important;
  background: transparent !important;
  background-color: transparent !important;
  padding: 0 !important;
  margin: 0 !important;
  height: 100% !important;
  min-height: 0 !important;
  font-size: 14px !important;
  color: #0f172a !important;
  font-family: inherit !important;
  -webkit-appearance: none !important;
  -moz-appearance: none !important;
  appearance: none !important;
}
.glr-orders-search-input:focus,
.glr-orders-search-wrap input.glr-orders-search-input:focus,
input#glr-orders-search:focus {
  border: none !important;
  border-width: 0 !important;
  outline: none !important;
  box-shadow: none !important;
  background: transparent !important;
}
.glr-orders-search-input::placeholder { color: #9ca3af; opacity: 1; }
.glr-orders-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; width: 100% !important; box-sizing: border-box !important; }
.glr-order-item-wrap { border-bottom: 1px solid #f1f5f9; width: 100% !important; box-sizing: border-box !important; }
.glr-order-item-wrap:last-child { border-bottom: none; }
.glr-order-row-btn { width: 100% !important; display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 14px 10px; background: transparent; border: none; border-radius: 10px; cursor: pointer; text-align: left; transition: background-color 0.15s ease; font-family: inherit; -webkit-appearance: none; appearance: none; box-sizing: border-box !important; text-decoration: none; }
.glr-order-row-btn:hover { background-color: #f8fafc; }
.glr-order-pkg-box { width: 38px; height: 38px; border-radius: 10px; background: var(--glr-secondary-bg, #feeef2); color: var(--glr-primary, #de4066); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.glr-order-row-name { font-size: 15px; font-weight: 700; color: #0f172a; margin-left: 14px; min-width: 70px; flex-shrink: 0; white-space: nowrap; }
.glr-order-row-date { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; color: #64748b; margin-left: 16px; flex: 1 1 auto; white-space: nowrap; min-width: 0; }
.glr-order-row-date span { white-space: nowrap; word-break: keep-all; }
.glr-cal-icon { flex-shrink: 0; color: #9ca3af; }
.glr-order-status-wrap { flex-shrink: 0; margin-left: 16px; }
.glr-status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 5px 14px; border-radius: 9999px; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.glr-status-badge--fulfilled { background: #dcfce7; color: #15803d; }
.glr-status-badge--partially { background: #fef3c7; color: #b45309; }
.glr-status-badge--other { background: #f3f4f6; color: #4b5563; }
.glr-status-check { font-size: 12px; font-weight: 700; }
.glr-order-row-chevron { color: #9ca3af; display: flex; align-items: center; margin-left: 14px; flex-shrink: 0; }
.glr-no-search-results { padding: 28px 16px; text-align: center; font-size: 14px; color: #64748b; }
.glr-orders-pagination { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 22px; padding-top: 8px; }
.glr-pag-arrow { width: 34px; height: 34px; border-radius: 8px; border: 1px solid #e5e7eb; background: #ffffff; color: #4b5563; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; font-family: inherit; padding: 0; }
.glr-pag-arrow:hover:not(:disabled) { border-color: #cbd5e1; background: #f8fafc; }
.glr-pag-arrow:disabled, .glr-pag-arrow.glr-pag-disabled { opacity: 0.35; cursor: not-allowed; pointer-events: none; }
.glr-pag-pages { display: flex; align-items: center; gap: 6px; }
.glr-pag-num { width: 34px; height: 34px; border-radius: 50%; border: none; background: transparent; color: #4b5563; font-size: 13.5px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; font-family: inherit; padding: 0; }
.glr-pag-num:hover:not(.glr-pag-num--active) { background: #f1f5f9; color: #0f172a; }
.glr-pag-num--active { background: var(--glr-primary, #de4066); color: var(--glr-btn-text, #ffffff); font-weight: 700; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12); cursor: default; }

/* "Order not listed?" card */
.glr-unlisted-card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 20px; padding: 20px 28px; width: 100% !important; max-width: 680px !important; margin: 18px auto 0 auto; box-sizing: border-box !important; display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 16px !important; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02); }
.glr-unlisted-left { display: flex !important; align-items: center !important; gap: 16px !important; flex: 1 1 auto !important; min-width: 0 !important; }
.glr-unlisted-icon { width: 38px; height: 38px; border-radius: 50%; background: var(--glr-secondary-bg, #feeef2); color: var(--glr-primary, #de4066); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.glr-unlisted-content { display: flex !important; flex-direction: column !important; gap: 3px !important; text-align: left !important; flex: 1 1 auto !important; min-width: 0 !important; }
.glr-unlisted-title { font-size: 15px; font-weight: 700; color: #0f172a; white-space: nowrap; }
.glr-unlisted-subtitle { font-size: 13.5px; color: #64748b; line-height: 1.35; }
.glr-unlisted-btn { background: #ffffff; border: 1.5px solid var(--glr-primary, #de4066); color: var(--glr-primary, #de4066); border-radius: 10px; padding: 10px 22px; font-size: 13.5px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.15s ease; font-family: inherit; flex-shrink: 0 !important; }
.glr-unlisted-btn:hover { background: var(--glr-secondary-bg, #feeef2); }
.glr-unlisted-guest-wrap { margin-top: 18px; width: 100% !important; max-width: 680px !important; margin-left: auto; margin-right: auto; box-sizing: border-box !important; }
.glr-unlisted-guest-wrap .glr-order-card { max-width: 100% !important; width: 100% !important; box-sizing: border-box !important; }
.glr-hidden { display: none !important; }

@media (max-width: 680px) {
  .glr-order-page { padding: 1.5rem 14px 3rem; }
  .glr-orders-card { padding: 20px 16px; border-radius: 18px; }
  .glr-order-row-btn { padding: 12px 6px; }
  .glr-order-row-name { margin-left: 10px; font-size: 14px; min-width: 55px; }
  .glr-order-row-date { margin-left: 10px; font-size: 12.5px; }
  .glr-status-badge { padding: 4px 10px; font-size: 11.5px; margin-left: 8px; }
  .glr-order-row-chevron { margin-left: 8px; }
}
@media (max-width: 540px) {
  .glr-unlisted-card { flex-direction: column !important; align-items: stretch !important; text-align: left; padding: 18px; gap: 14px !important; }
  .glr-unlisted-left { align-items: flex-start !important; }
  .glr-unlisted-btn { width: 100%; text-align: center; }
}
</style>`;

/** Wraps a screen in the page container. Shopify adds the theme header/footer. */
export function page(opts: {
  title: string;
  lead?: string;
  body: string;
  eyebrow?: string;
  headerIcon?: string;
  showTopbar?: boolean;
  showFooter?: boolean;
  lang?: ProxyLang;
  isOrderPage?: boolean;
  isTypeSelectPage?: boolean;
  isSummaryPage?: boolean;
  customization?: ReturnFormCustomization;
}): string {
  const topbar = opts.showTopbar ? topBar() : "";
  const footer = opts.showFooter ? orderFooter() : "";
  const eyebrow = opts.eyebrow ? `<div class="glr-eyebrow">${esc(opts.eyebrow)}</div>` : "";
  const headerIcon = opts.headerIcon ? opts.headerIcon : "";
  const customStyles = opts.customization
    ? `<style>
:root {
  --glr-primary: ${esc(opts.customization.primaryColor)};
  --glr-primary-text: ${esc(opts.customization.primaryTextColor)};
  --glr-btn-text: ${esc(opts.customization.textColor)};
  --glr-secondary-bg: ${esc(opts.customization.secondaryBgColor)};
}
</style>`
    : "";

  if (opts.isSummaryPage) {
    return `${STYLES}${customStyles}
<div class="page-width glr glr-summary-page">
  <div class="glr-stack">
    ${opts.body}
  </div>
</div>`;
  }

  if (opts.isOrderPage) {
    return `${STYLES}${customStyles}
<div class="page-width glr glr-order-page">
  ${topbar}
  <div class="glr-header-center">
    ${headerIcon}
    ${eyebrow}
    <h1 class="glr-title">${esc(opts.title)}</h1>
    ${opts.lead ? `<p class="glr-subtitle">${esc(opts.lead)}</p>` : ""}
  </div>
  <div class="glr-stack">
    ${opts.body}
  </div>
  ${footer}
</div>`;
  }

  if (opts.isTypeSelectPage) {
    const brandHeader = opts.customization && (opts.customization.showLogo || opts.customization.showStoreName)
      ? `<div class="glr-brand-header">
          ${opts.customization.showLogo && opts.customization.logoUrl ? `<img src="${esc(opts.customization.logoUrl)}" alt="Store Logo" class="glr-brand-logo">` : ""}
          ${opts.customization.showStoreName ? `<span class="glr-brand-name">${esc(opts.customization.storeName || "Grand Le Mar")}</span>` : ""}
        </div>`
      : "";

    return `${STYLES}${customStyles}
<div class="page-width glr glr-type-select-page">
  ${brandHeader}
  <div class="glr-header-left">
    <h1 class="glr-title-left">${esc(opts.title)}</h1>
    ${opts.lead ? `<p class="glr-lead-left">${esc(opts.lead)}</p>` : ""}
  </div>
  <div class="glr-stack">
    ${opts.body}
  </div>
</div>`;
  }

  return `${STYLES}${customStyles}
<div class="page-width glr">
  ${topbar}
  ${eyebrow}
  <h1 class="glr-title" style="text-align:left;">${esc(opts.title)}</h1>
  ${opts.lead ? `<p class="glr-lead">${esc(opts.lead)}</p>` : ""}
  <div class="glr-stack">
    ${opts.body}
  </div>
  ${footer}
</div>`;
}
