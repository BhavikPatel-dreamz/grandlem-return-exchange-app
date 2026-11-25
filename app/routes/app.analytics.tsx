/* eslint-disable @typescript-eslint/no-explicit-any */
import { redirect, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SettingsLayout } from "../components/admin/SettingsLayout";
import {
  getKpis,
  getTopReturnedItems,
  getExchangeOutcomes,
  getReturnsByCountry,
} from "../services/analytics/analytics.server";

function resolveRange(range: string, url: URL) {
  const now = new Date();
  const days = range === "7" ? 7 : range === "90" ? 90 : 30;
  if (range === "custom") {
    const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date(now.getTime() - 30 * 86400000);
    const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : now;
    return { from, to, label: "Custom" };
  }
  const from = new Date(now.getTime() - days * 86400000);
  return { from, to: now, label: `Last ${days} days` };
}

// Analytics is hidden for now. Set to true (and restore the Settings tab link) to bring it back.
const ANALYTICS_ENABLED = false;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!ANALYTICS_ENABLED) throw redirect("/app/settings");
  const shop = session.shop;
  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "30";
  const market = url.searchParams.get("market") || "ALL";
  const { from, to, label } = resolveRange(range, url);

  const filters = { shopId: shop, from, to, marketCode: market };
  const [kpis, topItems, outcomes, byCountry] = await Promise.all([
    getKpis(filters),
    getTopReturnedItems(filters),
    getExchangeOutcomes(filters),
    getReturnsByCountry(filters),
  ]);

  return { shop, range, market, from: from.toISOString(), to: to.toISOString(), periodLabel: label, kpis, topItems, outcomes, byCountry };
};

export default function AnalyticsPage() {
  return (
    <SettingsLayout activeTab="analytics">
      <section className="returbo-card" style={{ maxWidth: 720, margin: "56px auto", padding: "40px 32px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, marginBottom: 18, borderRadius: 12, background: "#fff1f4", color: "var(--returbo-pink)" }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3v18h18" />
            <path d="m19 9-5 5-4-4-3 3" />
            <path d="M16 9h3v3" />
          </svg>
        </div>
        <p style={{ margin: "0 0 8px", color: "var(--returbo-pink)", fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>
          In progress
        </p>
        <h1 style={{ margin: "0 0 10px", color: "var(--returbo-text-primary)", fontSize: 22, fontWeight: 700 }}>
          Analytics is under construction
        </h1>
        <p style={{ maxWidth: 460, margin: "0 auto", color: "var(--returbo-text-muted)", fontSize: 14, lineHeight: 1.6 }}>
          We’re improving the returns and exchange insights. The Analytics page will be available again once the updates are complete.
        </p>
      </section>
    </SettingsLayout>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
