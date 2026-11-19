// Customer-facing links to the storefront return page (app proxy).
// Customers must be sent here, never to the app's own /portal URL.
// See docs/storefront-return-proxy.md, Step 6.

/**
 * Storefront path of the returns page. Must match `[app_proxy]` prefix/subpath
 * in shopify.app.toml. (A merchant can rename the subpath in their admin;
 * links built here assume the default.)
 */
export const RETURNS_PROXY_PATH = "/apps/returns";

/**
 * `https://{shop}/apps/returns`, optionally with `?lang=sv`.
 * The myshopify domain redirects to the shop's primary domain.
 */
export function storefrontReturnsUrl(shop: string, lang?: string | null): string {
  if (!shop) return "";
  const url = new URL(RETURNS_PROXY_PATH, `https://${shop}`);
  if (lang === "sv") url.searchParams.set("lang", "sv");
  return url.toString();
}
