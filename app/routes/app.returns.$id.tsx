/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { createReturnLabel } from "../services/shippypro.server";
import { applyReplacementVariants, createExchangePaymentLink, markExchangePaid } from "../services/exchanges.server";
import { sendEventEmail } from "../services/email.server";
import { autoRestockForRequest, performRestock } from "../services/restock.server";
import { issueRefund } from "../services/refunds.server";
import { createReplacementOrder } from "../services/replacement.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = params.id!;
  const rr = await prisma.returnRequest.findFirst({
    where: { id, shop },
    include: { items: { include: { photos: true, reason: true } }, label: { include: { events: true } }, refunds: true },
  });
  if (!rr) throw new Response("Not found", { status: 404 });
  return { rr };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = params.id!;
  const rr = await prisma.returnRequest.findFirst({ where: { id, shop }, include: { items: true, label: true } });
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
      await autoRestockForRequest(id).catch(() => null);
      const updated = await prisma.returnRequest.findUnique({ where: { id }, include: { label: true } });
      await sendEventEmail(shop, "approved", "en", rr.customerEmail || "", {
        customerName: rr.customerEmail || "customer",
        orderNumber: rr.orderNumber,
        labelLink: updated?.label?.labelUrl || "",
        trackingLink: updated?.label?.trackingUrl || "",
      }).catch(() => null);
      return { ok: true, message: "Request approved" };
    }
    if (intent === "reject") {
      const reason = String(formData.get("rejectionReason") || "").trim();
      await prisma.returnRequest.update({
        where: { id },
        data: { status: "Rejected", rejectedAt: new Date(), rejectionReason: reason },
      });
      await sendEventEmail(shop, "rejected", "en", rr.customerEmail || "", {
        customerName: rr.customerEmail || "customer",
        orderNumber: rr.orderNumber,
        reason,
      }).catch(() => null);
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
        data: { restockDecision: decision },
      });
      if (restocked) {
        const result = await performRestock(shop, itemId);
        if (!result.ok) return { ok: false, message: result.error || "Restock failed" };
      } else {
        await prisma.returnItem.update({ where: { id: itemId }, data: { restocked: false, restockedAt: null } });
      }
      return { ok: true, message: "Restock updated" };
    }
    if (intent === "exchange_set_replacements") {
      const items = rr.items;
      const reps = items.map((it: any) => ({
        returnItemId: it.id,
        replacementVariantId: String(formData.get(`replacement_${it.id}`) || "").trim(),
      })).filter((r: any) => r.replacementVariantId);
      const total = await applyReplacementVariants(id, reps);
      return { ok: true, message: `Replacements saved. Price difference total: ${total.toFixed(2)}` };
    }
    if (intent === "exchange_payment_link") {
      const result = await createExchangePaymentLink(shop, id, rr.customerEmail);
      if (result.required) {
        await sendEventEmail(shop, "payment_required", "en", rr.customerEmail || "", {
          customerName: rr.customerEmail || "customer",
          orderNumber: rr.orderNumber,
          amount: result.total.toFixed(2),
          paymentLink: result.invoiceUrl || "",
        }).catch(() => null);
      }
      if (!result.required) {
        await prisma.returnRequest.update({ where: { id }, data: { status: "Approved" } }).catch(() => null);
        return { ok: true, message: `No price difference (${result.total.toFixed(2)}). Exchange approved.` };
      }
      return { ok: true, message: `Payment link created: ${result.invoiceUrl}` };
    }
    if (intent === "exchange_mark_paid") {
      await markExchangePaid(id);
      return { ok: true, message: "Exchange marked as paid" };
    }
    if (intent === "status_update") {
      const status = String(formData.get("status") || rr.status);
      await prisma.returnRequest.update({ where: { id }, data: { status } });
      return { ok: true, message: "Status updated" };
    }
    if (intent === "set_resolution") {
      const resolution = String(formData.get("requestedResolution") || "").trim();
      await prisma.returnRequest.update({ where: { id }, data: { requestedResolution: resolution || null } });
      return { ok: true, message: "Resolution updated" };
    }
    if (intent === "create_replacement") {
      const result = await createReplacementOrder(shop, id);
      if (!result.ok) return { ok: false, message: result.error || "Replacement failed" };
      return { ok: true, message: `Replacement order created: ${result.orderId}` };
    }
    if (intent === "issue_refund") {
      const amountRaw = String(formData.get("refundAmount") || "").trim();
      const amount = amountRaw ? Number(amountRaw) : undefined;
      const note = String(formData.get("refundNote") || "").trim();
      const result = await issueRefund(shop, id, amount, note);
      if (!result.ok) return { ok: false, message: result.error || "Refund failed" };
      return { ok: true, message: `Refund issued: ${result.amount}` };
    }
    return { ok: false, message: "Unknown action" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error" };
  }
};

