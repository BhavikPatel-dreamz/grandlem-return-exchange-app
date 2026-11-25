import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { GrandLeMarHeader } from "../components/admin/GrandLeMarHeader";
import { storefrontReturnsUrl } from "../services/storefront-links.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { returnsUrl: storefrontReturnsUrl(session.shop) };
};

export default function DashboardPage() {
  const { returnsUrl } = useLoaderData<typeof loader>();
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--returbo-bg, #f6f6f7)" }}>
      <GrandLeMarHeader activeSection="dashboard" />
      <main className="returbo-container">
        <div className="returbo-card">
          <div className="returbo-card-header">
            <h1 className="returbo-card-title" style={{ fontSize: 18 }}>Dashboard</h1>
            <p className="returbo-card-subtitle">Quick navigation to Grand Le Mar return management and configuration.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <Link
              to="/app/returns"
              className="returbo-card"
              style={{
                textDecoration: "none",
                color: "inherit",
                margin: 0,
                display: "block",
                borderLeft: "4px solid var(--returbo-pink)",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
              }}
            >
              <h3 style={{ margin: "0 0 6px 0", fontSize: 16, color: "var(--returbo-text-primary)" }}>Returns</h3>
              <p style={{ margin: 0, fontSize: 13, color: "var(--returbo-text-muted)" }}>
                View, approve, and process return requests.
              </p>
            </Link>

            <Link
              to="/app/settings"
              className="returbo-card"
              style={{
                textDecoration: "none",
                color: "inherit",
                margin: 0,
                display: "block",
                borderLeft: "4px solid #6366f1",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
              }}
            >
              <h3 style={{ margin: "0 0 6px 0", fontSize: 16, color: "var(--returbo-text-primary)" }}>Settings</h3>
              <p style={{ margin: 0, fontSize: 13, color: "var(--returbo-text-muted)" }}>
                Email templates and policies.
              </p>
            </Link>
          </div>
        </div>

        <div className="returbo-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">Customer returns page</h2>
            <p className="returbo-card-subtitle">
              Customers start returns on your store, inside your theme. Link to this address from your store.
            </p>
          </div>
          <p style={{ margin: "0 0 12px 0", wordBreak: "break-all" }}>
            <a href={returnsUrl} target="_blank" rel="noreferrer"><code>{returnsUrl}</code></a>
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--returbo-text-muted)", lineHeight: 1.6 }}>
            <li>Online Store › Navigation: add a “Returns” link to <code>/apps/returns</code> in the footer menu.</li>
            <li>Settings › Notifications: add the link to the shipping confirmation and order status emails.</li>
            <li>App emails: use <code>{"{{returnsUrl}}"}</code> in templates under Settings › Email templates.</li>
          </ul>
        </div>
      </main>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
