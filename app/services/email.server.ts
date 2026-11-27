/* eslint-disable @typescript-eslint/no-explicit-any */
import { listEmailTemplates } from "./email-templates.server";
import { storefrontReturnsUrl } from "./storefront-links.server";
import { getEmailLayout, getOrCreateSettings } from "./settings.server";
import {
  htmlToText,
  isHtmlBody,
  renderEmailDocument,
  renderTemplate,
  renderTemplateHtml,
  type EmailLayout,
  type EmailVars,
} from "./email-layout";
import { Resend } from "resend";
import { emailRecipientFor } from "./test-mode.server";

export { renderTemplate, isHtmlBody } from "./email-layout";
export type { EmailVars } from "./email-layout";

/**
 * Public URL for the shop's email logo. Uploaded logos are stored as data URLs,
 * which Gmail and Outlook block, so they are served by the /email-logo route.
 */
export function emailLogoSrc(shop: string, layout: EmailLayout): string {
  const logo = layout.logoUrl.trim();
  if (!logo) return "";
  if (!logo.startsWith("data:")) return logo;
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!appUrl) return "";
  // Version the URL so email clients pick up a changed logo.
  let hash = 0;
  for (let i = 0; i < logo.length; i += 97) hash = (hash * 31 + logo.charCodeAt(i)) | 0;
  return `${appUrl}/email-logo/${encodeURIComponent(shop)}?v=${(hash >>> 0).toString(36)}`;
}

/** Renders a template body inside the shop's shared header and footer. */
export async function buildShopEmail(shop: string, templateBody: string, vars: EmailVars) {
  const settings = await getOrCreateSettings(shop);
  const layout = getEmailLayout(settings);
  const allVars: EmailVars = { storeName: layout.storeName, returnsUrl: storefrontReturnsUrl(shop), ...vars };
  const bodyHtml = renderTemplateHtml(templateBody, allVars);
  const html = renderEmailDocument({ layout, bodyHtml, vars: allVars, logoSrc: emailLogoSrc(shop, layout) });
  return { settings, html, text: htmlToText(bodyHtml), vars: allVars };
}

/** Neutral layout for internal emails (e.g. admin notifications). */
const PLAIN_LAYOUT: EmailLayout = {
  showLogo: false,
  logoUrl: "",
  logoHeight: 48,
  showStoreName: false,
  storeName: "",
  headerBgColor: "#ffffff",
  headerTextColor: "#111827",
  accentColor: "#111827",
  footerText: "",
  footerBgColor: "#ffffff",
  footerTextColor: "#6b7280",
};

export type SendEmailResult = { ok: boolean; provider: string; error?: string };

/**
 * Sends an email. Pass `content` with prebuilt HTML/text (see buildShopEmail);
 * otherwise `body` is sent with a plain layout.
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  sender?: string,
  content?: { html: string; text: string },
): Promise<SendEmailResult> {
  const isHtml = isHtmlBody(body);
  const html = content?.html ?? renderEmailDocument({
    layout: { ...PLAIN_LAYOUT },
    bodyHtml: isHtml ? body : renderTemplateHtml(body, {}),
    vars: {},
  });
  const text = content?.text ?? (isHtml ? htmlToText(body) : body.trim());

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
        html,
        text,
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
        body: JSON.stringify({ to, subject, body, html, text }),
      });
      if (res.ok) return { ok: true, provider: "webhook" };
      console.error(`[Email] Webhook delivery failed with status ${res.status}`);
    } catch (error) {
      console.error("[Email] Webhook delivery failed:", error);
    }
  }

  // No provider configured: nothing is actually delivered, so report failure.
  console.warn(`[Email] Not sent (set RESEND_API_KEY to enable delivery).\nTo: ${to}\nSubject: ${subject}\n${text}\n---`);
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
  // Every template can use {{returnsUrl}} (the storefront return page) and {{storeName}}.
  const { settings, html, text, vars: allVars } = await buildShopEmail(shop, tpl.body, vars);
  const subject = renderTemplate(tpl.subject, allVars);
  const result = await sendEmail(emailRecipientFor(shop, to), subject, tpl.body, settings.emailFrom || undefined, { html, text });
  return { ok: result.ok, error: result.error };
}
