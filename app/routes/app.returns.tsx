/* eslint-disable @typescript-eslint/no-explicit-any */
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { GrandLeMarHeader } from "../components/admin/GrandLeMarHeader";
import { getOrCreateSettings } from "../services/settings.server";

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
  const market = url.searchParams.get("market")?.trim() || "";
  const lang = "en";

  const where: any = { shop };
  if (status) {
    if (status === "requests" || status === "Submitted") {
      where.status = { in: ["Submitted", "Pending Approval"] };
    } else if (status === "incoming" || status === "Received") {
      where.status = { in: ["Label Created", "Received"] };
    } else if (status === "pending_approval" || status === "Pending Approval") {
      where.status = "Pending Approval";
    } else if (status === "resolved" || status === "Completed" || status === "Approved") {
      where.status = { in: ["Approved", "Completed"] };
    } else if (status === "archived" || status === "Rejected") {
      where.status = "Rejected";
    } else {
      where.status = status;
    }
  }
  if (type) where.type = type;
  if (market) where.market = market;
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

  const settings = await getOrCreateSettings(shop);
  const warehouseMarkets = Object.keys(settings.warehouseAddressesPerMarket || {}).filter(
    (m) => m && m !== "DEFAULT"
  );

  return { shop, requests, carriers, lang, filters: { q, status, type, carrier, flagged, dateFrom, dateTo, market }, warehouseMarkets };
};

function EmptyReturnsIllustration() {
  return (
    <svg width="180" height="130" viewBox="0 0 180 130" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Top pink/red sparkle */}
      <path d="M72 10C72 15 76 17 80 17C76 17 72 19 72 24C72 19 68 17 64 17C68 17 72 15 72 10Z" fill="#DE4066" />

      {/* Right gray sparkle */}
      <path d="M152 46C152 50 155 52 159 52C155 52 152 54 152 58C152 54 149 52 145 52C149 52 152 50 152 46Z" stroke="#64748B" strokeWidth="1.5" strokeLinejoin="round" />

      {/* Bottom gray sparkle */}
      <path d="M80 112C80 115 82.5 117 86 117C82.5 117 80 119 80 122C80 119 77.5 117 74 117C77.5 117 80 115 80 112Z" stroke="#64748B" strokeWidth="1.5" strokeLinejoin="round" />

      {/* Back folder tab */}
      <path d="M68 28H122C124.2 28 126 29.8 126 32V50" stroke="#1E293B" strokeWidth="1.75" strokeLinecap="round" />

      {/* Main Folder outline */}
      <rect x="42" y="38" width="86" height="58" rx="6" stroke="#1E293B" strokeWidth="1.75" fill="#FFFFFF" />

      {/* Folder inner card / stamp */}
      <rect x="52" y="48" width="22" height="16" rx="2" stroke="#64748B" strokeWidth="1.5" fill="none" />
      <line x1="52" y1="72" x2="80" y2="72" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="52" y1="79" x2="68" y2="79" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />

      {/* Magnifying glass handle */}
      <line x1="130" y1="94" x2="152" y2="114" stroke="#DE4066" strokeWidth="6.5" strokeLinecap="round" />

      {/* Magnifying glass circle with white 0 */}
      <circle cx="112" cy="76" r="23" fill="#DE4066" stroke="#FFFFFF" strokeWidth="4" />
      <text x="112" y="83" textAnchor="middle" fill="#FFFFFF" fontSize="18" fontWeight="800" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">0</text>
    </svg>
  );
}

