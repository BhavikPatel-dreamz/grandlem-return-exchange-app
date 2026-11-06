/* eslint-disable @typescript-eslint/no-explicit-any */
import { listEmailTemplates } from "./email-templates.server";

export type EmailVars = Record<string, string | number | null | undefined>;

export function renderTemplate(str: string, vars: EmailVars): string {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

export async function sendEmail(to: string, subject: string, body: string): Promise<{ ok: boolean; provider: string }> {
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
  const subject = renderTemplate(tpl.subject, vars);
  const body = renderTemplate(tpl.body, vars);
  const result = await sendEmail(to, subject, body);
  return { ok: result.ok };
}
