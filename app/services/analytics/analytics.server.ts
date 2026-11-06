/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../../db.server";

export type AnalyticsFilters = {
  shopId: string;
  from: Date;
  to: Date;
  marketCode?: string | null;
};

export type Kpis = {
  totalReturns: number;
  totalReturnsPrev: number;
  totalReturnsTrend: number;
  returnRate: number;
  returnRatePrev: number;
  returnRateTrend: number;
  exchangeRate: number;
  exchangeRatePrev: number;
  exchangeRateTrend: number;
  revenueRecoveredMinor: number;
  revenueRecoveredPrevMinor: number;
  revenueRecoveredTrendMinor: number;
  fulfilledOrders: number;
  fulfilledOrdersPrev: number;
};

function marketFilter(marketCode?: string | null) {
  if (!marketCode || marketCode === "ALL") return {};
  if (marketCode === "EU") return { countryCode: { notIn: ["SE", "GB", "US"], not: "" } };
  return { countryCode: marketCode };
}

function statMarketFilter(marketCode?: string | null) {
  if (!marketCode || marketCode === "ALL") return {};
  if (marketCode === "EU") return { marketCode: { notIn: ["SE", "GB", "US"], not: "" } };
  return { marketCode };
}

function shiftPeriod(from: Date, to: Date) {
  const length = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - length);
  return { prevFrom, prevTo };
}

