/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { saveInspection } from "../services/inspection.server";
import { SettingsLayout } from "../components/admin/SettingsLayout";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  const requests = await prisma.returnRequest.findMany({
    where: {
      shop,
      status: { in: ["In Transit", "Received"] },
    },
    include: {
      items: { include: { reason: true, photos: true, inspection: true } },
      label: true,
    },
    orderBy: { submittedAt: "desc" },
  });

  const filtered = q
    ? requests.filter((rr) => {
        const haystack = [
          rr.orderNumber || "",
          rr.shopifyOrderId || "",
          rr.label?.trackingNumber || "",
          ...rr.items.map((it) => `${it.title || ""} ${it.productId || ""} ${it.variantId || ""}`),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
    : requests;

  return { shop, q, requests: filtered };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("_action") || "");

  try {
    if (intent === "save_inspection") {
      const requestId = String(formData.get("requestId") || "");
      const rr = await prisma.returnRequest.findFirst({
        where: { id: requestId, shop },
        include: { items: true },
      });
      if (!rr) throw new Error("Request not found");

      const inspections = rr.items.map((it) => ({
        returnItemId: it.id,
        condition: String(formData.get(`condition_${it.id}`) || "OK") as "OK" | "DAMAGED" | "WRONG_ITEM" | "MISSING",
        approvedQuantity: Number(formData.get(`approvedQty_${it.id}`) || it.returnedQuantity || it.quantity),
        note: String(formData.get(`note_${it.id}`) || ""),
        restock: formData.get(`restock_${it.id}`) === "on",
      }));

      const result = await saveInspection(shop, requestId, inspections);
      if (!result.ok) throw new Error(result.error || "Inspection save failed");
      return { ok: true, message: "Inspection saved" };
    }

    if (intent === "mark_received") {
      const requestId = String(formData.get("requestId") || "");
      await prisma.returnRequest.update({ where: { id: requestId }, data: { status: "Received" } });
      return { ok: true, message: "Marked received" };
    }

    return { ok: false, message: "Unknown action" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error" };
  }
};

export default function InspectionPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <SettingsLayout activeTab="inspection">
      {actionData?.message && <div className="returbo-banner">{actionData.message}</div>}

      <div className="returbo-card">
        <div className="returbo-card-header">
          <h2 className="returbo-card-title">Warehouse Inspection</h2>
          <p className="returbo-card-subtitle">Search by order number, tracking number, or item SKU to inspect returned merchandise.</p>
        </div>
        <Form method="get">
          <s-stack direction="inline" gap="base">
            <s-text-field name="q" label="Scan or type" value={data.q} />
            <div>
              <s-button type="submit" variant="primary">Search</s-button>
            </div>
          </s-stack>
        </Form>
      </div>

      {data.requests.length === 0 && (
        <div className="returbo-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <p style={{ margin: 0, color: "var(--returbo-text-muted)", fontSize: 14 }}>
            No requests awaiting inspection.
          </p>
        </div>
      )}

      {data.requests.map((rr: any) => (
        <div key={rr.id} className="returbo-card">
          <div className="returbo-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 className="returbo-card-title">Order {rr.orderNumber || rr.id}</h2>
              <p className="returbo-card-subtitle">
                Customer: {rr.customerEmail || "N/A"} &bull; Tracking: {rr.label?.trackingNumber || "N/A"}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`returbo-badge ${rr.status === "Received" ? "returbo-badge-green" : "returbo-badge-yellow"}`}>
                {rr.status}
              </span>
              <Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="_action" value="mark_received" />
                <input type="hidden" name="requestId" value={rr.id} />
                <s-button type="submit" variant="tertiary">Mark received</s-button>
              </Form>
            </div>
          </div>

          <Form method="post">
            <input type="hidden" name="_action" value="save_inspection" />
            <input type="hidden" name="requestId" value={rr.id} />
            <s-stack direction="block" gap="base">
              {rr.items.map((it: any) => {
                const insp = it.inspection;
                return (
                  <div key={it.id} style={{ border: "1px solid var(--returbo-border)", borderRadius: "var(--returbo-radius-md)", padding: 16, backgroundColor: "#fafafa" }}>
                    <p style={{ margin: "0 0 10px 0", fontWeight: 600 }}>
                      {it.title} <span className="returbo-badge returbo-badge-gray">x{it.returnedQuantity || it.quantity}</span>
                    </p>
                    <s-stack direction="block" gap="base">
                      <s-select name={`condition_${it.id}`} label="Condition" value={insp?.condition || "OK"}>
                        <s-option value="OK">OK</s-option>
                        <s-option value="DAMAGED">Damaged</s-option>
                        <s-option value="WRONG_ITEM">Wrong item</s-option>
                        <s-option value="MISSING">Missing</s-option>
                      </s-select>
                      <s-number-field
                        name={`approvedQty_${it.id}`}
                        label="Approved quantity"
                        value={String(insp?.approvedQuantity ?? it.returnedQuantity ?? it.quantity)}
                      />
                      <s-text-field name={`note_${it.id}`} label="Note" value={insp?.note || ""} />
                      {rr.type !== "complaint" && (
                        <s-checkbox
                          name={`restock_${it.id}`}
                          label="Restock if condition is OK"
                          defaultChecked={Boolean(it.restocked)}
                        />
                      )}
                    </s-stack>
                  </div>
                );
              })}
              <div style={{ marginTop: 8 }}>
                <s-button type="submit" variant="primary">Save inspection</s-button>
              </div>
            </s-stack>
          </Form>
        </div>
      ))}

      <div style={{ marginTop: 16 }}>
        <Link to="/app/returns" style={{ color: "var(--returbo-pink)", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
          &larr; Back to returns
        </Link>
      </div>
    </SettingsLayout>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);