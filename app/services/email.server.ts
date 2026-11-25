/* eslint-disable @typescript-eslint/no-explicit-any */
import { listEmailTemplates } from "./email-templates.server";
import { storefrontReturnsUrl } from "./storefront-links.server";
import { getOrCreateSettings } from "./settings.server";
import { Resend } from "resend";

export type EmailVars = Record<string, string | number | null | undefined>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
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

const HTML_TAG = /<\/?[a-z][\s\S]*>/i;

/** Whether a template body was written as HTML (decide from the template, not the filled-in body). */
export function isHtmlBody(template: string): boolean {
  return HTML_TAG.test(template);
}

/**
 * Turns a template body into email-ready HTML. Plain-text bodies (like the
 * built-in defaults) keep their line breaks; HTML bodies from the rich-text
 * editor are used as-is. Either way the result is wrapped in a simple layout.
 */
export function toEmailHtml(body: string, isHtml = isHtmlBody(body)): string {
  const content = isHtml
    ? body
    : escapeHtml(body).replace(/\r?\n/g, "<br>\n");
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:24px;background:#f6f6f7;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;">
${content}
    </div>
  </body>
</html>`;
}

/** Plain-text alternative for email clients that don't render HTML. */
export function toEmailText(body: string, isHtml = isHtmlBody(body)): string {
  if (!isHtml) return body.trim();
  return body
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

export type SendEmailResult = { ok: boolean; provider: string; error?: string };

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  sender?: string,
  isHtml: boolean = isHtmlBody(body),
): Promise<SendEmailResult> {
  if (!to.trim()) return { ok: false, provider: "none", error: "No recipient email address" };

  const resendApiKey = process.env.RESEND_API_KEY
    || (process.env.EMAIL_PROVIDER?.toLowerCase() === "resend" ? process.env.EMAIL_API_KEY : undefined);
  if (resendApiKey) {
    const from = sender?.trim() || process.env.EMAIL_FROM;
    if (!from) {
      console.error("[Email] EMAIL_FROM is required when using Resend.");
      return { ok: false, provider: "resend", error: "No sender address: set the company sender email or EMAIL_FROM" };
    }

    try {
      const { error } = await new Resend(resendApiKey).emails.send({
        from,
        to,
        subject,
        html: toEmailHtml(body, isHtml),
        text: toEmailText(body, isHtml),
      });
      if (error) {
        console.error(`[Email] Resend delivery failed: ${error.message}`);
        return { ok: false, provider: "resend", error: error.message };
      }
      return { ok: true, provider: "resend" };
    } catch (error) {
      console.error("[Email] Resend delivery failed:", error);
      return { ok: false, provider: "resend", error: error instanceof Error ? error.message : "Resend request failed" };
    }
  }

  if (process.env.EMAIL_WEBHOOK_URL) {
    try {
      const res = await fetch(process.env.EMAIL_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body, html: toEmailHtml(body, isHtml), text: toEmailText(body, isHtml) }),
      });
      if (res.ok) return { ok: true, provider: "webhook" };
      console.error(`[Email] Webhook delivery failed with status ${res.status}`);
    } catch (error) {
      console.error("[Email] Webhook delivery failed:", error);
    }
  }

  // No provider configured: nothing is actually delivered, so report failure.
  console.warn(`[Email] Not sent (set RESEND_API_KEY to enable delivery).\nTo: ${to}\nSubject: ${subject}\n${toEmailText(body, isHtml)}\n---`);
  return { ok: false, provider: "console", error: "Email delivery is not configured (RESEND_API_KEY is missing)" };
}

export async function sendEventEmail(
  shop: string,
  event: string,
  language: string,
  to: string,
  vars: EmailVars,
): Promise<{ ok: boolean; error?: string }> {
  const templates = await listEmailTemplates(shop);
  const tpl = templates.find((t: any) => t.event === event && t.language === language)
    || templates.find((t: any) => t.event === event)
    || null;
  if (!tpl) {
    console.warn(`[Email] No "${event}" email template for ${shop}; nothing sent.`);
    return { ok: false, error: `No "${event}" email template` };
  }
  // Every template can use {{returnsUrl}}: the storefront return page (app proxy).
  const allVars: EmailVars = { returnsUrl: storefrontReturnsUrl(shop), ...vars };
  const subject = renderTemplate(tpl.subject, allVars);
  // HTML bodies get escaped variable values; plain-text bodies are escaped later by toEmailHtml.
  const isHtml = isHtmlBody(tpl.body);
  const body = renderTemplate(tpl.body, allVars, isHtml);
  const settings = await getOrCreateSettings(shop);
  const result = await sendEmail(to, subject, body, settings.emailFrom || undefined, isHtml);
  return { ok: result.ok, error: result.error };
}
