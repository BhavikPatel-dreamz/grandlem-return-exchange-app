/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { saveInspection } from "../services/inspection.server";

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
    <s-page heading="Warehouse inspection">
      {actionData?.message && <s-banner>{actionData.message}</s-banner>}

      <s-section heading="Search (order / tracking / SKU)">
        <Form method="get">
          <s-stack direction="inline" gap="base">
            <s-text-field name="q" label="Scan or type" value={data.q} />
            <s-button type="submit">Search</s-button>
          </s-stack>
        </Form>
      </s-section>

      {data.requests.length === 0 && <s-paragraph>No requests awaiting inspection.</s-paragraph>}

      {data.requests.map((rr: any) => (
        <s-section key={rr.id} heading={`Order ${rr.orderNumber || rr.id} – ${rr.status}`}>
          <s-paragraph>Customer: {rr.customerEmail}</s-paragraph>
          <s-paragraph>Tracking: {rr.label?.trackingNumber || "n/a"}</s-paragraph>

          <Form method="post" style={{ marginBottom: 8 }}>
            <input type="hidden" name="_action" value="mark_received" />
            <input type="hidden" name="requestId" value={rr.id} />
            <s-button type="submit" variant="tertiary">Mark received</s-button>
          </Form>

          <Form method="post">
            <input type="hidden" name="_action" value="save_inspection" />
            <input type="hidden" name="requestId" value={rr.id} />
            <s-stack direction="block" gap="base">
              {rr.items.map((it: any) => {
                const insp = it.inspection;
                return (
                  <s-box key={it.id} padding="base" borderWidth="base" borderRadius="base">
                    <s-paragraph>{it.title} x{it.returnedQuantity || it.quantity}</s-paragraph>
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
                    </s-stack>
                  </s-box>
                );
              })}
              <s-button type="submit">Save inspection</s-button>
            </s-stack>
          </Form>
        </s-section>
      ))}

      <s-link href="/app/returns">← Back to returns</s-link>
    </s-page>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);