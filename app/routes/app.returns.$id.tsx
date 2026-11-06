/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { createReturnLabel } from "../services/shippypro.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = params.id!;
  const rr = await prisma.returnRequest.findFirst({
    where: { id, shop },
    include: { items: { include: { photos: true, reason: true } }, label: { include: { events: true } } },
  });
  if (!rr) throw new Response("Not found", { status: 404 });
  const carriers = await prisma.carrier.findMany({ where: { shop } });
  return { rr, carriers, shop };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = params.id!;
  const rr = await prisma.returnRequest.findFirst({ where: { id, shop } });
  if (!rr) return { ok: false, message: "Request not found" };
  const formData = await request.formData();
  const intent = String(formData.get("_action") || "");

  try {
    if (intent === "approve") {
      await prisma.returnRequest.update({
        where: { id },
        data: { status: "Approved", approvedAt: new Date() },
      });
      if (!rr.label) await createReturnLabel(id).catch(() => null);
      return { ok: true, message: "Request approved" };
    }
    if (intent === "reject") {
      const reason = String(formData.get("rejectionReason") || "").trim();
      await prisma.returnRequest.update({
        where: { id },
        data: { status: "Rejected", rejectedAt: new Date(), rejectionReason: reason },
      });
      return { ok: true, message: "Request rejected" };
    }
    if (intent === "regenerate_label") {
      await createReturnLabel(id);
      return { ok: true, message: "Label regenerated" };
    }
    if (intent === "void_label") {
      if (rr.label) {
        await prisma.returnLabel.update({ where: { id: rr.label.id }, data: { status: "voided" } });
      }
      return { ok: true, message: "Label voided" };
    }
    if (intent === "restock_update") {
      const itemId = String(formData.get("itemId"));
      const decision = String(formData.get("restockDecision") || "pending");
      const restocked = formData.get("restocked") === "on";
      await prisma.returnItem.update({
        where: { id: itemId },
        data: { restockDecision: decision, restocked, restockedAt: restocked ? new Date() : null },
      });
      return { ok: true, message: "Restock updated" };
    }
    if (intent === "status_update") {
      const status = String(formData.get("status") || rr.status);
      await prisma.returnRequest.update({ where: { id }, data: { status } });
      return { ok: true, message: "Status updated" };
    }
    return { ok: false, message: "Unknown action" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error" };
  }
};

export default function ReturnDetailPage() {
  const { rr, carriers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading={`Return ${rr.orderNumber || rr.id}`}>
      {actionData?.message && <s-banner>{actionData.message}</s-banner>}

      <s-section heading="Summary">
        <s-paragraph>Type: {rr.type}</s-paragraph>
        <s-paragraph>Status: {rr.status}</s-paragraph>
        <s-paragraph>Customer: {rr.customerEmail}</s-paragraph>
        <s-paragraph>Order: {rr.shopifyOrderId}</s-paragraph>
        <s-paragraph>Submitted: {new Date(rr.submittedAt).toLocaleString()}</s-paragraph>
        {rr.reviewFlagged && <s-paragraph>⚠ Flagged for review</s-paragraph>}
      </s-section>

      <s-section heading="Items">
        <s-unordered-list>
          {rr.items.map((it: any) => (
            <s-list-item key={it.id}>
              {it.title} x{it.returnedQuantity} – reason: {it.reason?.labelEn || "n/a"}{" "}
              {it.comment ? `– comment: ${it.comment}` : ""}{" "}
              – restock: {it.restockDecision || "pending"} {it.restocked ? "(restocked)" : ""}
              <Form method="post" style={{ display: "inline", marginLeft: 8 }}>
                <input type="hidden" name="_action" value="restock_update" />
                <input type="hidden" name="itemId" value={it.id} />
                <s-select name="restockDecision" defaultValue={it.restockDecision || "pending"}>
                  <s-option value="auto">Auto</s-option>
                  <s-option value="manual">Manual</s-option>
                  <s-option value="no">No restock</s-option>
                  <s-option value="pending">Pending</s-option>
                </s-select>
                <s-checkbox name="restocked" label="Restocked" defaultChecked={it.restocked} />
                <s-button type="submit" variant="tertiary">Update restock</s-button>
              </Form>
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

      <s-section heading="Photos">
        <s-unordered-list>
          {rr.items.flatMap((it: any) => it.photos).map((p: any) => (
            <s-list-item key={p.id}>
              <s-link href={p.url} target="_blank">{p.fileName || "photo"}</s-link>
            </s-list-item>
          ))}
          {rr.items.flatMap((it: any) => it.photos).length === 0 && <s-paragraph>No photos.</s-paragraph>}
        </s-unordered-list>
      </s-section>

      <s-section heading="Label">
        {rr.label ? (
          <>
            <s-paragraph>Status: {rr.label.status}</s-paragraph>
            <s-paragraph>Carrier connection: {rr.label.connectionId}</s-paragraph>
            <s-paragraph>Tracking: {rr.label.trackingNumber}</s-paragraph>
            {rr.label.labelUrl && <s-link href={rr.label.labelUrl} target="_blank">Download label</s-link>}
            <Form method="post">
              <input type="hidden" name="_action" value="regenerate_label" />
              <s-button type="submit">Regenerate label</s-button>
            </Form>
            <Form method="post">
              <input type="hidden" name="_action" value="void_label" />
              <s-button type="submit" variant="tertiary">Void label</s-button>
            </Form>
          </>
        ) : (
          <Form method="post">
            <input type="hidden" name="_action" value="regenerate_label" />
            <s-button type="submit">Generate label</s-button>
          </Form>
        )}
      </s-section>

      <s-section heading="Actions">
        <Form method="post">
          <input type="hidden" name="_action" value="approve" />
          <s-button type="submit">Approve</s-button>
        </Form>
        <Form method="post">
          <input type="hidden" name="_action" value="reject" />
          <s-text-field name="rejectionReason" label="Rejection reason" />
          <s-button type="submit" tone="critical">Reject</s-button>
        </Form>
        <Form method="post">
          <input type="hidden" name="_action" value="status_update" />
          <s-select name="status" label="Set status">
            <s-option value="Submitted">Submitted</s-option>
            <s-option value="Pending Approval">Pending Approval</s-option>
            <s-option value="Approved">Approved</s-option>
            <s-option value="Label Created">Label Created</s-option>
            <s-option value="In Transit">In Transit</s-option>
            <s-option value="Received">Received</s-option>
            <s-option value="Completed">Completed</s-option>
          </s-select>
          <s-button type="submit">Update status</s-button>
        </Form>
      </s-section>

      <s-section heading="Tracking history">
        <s-unordered-list>
          {rr.label?.events?.map((ev: any) => (
            <s-list-item key={ev.id}>
              {new Date(ev.occurredAt).toLocaleString()} – {ev.status} {ev.message ? `– ${ev.message}` : ""}
            </s-list-item>
          ))}
          {(!rr.label?.events || rr.label.events.length === 0) && <s-paragraph>No tracking events.</s-paragraph>}
        </s-unordered-list>
      </s-section>

      <s-link href="/app/returns">← Back to returns</s-link>
    </s-page>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
