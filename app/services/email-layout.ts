/**
 * Shared email layout: one header + footer per shop wrapped around each
 * event template's body. Client-safe (no server imports) so the admin preview
 * renders exactly what customers receive.
 */

export type EmailLayout = {
  showLogo: boolean;
  /** https URL or an uploaded image as a data URL. */
  logoUrl: string;
  showStoreName: boolean;
  storeName: string;
  headerBgColor: string;
  headerTextColor: string;
  /** Link and button color inside the email body. */
  accentColor: string;
  /** Plain text (line breaks kept) or HTML; supports {{variables}}. */
  footerText: string;
  footerBgColor: string;
  footerTextColor: string;
};

export const DEFAULT_EMAIL_LAYOUT: EmailLayout = {
  showLogo: true,
  logoUrl: "",
  showStoreName: true,
  storeName: "Grand Le Mar",
  headerBgColor: "#ffffff",
  headerTextColor: "#111827",
  accentColor: "#de4066",
  footerText:
    "Questions about your return? Just reply to this email.\n© {{current_year}} {{storeName}}. All rights reserved.",
  footerBgColor: "#f9fafb",
  footerTextColor: "#6b7280",
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function pickColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value.trim()) ? value.trim() : fallback;
}

/** Validates stored/submitted layout data, filling gaps from `base`. */
export function normalizeEmailLayout(raw: unknown, base: EmailLayout = DEFAULT_EMAIL_LAYOUT): EmailLayout {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (key: keyof EmailLayout) =>
    typeof value[key] === "string" ? (value[key] as string) : (base[key] as string);
  const bool = (key: keyof EmailLayout) =>
    typeof value[key] === "boolean" ? (value[key] as boolean) : (base[key] as boolean);
  return {
    showLogo: bool("showLogo"),
    logoUrl: text("logoUrl"),
    showStoreName: bool("showStoreName"),
    storeName: text("storeName"),
    headerBgColor: pickColor(value.headerBgColor, base.headerBgColor),
    headerTextColor: pickColor(value.headerTextColor, base.headerTextColor),
    accentColor: pickColor(value.accentColor, base.accentColor),
    footerText: text("footerText"),
    footerBgColor: pickColor(value.footerBgColor, base.footerBgColor),
    footerTextColor: pickColor(value.footerTextColor, base.footerTextColor),
  };
}

export type EmailVars = Record<string, string | number | null | undefined>;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

const HTML_TAG = /<\/?[a-z][\s\S]*>/i;

/** Whether a template was written as HTML (decide from the template, not the filled-in text). */
export function isHtmlBody(template: string): boolean {
  return HTML_TAG.test(template);
}

export function renderTemplate(str: string, vars: EmailVars, html = false): string {
  const orderNumber = vars.orderNumber;
  const templateVars: EmailVars = {
    ...vars,
    first_name: vars.first_name ?? vars.customerName,
    order_number: vars.order_number ?? (typeof orderNumber === "string" ? orderNumber.replace(/^#/, "") : orderNumber),
    request_number: vars.request_number ?? vars.requestNumber,
    returned_items: vars.returned_items ?? vars.items,
    current_year: vars.current_year ?? new Date().getFullYear(),
  };
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = templateVars[key];
    const value = v === null || v === undefined ? "" : String(v);
    return html ? escapeHtml(value) : value;
  });
}

/** Renders a template (body or footer) with variables and returns HTML. */
export function renderTemplateHtml(template: string, vars: EmailVars): string {
  if (isHtmlBody(template)) return renderTemplate(template, vars, true);
  return escapeHtml(renderTemplate(template, vars)).replace(/\r?\n/g, "<br>\n");
}

/** Plain-text alternative for email clients that don't render HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Sample values used by the admin preview and test sends. */
export const SAMPLE_EMAIL_VARS: EmailVars = {
  orderNumber: "#1021",
  requestNumber: "GLM-1021",
  customerName: "Emma Andersson",
  items: "Linen Shirt (M), Wool Scarf",
  labelLink: "https://example.com/label.pdf",
  trackingLink: "https://example.com/tracking",
  reason: "The item shows signs of wear",
  amount: "49.00",
  paymentLink: "https://example.com/pay",
};

/**
 * Builds the full email document: header (logo / store name), the rendered
 * body, and the footer. Table-based with inline styles for email clients.
 */
export function renderEmailDocument(options: {
  layout: EmailLayout;
  /** Body already rendered to HTML (see renderTemplateHtml). */
  bodyHtml: string;
  vars: EmailVars;
  /** Image URL to use for the logo (a public URL in real emails). */
  logoSrc?: string;
  /** Hidden inbox preview line. */
  preheader?: string;
}): string {
  const { layout, bodyHtml, vars, preheader } = options;
  const logoSrc = options.logoSrc ?? layout.logoUrl;
  const storeName = layout.storeName.trim();
  const footerHtml = layout.footerText.trim()
    ? renderTemplateHtml(layout.footerText.trim(), { storeName, ...vars })
    : "";

  const logo = layout.showLogo && logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(storeName || "Logo")}" height="48" style="display:block;margin:0 auto;max-height:48px;max-width:200px;height:auto;border:0;">`
    : "";
  const name = layout.showStoreName && storeName
    ? `<div style="margin-top:${logo ? "10px" : "0"};font-size:20px;font-weight:700;letter-spacing:0.02em;color:${layout.headerTextColor};">${escapeHtml(storeName)}</div>`
    : "";
  const header = logo || name
    ? `<tr><td align="center" style="padding:28px 32px;background:${layout.headerBgColor};border-bottom:3px solid ${layout.accentColor};">${logo}${name}</td></tr>`
    : `<tr><td style="height:4px;line-height:4px;font-size:0;background:${layout.accentColor};">&nbsp;</td></tr>`;
  const footer = footerHtml
    ? `<tr><td align="center" style="padding:20px 32px;background:${layout.footerBgColor};color:${layout.footerTextColor};font-size:12px;line-height:1.6;">${footerHtml}</td></tr>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  .email-body a { color: ${layout.accentColor}; }
  .email-body p { margin: 0 0 14px; }
  @media (max-width: 620px) { .email-card { width: 100% !important; } .email-pad { padding: 24px 20px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" class="email-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
      ${header}
      <tr><td class="email-pad email-body" style="padding:32px;font-size:15px;line-height:1.65;color:#111827;">
${bodyHtml}
      </td></tr>
      ${footer}
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
