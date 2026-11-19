import crypto from "node:crypto";

// Short-lived signed token that carries a verified order between proxy steps.
// After lookup succeeds, later steps MUST take the order id from this token,
// never from a posted form field. See docs/storefront-return-proxy.md.

export type ProxyRequestType = "return" | "exchange" | "complaint";

export type ProxyOrderTokenPayload = {
  v: 1;
  shop: string;
  /** Shopify order GID, e.g. gid://shopify/Order/123 */
  orderId: string;
  orderName: string;
  requestType: ProxyRequestType;
  /** Set on the logged-in path; null for guests. */
  customerId: string | null;
  /** Expiry, epoch ms. */
  exp: number;
};

const TOKEN_TTL_MS = 30 * 60 * 1000;

function secret(): string {
  const s = process.env.SHOPIFY_API_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SHOPIFY_API_SECRET is required to sign proxy order tokens");
    }
    return "dev-only-insecure-proxy-token";
  }
  return s;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", `proxy-order-token:${secret()}`).update(body).digest("base64url");
}

export function issueOrderToken(
  input: Omit<ProxyOrderTokenPayload, "v" | "exp">,
  now = Date.now(),
): string {
  const payload: ProxyOrderTokenPayload = { v: 1, ...input, exp: now + TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/**
 * Returns the payload only if the signature is valid, the token has not
 * expired, and it was issued for `shop` (the signed proxy shop).
 */
export function verifyOrderToken(
  token: string | null | undefined,
  shop: string,
  now = Date.now(),
): ProxyOrderTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;

  let payload: ProxyOrderTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload?.v !== 1) return null;
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (!shop || payload.shop !== shop) return null;
  if (!["return", "exchange", "complaint"].includes(payload.requestType)) return null;
  return payload;
}
