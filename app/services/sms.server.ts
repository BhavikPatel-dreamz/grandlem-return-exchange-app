/* eslint-disable @typescript-eslint/no-explicit-any */
export async function sendSms(to: string, message: string): Promise<{ ok: boolean; provider?: string }> {
  const url = process.env.SMS_WEBHOOK_URL;
  if (url) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, message }),
      });
      return { ok: true, provider: "webhook" };
    } catch {
      // fall through
    }
  }
  console.log(`[SMS] To: ${to}\n${message}\n---`);
  return { ok: true, provider: "console" };
}
