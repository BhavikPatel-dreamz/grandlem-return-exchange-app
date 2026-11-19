import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { GrandLeMarHeader } from "../components/admin/GrandLeMarHeader";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function DashboardPage() {
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
                Inspection, analytics, email templates, and policies.
              </p>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
