import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  card,
  errorBox,
  page,
  readProxyContext,
  type ProxyContext,
} from "../services/proxy-returns-html.server";

// Storefront return page served through the Shopify app proxy:
//   https://{shop}/apps/returns  ->  {appUrl}/proxy/returns
// See docs/storefront-return-proxy.md.
//
// Resource route: no React component. Every response is Liquid so Shopify
// renders it inside the shop's theme. Both loader and action verify the
// proxy signature; the shop always comes from the signed query string.

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

const COPY = {
  en: {
    title: "Returns & exchanges",
    lead: "Start a return, exchange, or complaint for an order.",
    guest: "Find your order with the order number and the email used at checkout.",
    loggedIn: "Choose the order you want to return or exchange.",
    unknownStage: "Something went wrong. Please start again.",
  },
  sv: {
    title: "Returer & byten",
    lead: "Starta en retur, ett byte eller en reklamation för en order.",
    guest: "Hitta din order med ordernumret och e-postadressen från köpet.",
    loggedIn: "Välj ordern du vill returnera eller byta.",
    unknownStage: "Något gick fel. Börja om.",
  },
} as const;

function startScreen(ctx: ProxyContext, error?: string): string {
  const t = COPY[ctx.lang];
  // Step 3 replaces the guest card with the lookup form.
  // Step 4 replaces the logged-in card with the customer's order list.
  const body = ctx.loggedInCustomerId
    ? card(`<p class="glr-notice">${t.loggedIn}</p>`)
    : card(`<p class="glr-notice">${t.guest}</p>`);
  return page({ title: t.title, lead: t.lead, body: errorBox(error) + body });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Throws 400 if the proxy signature is missing or invalid.
  const { liquid } = await authenticate.public.appProxy(request);
  const ctx = readProxyContext(request);
  return liquid(startScreen(ctx), NO_STORE);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { liquid } = await authenticate.public.appProxy(request);
  const ctx = readProxyContext(request);
  const formData = await request.formData();
  // Posted `shop` is a display hint only and is deliberately ignored.
  const lang = formData.get("lang") === "sv" ? "sv" : ctx.lang;
  const stage = String(formData.get("_stage") || "");
  const c: ProxyContext = { ...ctx, lang };

  switch (stage) {
    // Steps 3–5 add: "lookup", "select_order", "submit".
    default:
      // 200 on purpose: error screens must still render inside the theme.
      return liquid(startScreen(c, COPY[lang].unknownStage), NO_STORE);
  }
};