export default function ReturnDetailPage() {
  const { rr } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading={`Return ${rr.orderNumber || rr.id}`}>
      {actionData?.message && <s-banner>{actionData.message}</s-banner>}

      <s-section heading="Summary">
        <s-paragraph>Type: {rr.type}{rr.isWithdrawal ? " (Withdrawal)" : ""}</s-paragraph>
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
                <s-select name="restockDecision" value={it.restockDecision || "pending"}>
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

      {rr.type === "exchange" && (
        <s-section heading="Exchange">
          <Form method="post">
            <input type="hidden" name="_action" value="exchange_set_replacements" />
            <s-stack direction="block" gap="base">
              {rr.items.map((it: any) => (
                <s-box key={it.id} padding="base" borderWidth="base" borderRadius="base">
                  <s-paragraph>{it.title} x{it.returnedQuantity}</s-paragraph>
                  <s-text-field name={`replacement_${it.id}`} label="Replacement variant ID (GID/numeric)" value={it.replacementVariantId || ""} />
                  {it.priceDifferenceStr && <s-paragraph>Price difference: {it.priceDifferenceStr}</s-paragraph>}
                </s-box>
              ))}
              <s-button type="submit">Save replacements</s-button>
            </s-stack>
          </Form>
          <Form method="post">
            <input type="hidden" name="_action" value="exchange_payment_link" />
            <s-button type="submit">Create payment link / approve</s-button>
          </Form>
          {rr.status === "Awaiting Payment" && (
            <Form method="post">
              <input type="hidden" name="_action" value="exchange_mark_paid" />
              <s-button type="submit">Mark as paid</s-button>
            </Form>
          )}
        </s-section>
      )}

      <s-section heading="Resolution">
        <Form method="post">
          <input type="hidden" name="_action" value="set_resolution" />
          <s-stack direction="inline" gap="base">
            <s-select name="requestedResolution" label="Requested resolution" value={rr.requestedResolution || "refund"}>
              <s-option value="refund">Refund</s-option>
              <s-option value="store_credit">Store credit</s-option>
              <s-option value="exchange">Exchange</s-option>
            </s-select>
            <s-button type="submit">Save resolution</s-button>
          </s-stack>
        </Form>
        {rr.storeCreditIssuedAt && <s-paragraph>Store credit issued: {rr.storeCreditAmount} on {new Date(rr.storeCreditIssuedAt).toLocaleString()}</s-paragraph>}
        {rr.replacementOrderId && <s-paragraph>Replacement order: {rr.replacementOrderId}</s-paragraph>}
        <Form method="post" style={{ marginTop: 8 }}>
          <input type="hidden" name="_action" value="create_replacement" />
          <s-button type="submit">Create replacement order</s-button>
        </Form>
      </s-section>

      <s-section heading="Refunds">
        <s-unordered-list>
          {rr.refunds?.map((r: any) => (
            <s-list-item key={r.id}>
              {r.status} – {r.amount} {r.currency} {r.shopifyRefundId ? `(${r.shopifyRefundId})` : ""} {r.note ? `– ${r.note}` : ""} {r.errorMessage ? `– error: ${r.errorMessage}` : ""}
            </s-list-item>
          ))}
          {(!rr.refunds || rr.refunds.length === 0) && <s-paragraph>No refunds issued.</s-paragraph>}
        </s-unordered-list>
        <Form method="post">
          <input type="hidden" name="_action" value="issue_refund" />
          <s-stack direction="block" gap="base">
            <s-text-field name="refundAmount" label="Refund amount (leave blank for full calculated)" />
            <s-text-field name="refundNote" label="Note (required if lowering amount)" />
            <s-button type="submit">Issue refund</s-button>
          </s-stack>
        </Form>
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
            <s-option value="Inspected">Inspected</s-option>
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
