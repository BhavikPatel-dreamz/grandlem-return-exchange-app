import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { storefrontReturnsUrl } from "../services/storefront-links.server";

// Retired. The old standalone portal trusted a `shop` value posted by the
// browser. Customers now use the storefront page served through the signed
// app proxy (https://{shop}/apps/returns); see docs/storefront-return-proxy.md.

const MYSHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = (new URL(request.url).searchParams.get("shop") || "").trim().toLowerCase();
  if (MYSHOPIFY_DOMAIN.test(shop)) return redirect(storefrontReturnsUrl(shop), 301);
  throw new Response("Not found", { status: 404 });
};

export const action = async () => {
  throw new Response("This page has moved to the store's returns page.", { status: 410 });
};
