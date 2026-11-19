import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Storefront return page served through the Shopify app proxy:
//   https://{shop}/apps/returns  ->  {appUrl}/proxy/returns
// See docs/storefront-return-proxy.md.
//
// Step 1 (registration check): verify the proxy signature and echo the signed
// parameters so we can confirm the proxy is wired up on a dev store.
// Step 2 replaces this body with the real themed return page.

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Throws a 400 response if the signature is missing or invalid.
  const { liquid } = await authenticate.public.appProxy(request);

  const params = new URL(request.url).searchParams;
  const shop = params.get("shop") ?? "";
  const loggedInCustomerId = params.get("logged_in_customer_id") ?? "";
  const hasSignature = params.has("signature");
  const timestamp = params.get("timestamp") ?? "";

  const rows = [
    ["shop", shop],
    ["signature present", hasSignature ? "yes" : "no"],
    ["timestamp", timestamp],
    ["logged_in_customer_id", loggedInCustomerId || "(guest)"],
  ]
    .map(
      ([k, v]) =>
        `<tr><th style="text-align:left;padding-right:1rem">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`,
    )
    .join("");

  return liquid(
    `<div class="page-width" style="padding:2rem 0">
  <h1>Returns</h1>
  <p>App proxy is connected.</p>
  <table>${rows}</table>
</div>`,
  );
};
