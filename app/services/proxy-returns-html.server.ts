// HTML helpers for the storefront return page served through the app proxy.
// See docs/storefront-return-proxy.md.
//
// The response is Liquid, so Shopify renders it inside the shop's theme.
// Every dynamic value MUST go through `esc` — it escapes HTML and also the
// Liquid delimiters `{` / `}`, so customer input can never be evaluated as
// Liquid by Shopify.

export type ProxyLang = "en" | "sv";

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
  const lang = params.get("lang") === "sv" ? "sv" : "en";
  return {
    shop: params.get("shop") ?? "",
    loggedInCustomerId: params.get("logged_in_customer_id") || null,
    lang,
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

export function errorBox(message: string | null | undefined): string {
  if (!message) return "";
  return `<div class="glr-error" role="alert">${esc(message)}</div>`;
}

export function card(inner: string, heading?: string): string {
  return `<section class="glr-card">${heading ? `<h2 class="h4">${esc(heading)}</h2>` : ""}${inner}</section>`;
}

const STYLES = `<style>
.glr { max-width: 42rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
.glr h1 { margin: 0 0 .5rem; }
.glr-lead { margin: 0 0 2rem; opacity: .75; }
.glr-stack { display: flex; flex-direction: column; gap: 1.25rem; }
.glr-card { border: 1px solid rgba(var(--color-foreground, 0,0,0), .15); border-radius: var(--inputs-radius, 4px); padding: 1.5rem; }
.glr-card > h2 { margin: 0 0 1rem; }
.glr-field { margin: 0 0 1rem; }
.glr-error { border: 1px solid #c0392b; background: rgba(192,57,43,.06); color: #a93226; border-radius: 4px; padding: .75rem 1rem; }
.glr-notice { border: 1px solid rgba(var(--color-foreground, 0,0,0), .2); border-radius: 4px; padding: .75rem 1rem; }
.glr-actions { display: flex; gap: .75rem; flex-wrap: wrap; margin-top: 1rem; }
.glr-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .75rem; }
.glr-muted { opacity: .7; font-size: .9em; }
.glr button[disabled] { opacity: .5; cursor: not-allowed; }
</style>`;

/** Wraps a screen in the page container. Shopify adds the theme header/footer. */
export function page(opts: { title: string; lead?: string; body: string }): string {
  return `${STYLES}
<div class="page-width glr">
  <h1>${esc(opts.title)}</h1>
  ${opts.lead ? `<p class="glr-lead">${esc(opts.lead)}</p>` : ""}
  <div class="glr-stack">
    ${opts.body}
  </div>
</div>`;
}
