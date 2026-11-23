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

export async function sendEmail(to: string, subject: string, body: string, sender?: string): Promise<{ ok: boolean; provider: string }> {
  const resendApiKey = process.env.RESEND_API_KEY
    || (process.env.EMAIL_PROVIDER?.toLowerCase() === "resend" ? process.env.EMAIL_API_KEY : undefined);
  if (resendApiKey) {
    const from = sender?.trim() || process.env.EMAIL_FROM;
    if (!from) {
      console.error("[Email] EMAIL_FROM is required when using Resend.");
      return { ok: false, provider: "resend" };
    }

    try {
      const hasHtml = /<\/?[a-z][\s\S]*>/i.test(body);
      const html = hasHtml ? body : `<div style="white-space: pre-wrap">${escapeHtml(body)}</div>`;
      const text = hasHtml ? body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : body;
      const { error } = await new Resend(resendApiKey).emails.send({ from, to, subject, html, text });
      if (error) {
        console.error(`[Email] Resend delivery failed: ${error.message}`);
        return { ok: false, provider: "resend" };
      }
      return { ok: true, provider: "resend" };
    } catch (error) {
      console.error("[Email] Resend delivery failed:", error);
      return { ok: false, provider: "resend" };
    }
  }

  if (process.env.EMAIL_WEBHOOK_URL) {
    try {
      await fetch(process.env.EMAIL_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body }),
      });
      return { ok: true, provider: "webhook" };
    } catch {
      // fall through to console
    }
  }
  console.log(`[Email] To: ${to}\nSubject: ${subject}\n${body}\n---`);
  return { ok: true, provider: "console" };
}

export async function sendEventEmail(
  shop: string,
  event: string,
  language: string,
  to: string,
  vars: EmailVars,
): Promise<{ ok: boolean }> {
  const templates = await listEmailTemplates(shop);
  const tpl = templates.find((t: any) => t.event === event && t.language === language)
    || templates.find((t: any) => t.event === event)
    || null;
  if (!tpl) return { ok: false };
  // Every template can use {{returnsUrl}}: the storefront return page (app proxy).
  const allVars: EmailVars = { returnsUrl: storefrontReturnsUrl(shop, tpl.language), ...vars };
  const subject = renderTemplate(tpl.subject, allVars);
  // Always treat email body as HTML to allow HTML design from admin
  const bodyIsHtml = true;
  const body = renderTemplate(tpl.body, allVars, bodyIsHtml);
  const settings = await getOrCreateSettings(shop);
  const result = await sendEmail(to, subject, body, settings.emailFrom || undefined);
  return { ok: result.ok };
}
