/* eslint-disable @typescript-eslint/no-explicit-any */
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SettingsLayout } from "../components/admin/SettingsLayout";
import {
  getKpis,
  getTopReturnedItems,
  getExchangeOutcomes,
  getReturnsByCountry,
} from "../services/analytics/analytics.server";
import KpiCard from "../components/admin/analytics/KpiCard";
import TopReturnedItems from "../components/admin/analytics/TopReturnedItems";
import ExchangeOutcomes from "../components/admin/analytics/ExchangeOutcomes";
import ReturnsByCountry from "../components/admin/analytics/ReturnsByCountry";

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

function compactMinor(minor: number) {
  const major = minor / 100;
  if (Math.abs(major) >= 1000) return `${Math.round(major / 1000)}k`;
  return Math.round(major).toString();
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
  const data = useLoaderData<typeof loader>();
  const k = data.kpis;

  const returnRateTrendGood = k.returnRateTrend <= 0;
  const exchangeRateTrendGood = k.exchangeRateTrend >= 0;
  const revenueTrendGood = k.revenueRecoveredTrendMinor >= 0;
  const totalReturnsTrendGood = k.totalReturnsTrend <= 0;

  return (
    <SettingsLayout activeTab="analytics">
      <div className="returbo-card">
        <div className="returbo-card-header">
          <h2 className="returbo-card-title">Analytics Filters</h2>
          <p className="returbo-card-subtitle">Filter returns, exchanges, and revenue recovery metrics by timeframe and market.</p>
        </div>
        <Form method="get">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <s-select name="range" label="Date range" value={data.range}>
              <s-option value="7">Last 7 days</s-option>
              <s-option value="30">Last 30 days</s-option>
              <s-option value="90">Last 90 days</s-option>
              <s-option value="custom">Custom</s-option>
            </s-select>
            <s-select name="market" label="Market" value={data.market}>
              <s-option value="ALL">All</s-option>
              <s-option value="SE">SE</s-option>
              <s-option value="GB">GB</s-option>
              <s-option value="US">US</s-option>
              <s-option value="EU">EU</s-option>
            </s-select>
            <s-text-field name="from" label="From" value={data.from.slice(0, 10)} />
            <s-text-field name="to" label="To" value={data.to.slice(0, 10)} />
            <div>
              <s-button type="submit" variant="primary">Apply</s-button>
            </div>
          </div>
        </Form>
      </div>

      <div className="returbo-kpi-grid">
        <KpiCard label="Return rate" value={`${k.returnRate}%`} trend={`${k.returnRateTrend > 0 ? "↑" : "↓"} ${k.returnRateTrend.toFixed(1)} pts vs prev`} good={returnRateTrendGood} />
        <KpiCard label="Exchange rate" value={`${k.exchangeRate}%`} trend={`${k.exchangeRateTrend > 0 ? "↑" : "↓"} ${k.exchangeRateTrend.toFixed(1)} pts vs prev`} good={exchangeRateTrendGood} highlight />
        <KpiCard label="Revenue recovered" value={`${compactMinor(k.revenueRecoveredMinor)} kr`} trend={`${k.revenueRecoveredTrendMinor >= 0 ? "+" : ""}${compactMinor(k.revenueRecoveredTrendMinor)} kr`} good={revenueTrendGood} />
        <KpiCard label="Total returns" value={`${k.totalReturns}`} trend={`${k.totalReturnsTrend >= 0 ? "+" : ""}${k.totalReturnsTrend}`} good={totalReturnsTrendGood} />
      </div>

      <div style={{ marginBottom: 20 }}>
        <TopReturnedItems items={data.topItems} periodLabel={data.periodLabel} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <ExchangeOutcomes items={data.outcomes} />
        <ReturnsByCountry items={data.byCountry} />
      </div>
    </SettingsLayout>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