export default function ReturnsListPage() {
  const data = useLoaderData<typeof loader>();
  const currentStatus = data.filters.status || "";
  const dateLocale = "en-GB";
  const formatDate = (date: string | Date) => new Intl.DateTimeFormat(dateLocale).format(new Date(date));

  const pills = [
    { label: "All", value: "" },
    { label: "Requests", value: "requests" },
    { label: "Incoming", value: "incoming" },
    { label: "Pending approval", value: "pending_approval" },
    { label: "Resolved", value: "resolved" },
    { label: "Archived", value: "archived" },
  ];

  const isPillActive = (val: string) => {
    if (!val && (!currentStatus || currentStatus === "all")) return true;
    if (val === currentStatus) return true;
    if (val === "requests" && (currentStatus === "Submitted" || currentStatus === "requests")) return true;
    if (val === "incoming" && (currentStatus === "Received" || currentStatus === "incoming")) return true;
    if (val === "pending_approval" && (currentStatus === "Pending Approval" || currentStatus === "pending_approval")) return true;
    if (val === "resolved" && (currentStatus === "Completed" || currentStatus === "Approved" || currentStatus === "resolved")) return true;
    if (val === "archived" && (currentStatus === "Rejected" || currentStatus === "archived")) return true;
    return false;
  };

  const handleExport = () => {
    if (!data.requests.length) return;
    const headers = ["Order Number", "Date", "Customer Email", "Type", "Status", "Tracking"];
    const rows = data.requests.map((r: any) => [
      r.orderNumber || r.shopifyOrderId || "",
      r.submittedAt ? formatDate(r.submittedAt) : "",
      r.customerEmail || "",
      r.type || "",
      r.status || "",
      r.label?.trackingNumber || "",
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers, ...rows]
        .map((e) => e.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `returns-export-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--returbo-bg, #f6f6f7)" }}>
      <GrandLeMarHeader activeSection="returns" />
      <main className="returbo-returns-page-main">
        {/* Controls row matching reference image */}
        <div className="returbo-returns-controls">
          <div className="returbo-filter-pills">
            {pills.map((pill) => {
              const active = isPillActive(pill.value);
              const qParam = data.filters.q ? `&q=${encodeURIComponent(data.filters.q)}` : "";
              const href = pill.value ? `?status=${pill.value}${qParam}` : `?${qParam.slice(1)}`;
              return (
                <Link
                  key={pill.label}
                  to={href}
                  className={`returbo-pill ${active ? "active" : ""}`}
                >
                  {pill.label}
                </Link>
              );
            })}
          </div>

          <div className="returbo-actions-right">
            <button
              type="button"
              onClick={handleExport}
              className="returbo-export-btn"
              title="Export CSV"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>

            <Form method="get" className="returbo-search-form">
              {data.filters.status && <input type="hidden" name="status" value={data.filters.status} />}
              <div className="returbo-search-wrap">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  name="q"
                  defaultValue={data.filters.q}
                  placeholder="Search orders, customers, or tracking"
                  className="returbo-search-input"
                />
              </div>
            </Form>
          </div>
        </div>

        {/* Content: Empty State vs Requests Table */}
        {data.requests.length === 0 ? (
          <div className="returbo-empty-state-box">
            <div className="returbo-empty-illustration-wrap">
              <EmptyReturnsIllustration />
            </div>
            <h2 className="returbo-empty-title">No return requests to show yet</h2>
            <p className="returbo-empty-subtitle">
              Make sure you have added the link to the return form to your store so customers can access it.
            </p>
            <Link to="/app/settings" className="returbo-setup-btn">
              <span>Set up returns</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          </div>
        ) : (
          <div className="returbo-table-card">
            <div className="returbo-table-header-row">
              <span className="returbo-table-count">
                {data.requests.length} {data.requests.length === 1 ? "request" : "requests"}
              </span>
            </div>
            <div className="returbo-table-responsive">
              <table className="returbo-requests-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Items</th>
                    <th>Tracking</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.requests.map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/app/returns/${r.id}`} className="returbo-order-link">
                          {r.orderNumber || r.shopifyOrderId}
                        </Link>
                        {r.reviewFlagged && (
                          <span title="Review Flagged" style={{ color: "#d97706", fontWeight: 700, marginLeft: 6 }}>
                            ⚠
                          </span>
                        )}
                        {r.isWithdrawal && (
                          <span className="returbo-badge returbo-badge-yellow" style={{ marginLeft: 6 }}>
                            Withdrawal
                          </span>
                        )}
                      </td>
                      <td>{r.submittedAt ? formatDate(r.submittedAt) : "—"}</td>
                      <td>{r.customerEmail || r.customerName || "—"}</td>
                      <td>
                        <span className="returbo-badge returbo-badge-gray">{r.type}</span>
                      </td>
                      <td>
                        <span className="returbo-badge returbo-badge-pink">{r.status}</span>
                      </td>
                      <td>{r.items?.length ?? 1}</td>
                      <td>
                        {r.label?.trackingNumber ? (
                          <span className="returbo-tracking-pill">{r.label.trackingNumber}</span>
                        ) : (
                          <span style={{ color: "#9ca3af" }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link to={`/app/returns/${r.id}`} className="returbo-view-link">
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
