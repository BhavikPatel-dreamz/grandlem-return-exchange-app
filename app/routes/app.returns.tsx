/* eslint-disable @typescript-eslint/no-explicit-any */
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { GrandLeMarHeader } from "../components/admin/GrandLeMarHeader";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const status = url.searchParams.get("status")?.trim() || "";
  const type = url.searchParams.get("type")?.trim() || "";
  const carrier = url.searchParams.get("carrier")?.trim() || "";
  const flagged = url.searchParams.get("flagged")?.trim() || "";
  const dateFrom = url.searchParams.get("dateFrom")?.trim() || "";
  const dateTo = url.searchParams.get("dateTo")?.trim() || "";

  const where: any = { shop };
  if (status) where.status = status;
  if (type) where.type = type;
  if (carrier) where.carrierId = carrier;
  if (flagged === "1") where.reviewFlagged = true;
  if (dateFrom || dateTo) {
    where.submittedAt = {};
    if (dateFrom) where.submittedAt.gte = new Date(dateFrom);
    if (dateTo) where.submittedAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }
  if (q) {
    where.OR = [
      { orderNumber: { contains: q } },
      { customerEmail: { contains: q } },
      { customerName: { contains: q } },
      { shopifyOrderId: { contains: q } },
    ];
  }

  const requests = await prisma.returnRequest.findMany({
    where,
    include: { label: true, items: true },
    orderBy: { submittedAt: "desc" },
    take: 100,
  });

  const carriers = await prisma.carrier.findMany({ where: { shop } });

  return { shop, requests, carriers, filters: { q, status, type, carrier, flagged, dateFrom, dateTo } };
};

export default function ReturnsListPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--returbo-bg, #f6f6f7)" }}>
      <GrandLeMarHeader activeSection="returns" />
      <main className="returbo-container returbo-returns-container">
        <div className="returbo-card returbo-returns-filter-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">Return Requests</h2>
            <p className="returbo-card-subtitle">Filter, search, and manage customer returns, exchanges, and warranty complaints.</p>
          </div>
          <Form method="get" className="returbo-returns-filter-form">
            <div className="returbo-returns-search">
              <s-text-field name="q" label="Search orders, customers, or tracking" value={data.filters.q} />
            </div>
            <s-select name="status" label="Status" value={data.filters.status}>
              <s-option value="">All</s-option>
              <s-option value="Submitted">Submitted</s-option>
              <s-option value="Pending Approval">Pending Approval</s-option>
              <s-option value="Approved">Approved</s-option>
              <s-option value="Label Created">Label Created</s-option>
              <s-option value="Rejected">Rejected</s-option>
              <s-option value="Received">Received</s-option>
              <s-option value="Completed">Completed</s-option>
            </s-select>
            <s-select name="type" label="Type" value={data.filters.type}>
              <s-option value="">All</s-option>
              <s-option value="return">Return</s-option>
              <s-option value="exchange">Exchange</s-option>
              <s-option value="complaint">Complaint</s-option>
            </s-select>
            <s-date-field name="dateFrom" label="From date" value={data.filters.dateFrom} />
            <s-date-field name="dateTo" label="To date" value={data.filters.dateTo} />
            <div className="returbo-returns-filter-actions">
              <s-checkbox name="flagged" value="1" label="Flagged only" defaultChecked={data.filters.flagged === "1"} />
              <div>
                <s-button type="submit" variant="primary">Apply filters</s-button>
              </div>
            </div>
          </Form>
        </div>

        <div className="returbo-card returbo-returns-list-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">Requests ({data.requests.length})</h2>
          </div>
          {data.requests.length === 0 ? (
            <p style={{ color: "var(--returbo-text-muted)", fontSize: 13, margin: "12px 0" }}>
              No return requests found matching criteria.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.requests.map((r: any) => (
                <div key={r.id} className="returbo-list-item" style={{ alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {r.reviewFlagged && <span title="Review Flagged" style={{ color: "#d97706", fontWeight: 700 }}>⚠</span>}
                    {r.isWithdrawal && <span className="returbo-badge returbo-badge-yellow">Withdrawal</span>}
                    <Link
                      to={`/app/returns/${r.id}`}
                      style={{ fontWeight: 600, color: "var(--returbo-pink)", textDecoration: "none" }}
                    >
                      {r.orderNumber || r.shopifyOrderId}
                    </Link>
                    <span className="returbo-badge returbo-badge-gray">{r.type}</span>
                    <span className="returbo-badge returbo-badge-pink">{r.status}</span>
                    <span style={{ fontSize: 13, color: "var(--returbo-text-secondary)" }}>{r.customerEmail || ""}</span>
                  </div>
                  <div>
                    {r.label?.trackingNumber ? (
                      <span className="returbo-badge returbo-badge-blue">Tracking: {r.label.trackingNumber}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
