/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { GrandLeMarHeader } from "../components/admin/GrandLeMarHeader";
import { getOrCreateSettings } from "../services/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
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
  const fulfillmentLocation = url.searchParams.get("fulfillmentLocation")?.trim() || "";
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
  if (carrier) {
    where.AND = [{ OR: [{ carrierId: carrier }, { label: { is: { carrierId: carrier } } }] }];
  }
  if (fulfillmentLocation) where.fulfillmentLocationId = fulfillmentLocation;
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
    include: { label: true, items: { include: { reason: true } } },
    orderBy: { submittedAt: "desc" },
    take: 500,
  });

  const carriers = await prisma.carrier.findMany({ where: { shop } });

  const settings = await getOrCreateSettings(shop);
  const warehouseMarkets = Object.keys(settings.warehouseAddressesPerMarket || {}).filter(
    (m) => m && m !== "DEFAULT"
  );

  const fulfillmentLocationIds = Array.from(
    new Set(requests.map((r: any) => r.fulfillmentLocationId).filter(Boolean))
  );
  let fulfillmentLocations: { id: string; label: string }[] = [];
  try {
    const locationResponse = await admin.graphql(`#graphql
      query returnsFulfillmentLocations {
        locations(first: 250) {
          edges {
            node {
              id
              name
              address { formatted }
            }
          }
        }
      }
    `);
    const locationData = await locationResponse.json();
    fulfillmentLocations = (locationData?.data?.locations?.edges ?? []).map(({ node }: any) => ({
      id: node.id,
      label: node.address?.formatted?.filter(Boolean).join(", ") || node.name || node.id,
    }));
  } catch {
    // Keep the filter usable with saved IDs if Shopify location details are unavailable.
  }
  const knownLocationIds = new Set(fulfillmentLocations.map((location) => location.id));
  for (const id of fulfillmentLocationIds) {
    if (!knownLocationIds.has(id)) fulfillmentLocations.push({ id, label: id });
  }

  return { shop, requests, carriers, lang, filters: { q, status, type, carrier, flagged, dateFrom, dateTo, market, fulfillmentLocation }, warehouseMarkets, fulfillmentLocations };
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

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const totalRequests = data.requests.length;
  const totalPages = Math.max(1, Math.ceil(totalRequests / pageSize));

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [data.filters]);

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRequests);
  const paginatedRequests = data.requests.slice(startIndex, endIndex);

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
    const headers = [
      "Request Number",
      "Order Number",
      "Shopify Order ID",
      "Submitted At",
      "Customer Name",
      "Customer Email",
      "Type",
      "Status",
      "Market",
      "Country",
      "Requested Resolution",
      "Final Resolution",
      "Carrier ID",
      "Tracking Number",
      "Tracking URL",
      "Review Flagged",
      "Rejection Reason",
      "Item Details",
    ];
    const rows = data.requests.map((r: any) => [
      r.requestNumber || "",
      r.orderNumber || r.shopifyOrderId || "",
      r.shopifyOrderId || "",
      r.submittedAt ? new Date(r.submittedAt).toISOString() : "",
      r.customerName || "",
      r.customerEmail || "",
      r.type || "",
      r.status || "",
      r.market || "",
      r.countryCode || "",
      r.requestedResolution || "",
      r.finalResolution || "",
      r.label?.carrierId || r.carrierId || "",
      r.label?.trackingNumber || "",
      r.label?.trackingUrl || "",
      r.reviewFlagged ? "Yes" : "No",
      r.rejectionReason || "",
      (r.items || []).map((item: any) => [
        item.title || "Item",
        `qty ${item.quantity}`,
        `returned ${item.returnedQuantity}`,
        `reason ${item.reason?.labelEn || item.reasonId || ""}`,
        `comment ${item.comment || ""}`,
        `resolution ${item.itemResolution || ""}`,
        `restocked ${item.restocked ? "yes" : "no"}`,
      ].join("; ")).join(" | "),
    ]);
    const csvCell = (value: unknown) => {
      let cell = String(value ?? "");
      if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
      return `"${cell.replace(/"/g, '""')}"`;
    };
    const csvContent = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const file = new Blob(["\uFEFF", csvContent], { type: "text/csv;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.setAttribute("href", downloadUrl);
    link.setAttribute("download", `returns-export-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
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
              const params = new URLSearchParams();
              for (const [key, value] of Object.entries({ ...data.filters, status: pill.value })) {
                if (value) params.set(key, value);
              }
              const href = `?${params.toString()}`;
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

            <Form method="get" className="returbo-search-filter-form">
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

              <div className={`returbo-filter-select-wrap ${data.filters.fulfillmentLocation ? "has-value" : ""}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <select
                  name="fulfillmentLocation"
                  defaultValue={data.filters.fulfillmentLocation}
                  className="returbo-filter-select"
                  onChange={(e) => { const form = e.currentTarget.closest('form'); form?.requestSubmit(); }}
                >
                  <option value="">All fulfillment locations</option>
                  {data.fulfillmentLocations.map((loc: { id: string; label: string }) => (
                    <option key={loc.id} value={loc.id}>{loc.label}</option>
                  ))}
                </select>
                <span className="returbo-filter-select-arrow">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </div>

              <div className={`returbo-filter-select-wrap ${data.filters.carrier ? "has-value" : ""}`}>
                <select
                  name="carrier"
                  aria-label="Filter by carrier"
                  defaultValue={data.filters.carrier}
                  className="returbo-filter-select"
                  onChange={(e) => { const form = e.currentTarget.closest('form'); form?.requestSubmit(); }}
                >
                  <option value="">All carriers</option>
                  {data.carriers.map((carrier: any) => (
                    <option key={carrier.id} value={carrier.id}>{carrier.name}</option>
                  ))}
                </select>
                <span className="returbo-filter-select-arrow">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </div>

              <div className="returbo-filter-date-wrap">
                <label htmlFor="returns-date-from">From</label>
                <input id="returns-date-from" type="date" name="dateFrom" defaultValue={data.filters.dateFrom} aria-label="Submitted from" onChange={(e) => { const form = e.currentTarget.closest('form'); form?.requestSubmit(); }} />
              </div>
              <div className="returbo-filter-date-wrap">
                <label htmlFor="returns-date-to">To</label>
                <input id="returns-date-to" type="date" name="dateTo" defaultValue={data.filters.dateTo} aria-label="Submitted to" onChange={(e) => { const form = e.currentTarget.closest('form'); form?.requestSubmit(); }} />
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
                  {paginatedRequests.map((r: any) => (
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

            {/* Pagination Controls (10 per page) */}
            {totalRequests > 0 && (
              <div className="returbo-table-pagination">
                <div className="returbo-pagination-info">
                  Showing <strong>{startIndex + 1}–{endIndex}</strong> of <strong>{totalRequests}</strong> {totalRequests === 1 ? "request" : "requests"}
                </div>

                <div className="returbo-pagination-controls">
                  <button
                    type="button"
                    className="returbo-pagination-btn"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                    <span>Previous</span>
                  </button>

                  <div className="returbo-pagination-pages">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
                      if (
                        totalPages <= 7 ||
                        pageNum === 1 ||
                        pageNum === totalPages ||
                        Math.abs(pageNum - currentPage) <= 1
                      ) {
                        const isActive = pageNum === currentPage;
                        return (
                          <button
                            key={pageNum}
                            type="button"
                            className={`returbo-pagination-page-btn ${isActive ? "active" : ""}`}
                            onClick={() => setCurrentPage(pageNum)}
                          >
                            {pageNum}
                          </button>
                        );
                      } else if (
                        (pageNum === 2 && currentPage > 3) ||
                        (pageNum === totalPages - 1 && currentPage < totalPages - 2)
                      ) {
                        return (
                          <span key={`ellipsis-${pageNum}`} className="returbo-pagination-ellipsis">
                            …
                          </span>
                        );
                      }
                      return null;
                    })}
                  </div>

                  <button
                    type="button"
                    className="returbo-pagination-btn"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Next page"
                  >
                    <span>Next</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