function moneyToMinor(value: string | null) {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

async function computeKpis(filters: AnalyticsFilters, from: Date, to: Date): Promise<{
  totalReturns: number;
  exchangeRequests: number;
  returnedOrders: number;
  revenueRecoveredMinor: number;
  fulfilledOrders: number;
}> {
  const rrWhere: any = {
    shop: filters.shopId,
    submittedAt: { gte: from, lte: to },
    ...marketFilter(filters.marketCode),
  };

  const [totalReturns, exchangeRequests, distinctOrders, items, fulfilledAgg] = await Promise.all([
    prisma.returnRequest.count({ where: rrWhere }),
    prisma.returnRequest.count({ where: { ...rrWhere, type: "exchange" } }),
    prisma.returnRequest.groupBy({ by: ["shopifyOrderId"], where: rrWhere }),
    prisma.returnItem.findMany({
      where: { returnRequest: rrWhere },
      select: { priceDifferenceStr: true, returnRequest: { select: { type: true } } },
    }),
    prisma.dailyOrderStat.aggregate({
      where: { shop: filters.shopId, date: { gte: from, lte: to }, ...statMarketFilter(filters.marketCode) },
      _sum: { fulfilledOrders: true },
    }),
  ]);

  let revenueRecoveredMinor = 0;
  for (const it of items as any[]) {
    if (it.returnRequest?.type === "exchange") {
      revenueRecoveredMinor += Math.max(0, moneyToMinor(it.priceDifferenceStr));
    }
  }

  return {
    totalReturns,
    exchangeRequests,
    returnedOrders: (distinctOrders as any[]).length,
    revenueRecoveredMinor,
    fulfilledOrders: fulfilledAgg._sum.fulfilledOrders || 0,
  };
}

export async function getKpis(filters: AnalyticsFilters): Promise<Kpis> {
  const { prevFrom, prevTo } = shiftPeriod(filters.from, filters.to);
  const [cur, prev] = await Promise.all([
    computeKpis(filters, filters.from, filters.to),
    computeKpis(filters, prevFrom, prevTo),
  ]);

  const returnRate = cur.fulfilledOrders > 0 ? (cur.returnedOrders / cur.fulfilledOrders) * 100 : 0;
  const returnRatePrev = prev.fulfilledOrders > 0 ? (prev.returnedOrders / prev.fulfilledOrders) * 100 : 0;
  const exchangeRate = cur.totalReturns > 0 ? (cur.exchangeRequests / cur.totalReturns) * 100 : 0;
  const exchangeRatePrev = prev.totalReturns > 0 ? (prev.exchangeRequests / prev.totalReturns) * 100 : 0;

  return {
    totalReturns: cur.totalReturns,
    totalReturnsPrev: prev.totalReturns,
    totalReturnsTrend: cur.totalReturns - prev.totalReturns,
    returnRate: Number(returnRate.toFixed(1)),
    returnRatePrev: Number(returnRatePrev.toFixed(1)),
    returnRateTrend: Number((returnRate - returnRatePrev).toFixed(1)),
    exchangeRate: Number(exchangeRate.toFixed(1)),
    exchangeRatePrev: Number(exchangeRatePrev.toFixed(1)),
    exchangeRateTrend: Number((exchangeRate - exchangeRatePrev).toFixed(1)),
    revenueRecoveredMinor: cur.revenueRecoveredMinor,
    revenueRecoveredPrevMinor: prev.revenueRecoveredMinor,
    revenueRecoveredTrendMinor: cur.revenueRecoveredMinor - prev.revenueRecoveredMinor,
    fulfilledOrders: cur.fulfilledOrders,
    fulfilledOrdersPrev: prev.fulfilledOrders,
  };
}

export async function getTopReturnedItems(filters: AnalyticsFilters) {
  const rrWhere: any = {
    shop: filters.shopId,
    submittedAt: { gte: filters.from, lte: filters.to },
    ...marketFilter(filters.marketCode),
  };

  const groups = await prisma.returnItem.groupBy({
    by: ["productId", "title"],
    where: { returnRequest: rrWhere },
    _sum: { returnedQuantity: true },
    orderBy: { _sum: { returnedQuantity: "desc" } },
    take: 10,
  });

  const totalUnits = (groups as any[]).reduce((s, g) => s + (g._sum?.returnedQuantity || 0), 0) || 1;

  return (groups as any[]).map((g, idx) => {
    const qty = g._sum?.returnedQuantity || 0;
    return {
      productId: g.productId,
      productName: g.title || "Unknown product",
      quantity: qty,
      percentage: Number(((qty / totalUnits) * 100).toFixed(1)),
      colorIndex: idx,
    };
  });
}

export async function getExchangeOutcomes(filters: AnalyticsFilters) {
  const rrWhere: any = {
    shop: filters.shopId,
    submittedAt: { gte: filters.from, lte: filters.to },
    ...marketFilter(filters.marketCode),
    type: "exchange",
    outcome: { not: null },
  };
  const groups = await prisma.returnRequest.groupBy({
    by: ["outcome"],
    where: rrWhere,
    _count: { _all: true },
  });
  const total = (groups as any[]).reduce((s, g) => s + (g._count?._all || 0), 0) || 1;
  const labelMap: Record<string, string> = {
    REFUND: "Refunds",
    EXCHANGE_VARIANT: "New product variant",
    STORE_CREDIT: "Store credit",
  };
  return (groups as any[]).map((g) => {
    const count = g._count?._all || 0;
    return {
      outcome: g.outcome,
      label: labelMap[g.outcome] || g.outcome,
      count,
      percentage: Number(((count / total) * 100).toFixed(1)),
    };
  });
}

export async function getReturnsByCountry(filters: AnalyticsFilters) {
  const rrWhere: any = {
    shop: filters.shopId,
    submittedAt: { gte: filters.from, lte: filters.to },
    ...marketFilter(filters.marketCode),
  };
  const groups = await prisma.returnRequest.groupBy({
    by: ["countryCode"],
    where: rrWhere,
    _count: { _all: true },
    orderBy: { _count: { countryCode: "desc" } },
  });

  return (groups as any[])
    .filter((g) => g.countryCode)
    .sort((a, b) => (b._count?._all || 0) - (a._count?._all || 0))
    .slice(0, 5)
    .map((g) => ({
      country: g.countryCode,
      count: g._count?._all || 0,
    }));
}
