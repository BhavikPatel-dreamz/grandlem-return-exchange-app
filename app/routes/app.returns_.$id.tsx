/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { GrandLeMarHeader } from "../components/admin/GrandLeMarHeader";
import { RETRYABLE_LABEL_STATUSES, confirmNoShipment, createReturnLabel, fetchWarehouseAddress, voidReturnLabel } from "../services/shippypro.server";
import { applyReplacementVariants, createExchangePaymentLink } from "../services/exchanges.server";
import { sendEventEmail } from "../services/email.server";
import { performRestock } from "../services/restock.server";
import { issueRefund } from "../services/refunds.server";
import { createReplacementOrder } from "../services/replacement.server";
import { decodeReason } from "../services/return-reasons.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const id = params.id!;
  const rr = await prisma.returnRequest.findFirst({
    where: {
      shop,
      OR: [{ id }, { orderNumber: id }, { shopifyOrderId: id }],
    },
    include: {
      items: {
        include: {
          photos: true,
          reason: true,
          inspection: true,
        },
      },
      label: {
        include: {
          events: {
            orderBy: { occurredAt: "desc" },
          },
        },
      },
      refunds: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!rr) throw new Response("Not found", { status: 404 });
  let warehouseAddress = await fetchWarehouseAddress(shop, rr.fulfillmentLocationId);

  const itemImages: Record<string, string> = {};
  let customerName = rr.customerName;
  let carrierName: string | null = null;
  if (rr.label?.carrierId) {
    const carrier = await prisma.carrier.findFirst({
      where: { shop, id: rr.label.carrierId },
      select: { name: true },
    });
    carrierName = carrier?.name ?? null;
  }
  const orderGid = rr.shopifyOrderId?.startsWith("gid://shopify/Order/")
    ? rr.shopifyOrderId
    : rr.shopifyOrderId
      ? `gid://shopify/Order/${rr.shopifyOrderId}`
      : null;

  if (orderGid && admin) {
    try {
      const response = await admin.graphql(
        `#graphql
        query getOrderLineItemImages($id: ID!) {
          order(id: $id) {
            customer { firstName lastName }
            shippingAddress { name }
            fulfillmentOrders(first: 10) {
              edges {
                node {
                  assignedLocation { location { id } }
                }
              }
            }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  image {
                    url
                  }
                  variant {
                    id
                    image {
                      url
                    }
                    product {
                      id
                      featuredImage {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { id: orderGid } }
      );
      const json = await response.json();
      if (!warehouseAddress) {
        const locationId = json?.data?.order?.fulfillmentOrders?.edges
          ?.map((edge: any) => edge.node?.assignedLocation?.location?.id)
          .find(Boolean);
        if (locationId) warehouseAddress = await fetchWarehouseAddress(shop, locationId);
      }
      const customer = json?.data?.order?.customer;
      customerName ||= [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || json?.data?.order?.shippingAddress?.name || null;
      const lineItemNodes = json?.data?.order?.lineItems?.edges?.map((e: any) => e.node) || [];
      for (const node of lineItemNodes) {
        const img = node.image?.url || node.variant?.image?.url || node.variant?.product?.featuredImage?.url;
        if (img) {
          if (node.id) itemImages[node.id] = img;
          if (node.variant?.id) itemImages[node.variant.id] = img;
          if (node.title) itemImages[node.title.toLowerCase().trim()] = img;
        }
      }
    } catch {
      // Gracefully continue
    }
  }

  // Also query any remaining variant or product IDs if missing
  const missingVariantIds = rr.items
    .filter((it) => !itemImages[it.shopifyLineItemId || ""] && !itemImages[it.variantId || ""] && !itemImages[it.title?.toLowerCase().trim() || ""])
    .map((it) => it.variantId || it.productId)
    .filter(Boolean) as string[];

  if (missingVariantIds.length > 0 && admin) {
    try {
      const formattedIds = missingVariantIds.map((vId) =>
        vId.startsWith("gid://shopify/") ? vId : `gid://shopify/ProductVariant/${vId}`
      );
      const resp = await admin.graphql(
        `#graphql
        query getVariantImages($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              image { url }
              product { featuredImage { url } }
            }
            ... on Product {
              id
              featuredImage { url }
            }
          }
        }`,
        { variables: { ids: formattedIds } }
      );
      const vJson = await resp.json();
      for (const node of vJson?.data?.nodes || []) {
        const img = node?.image?.url || node?.featuredImage?.url || node?.product?.featuredImage?.url;
        if (img && node.id) {
          itemImages[node.id] = img;
        }
      }
    } catch {
      // Gracefully continue
    }
  }

  const items = rr.items.map((item) => ({
    ...item,
    reason: item.reason ? decodeReason(item.reason) : null,
  }));

  return { rr: { ...rr, items, customerName }, itemImages, carrierName, warehouseAddress };
};

async function sendApprovedReturnEmail(shop: string, rr: { id: string; orderNumber: string | null; customerEmail: string | null }) {
  if (!rr.customerEmail) return { ok: false, error: "Customer email is missing" };

  let label = await prisma.returnLabel.findUnique({ where: { returnRequestId: rr.id } });
  if (!label || label.status === "failed" || label.status === "voided" || !label.labelUrl) {
    const generated = await createReturnLabel(rr.id);
    if (!generated.ok) {
      return { ok: false, error: `Return label generation failed: ${generated.error || "Unknown error"}` };
    }
    label = await prisma.returnLabel.findUnique({ where: { returnRequestId: rr.id } });
  }
  if (!label?.labelUrl) return { ok: false, error: "No return label URL was generated" };

  try {
    const result = await sendEventEmail(shop, "approved", "en", rr.customerEmail, {
      customerName: rr.customerEmail,
      orderNumber: rr.orderNumber,
      labelLink: label.labelUrl,
      trackingLink: label.trackingUrl || "",
    });
    if (!result.ok) return { ok: false, error: "Approval email delivery failed" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Approval email delivery failed" };
  }
  await prisma.returnRequest.update({
    where: { id: rr.id },
    data: { approvalEmailSentAt: new Date() },
  });
  return { ok: true };
}

// Only requests still waiting for review can be approved or rejected.
// The status check and the update happen in one statement, so a double
// click or a second tab cannot approve (and ship) the same request twice.
const REVIEWABLE_STATUSES = ["Submitted", "Pending Approval"];

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = params.id!;
  const rr = await prisma.returnRequest.findFirst({
    where: {
      shop,
      OR: [{ id }, { orderNumber: id }, { shopifyOrderId: id }],
    },
    include: { items: true, label: true },
  });
  if (!rr) return { ok: false, message: "Request not found" };
  const actualId = rr.id;
  const formData = await request.formData();
  const intent = String(formData.get("_action") || "");

  try {
    if (intent === "approve") {
      const claimed = await prisma.returnRequest.updateMany({
        where: { id: actualId, shop, status: { in: REVIEWABLE_STATUSES } },
        data: { status: "Approved", approvedAt: new Date() },
      });
      if (claimed.count === 0) {
        return { ok: false, intent: "review", message: `This request is already ${rr.status.toLowerCase()} and cannot be approved again.` };
      }
      const emailResult = await sendApprovedReturnEmail(shop, rr);
      if (!emailResult.ok) {
        return { ok: false, intent, message: `Request approved, but ${emailResult.error}. The approval email was not sent.` };
      }
      return { ok: true, intent, message: "Request approved and email sent with the return label" };
    }
    if (intent === "retry_approval_email") {
      if (rr.status !== "Approved") {
        return { ok: false, intent, message: "Approve the return before retrying its approval email." };
      }
      const emailResult = await sendApprovedReturnEmail(shop, rr);
      if (!emailResult.ok) {
        return { ok: false, intent, message: `Retry failed: ${emailResult.error}. The approval email was not sent.` };
      }
      return { ok: true, intent, message: "Approval email sent with the return label" };
    }
    if (intent === "reject") {
      const reason = String(formData.get("rejectionReason") || "").trim();
      const claimed = await prisma.returnRequest.updateMany({
        where: { id: actualId, shop, status: { in: REVIEWABLE_STATUSES } },
        data: { status: "Rejected", rejectedAt: new Date(), rejectionReason: reason },
      });
      if (claimed.count === 0) {
        return { ok: false, intent: "review", message: `This request is already ${rr.status.toLowerCase()} and cannot be rejected.` };
      }
      await sendEventEmail(shop, "rejected", "en", rr.customerEmail || "", {
        customerName: rr.customerEmail || "customer",
        orderNumber: rr.orderNumber,
        reason,
      }).catch(() => null);
      return { ok: true, message: "Request rejected" };
    }
    if (intent === "regenerate_label") {
      const result = await createReturnLabel(actualId);
      if (!result.ok) {
        const message = result.error === "No carrier available for routing"
          ? "No carrier is configured for this order. Choose a carrier and service in Settings > Integrations > Return labels and routing, then regenerate the label."
          : result.error === "SHIPPYPRO_API_KEY not configured"
            ? "ShippyPro API key is missing. Add and save it in Settings > Integrations, then regenerate the label."
            : `Shipping label generation failed: ${result.error || "Unknown error"}`;
        return { ok: false, intent: "regenerate_label", message };
      }
      return { ok: true, intent: "regenerate_label", message: "Shipping label generated" };
    }
    if (intent === "confirm_no_shipment") {
      const result = await confirmNoShipment(actualId);
      if (!result.ok) return { ok: false, intent, message: result.error || "Nothing to confirm" };
      return { ok: true, intent, message: "Marked as not created. You can now generate the label again." };
    }
    if (intent === "void_label") {
      const result = await voidReturnLabel(actualId);
      if (!result.ok) return { ok: false, intent: "void_label", message: result.error || "Unable to void shipping label" };
      return { ok: true, message: "Label voided with ShippyPro" };
    }
    if (intent === "restock_update") {
      if (rr.type === "complaint") {
        return { ok: false, message: "Restocking is not available for complaint requests" };
      }
      const itemId = String(formData.get("itemId"));
      const submittedDecision = String(formData.get("restockDecision") || "pending");
      const decision = submittedDecision === "auto" ? "pending" : submittedDecision;
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
      const reps = items
        .map((it: any) => ({
          returnItemId: it.id,
          replacementVariantId: String(formData.get(`replacement_${it.id}`) || "").trim(),
        }))
        .filter((r: any) => r.replacementVariantId);
      const total = await applyReplacementVariants(actualId, reps);
      return { ok: true, message: `Replacements saved. Price difference total: ${total.toFixed(2)}` };
    }
    if (intent === "exchange_payment_link") {
      if (rr.type !== "exchange") {
        return { ok: false, message: "This action is only available for exchange requests." };
      }
      if (rr.status === "Paid" || rr.replacementOrderId) {
        return { ok: false, message: "This exchange is already approved and has a replacement order." };
      }
      if (rr.status === "Awaiting Payment") {
        return { ok: false, message: "Payment is already pending for this exchange." };
      }
      const result = await createExchangePaymentLink(shop, actualId, rr.customerEmail);
      if (result.required) {
        const emailResult = await sendEventEmail(shop, "payment_required", "en", rr.customerEmail || "", {
          customerName: rr.customerEmail || "customer",
          orderNumber: rr.orderNumber,
          amount: result.total.toFixed(2),
          paymentLink: result.invoiceUrl || "",
        }).catch(() => ({ ok: false }));
        if (!emailResult.ok) {
          return { ok: false, message: `Exchange invoice created, but its email could not be sent. Share this Shopify link with the customer: ${result.invoiceUrl}` };
        }
      }
      if (!result.required) {
        return { ok: true, message: `No additional payment required. Replacement order created: ${result.orderId}` };
      }
      return { ok: true, message: `Payment link created: ${result.invoiceUrl}` };
    }
    if (intent === "status_update") {
      const status = String(formData.get("status") || rr.status);
      await prisma.returnRequest.update({ where: { id: actualId }, data: { status } });
      return { ok: true, message: "Status updated" };
    }
    if (intent === "set_resolution") {
      const resolution = String(formData.get("requestedResolution") || "").trim();
      await prisma.returnRequest.update({ where: { id: actualId }, data: { requestedResolution: resolution || null } });
      return { ok: true, message: "Resolution updated" };
    }
    if (intent === "create_replacement") {
      const result = await createReplacementOrder(shop, actualId);
      if (!result.ok) return { ok: false, message: result.error || "Replacement failed" };
      return { ok: true, message: `Replacement order created: ${result.orderId}` };
    }
    if (intent === "issue_refund") {
      const amountRaw = String(formData.get("refundAmount") || "").trim();
      const amount = amountRaw ? Number(amountRaw) : undefined;
      const note = String(formData.get("refundNote") || "").trim();
      const result = await issueRefund(shop, actualId, amount, note);
      if (!result.ok) return { ok: false, message: result.error || "Refund failed" };
      return { ok: true, message: `Refund issued: ${result.amount}` };
    }
    return { ok: false, message: "Unknown action" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error" };
  }
};

function getStatusBadgeClass(status: string) {
  const s = (status || "").toLowerCase().trim();
  if (s.includes("submitted") || s.includes("pending approval")) return "returbo-status-submitted";
  if (s.includes("approved") || s.includes("completed")) return "returbo-status-approved";
  if (s.includes("rejected")) return "returbo-status-rejected";
  if (s.includes("label") || s.includes("transit")) return "returbo-status-in-transit";
  if (s.includes("received") || s.includes("inspected")) return "returbo-status-received";
  return "returbo-badge-gray";
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default function ReturnDetailPage() {
  const { rr, itemImages = {}, carrierName, warehouseAddress } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isApproving = navigation.state !== "idle" && navigation.formData?.get("_action") === "approve";
  const isRetryingApprovalEmail = navigation.state !== "idle" && navigation.formData?.get("_action") === "retry_approval_email";
  const isGeneratingLabel = navigation.state !== "idle" && navigation.formData?.get("_action") === "regenerate_label";
  const [showRejectForm, setShowRejectForm] = useState(false);

  const allPhotos = rr.items?.flatMap((it: any) => it.photos || []) || [];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--returbo-bg, #f6f6f7)" }}>
      <GrandLeMarHeader activeSection="returns" />

      <main className="returbo-detail-page-main">
        {/* Top Breadcrumb & Navigation */}
        <div className="returbo-detail-topbar">
          <Link to="/app/returns" className="returbo-back-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to returns</span>
          </Link>
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            Return ID: <span style={{ fontFamily: "monospace", color: "#111827" }}>{rr.id}</span>
          </div>
        </div>

        {/* Feedback message banner */}
        {actionData?.message
          && !(actionData.intent === "regenerate_label" && actionData.ok === false)
          && !(actionData.ok === false && (actionData.intent === "approve" || actionData.intent === "retry_approval_email")) && (
          <div className={`returbo-alert-banner ${actionData.ok !== false ? "success" : "error"}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {actionData.ok !== false ? (
                <>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </>
              ) : (
                <>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </>
              )}
            </svg>
            <span>{actionData.message}</span>
            {actionData.ok === false
              && (actionData.intent === "approve" || actionData.intent === "retry_approval_email")
              && rr.customerEmail && (
                <Form method="post" style={{ marginLeft: "auto" }}>
                  <input type="hidden" name="_action" value="retry_approval_email" />
                  <button type="submit" className="returbo-btn-primary" disabled={isRetryingApprovalEmail} aria-busy={isRetryingApprovalEmail}>
                    {isRetryingApprovalEmail ? "Retrying..." : "Retry label & email"}
                  </button>
                </Form>
              )}
          </div>
        )}

        {rr.status === "Approved" && !rr.approvalEmailSentAt && (
          <div className="returbo-alert-banner error" role="alert">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>
              {actionData?.ok === false && (actionData.intent === "approve" || actionData.intent === "retry_approval_email")
                ? actionData.message
                : rr.label?.labelUrl
                  ? "Approval email has not been sent."
                  : "Return label has not been generated; the approval email has not been sent."}
            </span>
            {rr.customerEmail && (
              <Form method="post" style={{ marginLeft: "auto" }}>
                <input type="hidden" name="_action" value="retry_approval_email" />
                <button type="submit" className="returbo-btn-primary" disabled={isRetryingApprovalEmail} aria-busy={isRetryingApprovalEmail}>
                  {isRetryingApprovalEmail ? "Retrying..." : "Retry label & email"}
                </button>
              </Form>
            )}
          </div>
        )}

        {/* Review Flagged Warning */}
        {rr.reviewFlagged && (
          <div className="returbo-alert-banner warning">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <strong>Flagged for Review:</strong> This return request triggered a safety or policy inspection rule. Please verify the items and customer details carefully before approval.
            </div>
          </div>
        )}

        {/* Header Summary Card */}
        <div className="returbo-detail-header-card">
          <div className="returbo-detail-header-left">
            <h1 className="returbo-detail-header-title">
              Return {rr.orderNumber || rr.requestNumber || rr.shopifyOrderId || rr.id}
            </h1>
            <div className="returbo-detail-header-badges">
              <span className={`returbo-status-badge ${getStatusBadgeClass(rr.status)}`}>
                {rr.type === "exchange" && rr.status === "Paid" ? "Exchange approved" : rr.status}
              </span>
              <span className="returbo-badge returbo-badge-gray" style={{ textTransform: "capitalize" }}>
                {rr.type}
              </span>
              {rr.isWithdrawal && (
                <span className="returbo-badge returbo-badge-yellow">EU Withdrawal</span>
              )}
            </div>
          </div>

          <div className="returbo-detail-header-actions">
            {rr.type !== "exchange" && rr.status !== "Approved" && (
              <Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="_action" value="approve" />
                <button type="submit" className="returbo-btn-primary" disabled={isApproving} aria-busy={isApproving}>
                  {isApproving ? (
                    <span className="returbo-inline-loading">Approving...</span>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Approve return</span>
                    </>
                  )}
                </button>
              </Form>
            )}

            {rr.status !== "Rejected" && (
              <button
                type="button"
                className="returbo-btn-danger-outline"
                onClick={() => setShowRejectForm((v) => !v)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                <span>{showRejectForm ? "Cancel reject" : "Reject request"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Rejection Form Drawer / Box (Conditional) */}
        {showRejectForm && (
          <div className="returbo-detail-card" style={{ borderColor: "#fecaca", background: "#fef2f2" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: "#991b1b", marginTop: 0, marginBottom: 8 }}>
              Reject Return Request
            </h3>
            <p style={{ fontSize: 13, color: "#7f1d1d", marginBottom: 14 }}>
              Provide a reason for the rejection. This explanation will be emailed directly to the customer.
            </p>
            <Form method="post">
              <input type="hidden" name="_action" value="reject" />
              <div style={{ marginBottom: 12 }}>
                <textarea
                  name="rejectionReason"
                  rows={3}
                  required
                  placeholder="e.g. Return period has expired or item not eligible..."
                  className="returbo-detail-textarea"
                  defaultValue={rr.rejectionReason || ""}
                />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="submit" className="returbo-btn-danger">
                  Confirm rejection
                </button>
                <button
                  type="button"
                  className="returbo-btn-secondary"
                  onClick={() => setShowRejectForm(false)}
                >
                  Cancel
                </button>
              </div>
            </Form>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="returbo-detail-grid">
          {/* LEFT COLUMN: Items, Photos, Exchange, Label, Refunds */}
          <div className="returbo-detail-main-col">
            {/* 1. Return Items Card */}
            <div className="returbo-detail-card">
              <div className="returbo-detail-card-header">
                <h2 className="returbo-detail-card-title">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                  <span>Requested Items</span>
                </h2>
                <span className="returbo-detail-card-badge">
                  {rr.items?.length || 0} {rr.items?.length === 1 ? "item" : "items"}
                </span>
              </div>

              {rr.items?.map((it: any) => {
                const itemImg =
                  itemImages[it.shopifyLineItemId || ""] ||
                  itemImages[it.variantId || ""] ||
                  itemImages[it.productId || ""] ||
                  itemImages[it.title?.toLowerCase().trim() || ""] ||
                  it.photos?.[0]?.url;
                const reasonLabel = it.reason
                  ? `${it.reason.parentLabel ? `${it.reason.parentLabel} / ` : ""}${it.reason.labelEn}`
                  : it.reason?.label || it.reason?.code || "No reason specified";

                return (
                  <div key={it.id} className="returbo-detail-item-box">
                    <div className="returbo-detail-item-top">
                      <div className="returbo-item-icon-box">
                        {itemImg ? (
                          <img src={itemImg} alt={it.title || "Product"} className="returbo-item-img" />
                        ) : (
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.5a2 2 0 0 0 1.34 1.57L6 11.25V20a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8.75l1.8-0.49a2 2 0 0 0 1.34-1.57l.58-3.5a2 2 0 0 0-1.34-2.23z" />
                          </svg>
                        )}
                      </div>

                      <div className="returbo-detail-item-content">
                        <div className="returbo-detail-item-name">{it.title || "Line item"}</div>
                        <div className="returbo-detail-item-meta">
                          <span>
                            Quantity: <strong>{it.returnedQuantity || it.quantity}</strong>
                            {it.returnedQuantity && it.returnedQuantity !== it.quantity ? ` of ${it.quantity}` : ""}
                          </span>
                          <span className="returbo-badge returbo-badge-gray">
                            Reason: {reasonLabel}
                          </span>
                          {it.priceDifferenceStr && (
                            <span className="returbo-badge returbo-badge-blue">
                              Diff: {it.priceDifferenceStr}
                            </span>
                          )}
                        </div>

                        {it.comment && (
                          <div className="returbo-detail-quote">
                            <strong>Customer comment:</strong> {it.comment}
                          </div>
                        )}

                        {it.inspection && (
                          <div style={{ marginTop: 10, fontSize: 13, display: "flex", gap: 10, alignItems: "center" }}>
                            <span className="returbo-badge returbo-badge-green">
                              Condition: {it.inspection.condition}
                            </span>
                            <span>Approved Qty: {it.inspection.approvedQuantity}</span>
                            {it.inspection.note && (
                              <span style={{ color: "#6b7280" }}>Note: {it.inspection.note}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Restock Management Form */}
                    {rr.type !== "complaint" && <Form method="post" className="returbo-detail-form-row">
                      <input type="hidden" name="_action" value="restock_update" />
                      <input type="hidden" name="itemId" value={it.id} />

                      <span style={{ fontSize: 13, fontWeight: 500, color: "#4b5563" }}>
                        Restock:
                      </span>

                      <select
                        name="restockDecision"
                        defaultValue={it.restockDecision === "auto" ? "pending" : it.restockDecision || "pending"}
                        className="returbo-detail-select"
                      >
                        <option value="manual">Manual restock</option>
                        <option value="no">Do not restock</option>
                        <option value="pending">Pending decision</option>
                      </select>

                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          name="restocked"
                          defaultChecked={Boolean(it.restocked)}
                          style={{ accentColor: "var(--returbo-pink)" }}
                        />
                        <span>Restocked</span>
                      </label>

                      <button type="submit" className="returbo-btn-pink-outline" style={{ padding: "6px 14px", fontSize: 12 }}>
                        Update restock
                      </button>

                      {it.restocked && (
                        <span style={{ fontSize: 12, color: "#059669", fontWeight: 500, marginLeft: 4 }}>
                          ✓ Restocked {it.restockedAt ? `(${formatDate(it.restockedAt)})` : ""}
                        </span>
                      )}
                    </Form>}
                  </div>
                );
              })}
            </div>

            {/* 2. Customer Uploaded Photos */}
            <div className="returbo-detail-card">
              <div className="returbo-detail-card-header">
                <h2 className="returbo-detail-card-title">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span>Uploaded Photos</span>
                </h2>
                <span className="returbo-detail-card-badge">{allPhotos.length} photos</span>
              </div>

              {allPhotos.length > 0 ? (
                <div className="returbo-detail-photo-grid">
                  {allPhotos.map((p: any) => (
                    <a
                      key={p.id}
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="returbo-detail-photo-card"
                    >
                      <img src={p.url} alt={p.fileName || "Uploaded photo"} className="returbo-detail-photo-img" />
                      <span className="returbo-detail-photo-lbl">
                        {p.fileName || "View full"} ↗
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#6b7280", fontStyle: "italic", padding: "10px 0" }}>
                  No photos were attached by the customer for this request.
                </div>
              )}
            </div>

            {/* 3. Resolution Details Card */}
            <div className="returbo-detail-card">
              <div className="returbo-detail-card-header">
                <h2 className="returbo-detail-card-title">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 14 14" />
                  </svg>
                  <span>Resolution & Fulfillment</span>
                </h2>
                <span className="returbo-badge returbo-badge-pink" style={{ textTransform: "capitalize" }}>
                  {rr.requestedResolution || "Refund"}
                </span>
              </div>

              <div style={{ marginBottom: 16 }}>
                <Form method="post" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <input type="hidden" name="_action" value="set_resolution" />
                  <label htmlFor="requestedResolution" style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>
                    Resolution mode:
                  </label>
                  <select
                    id="requestedResolution"
                    name="requestedResolution"
                    defaultValue={rr.requestedResolution || "refund"}
                    className="returbo-detail-select"
                  >
                    <option value="refund">Refund to original payment</option>
                    <option value="store_credit">Store credit voucher</option>
                    <option value="exchange">Exchange for replacement</option>
                    <option value="replacement">Free replacement</option>
                  </select>
                  <button type="submit" className="returbo-btn-pink-outline">
                    Save resolution
                  </button>
                </Form>
              </div>

              {rr.storeCreditIssuedAt && (
                <div className="returbo-alert-banner success" style={{ marginBottom: 14 }}>
                  <span>
                    Store credit of <strong>{rr.storeCreditAmount}</strong> issued on {formatDateTime(rr.storeCreditIssuedAt)}.
                  </span>
                </div>
              )}

              {rr.replacementOrderId && (
                <div className="returbo-alert-banner success" style={{ marginBottom: 14 }}>
                  <span>
                    Replacement Order created: <strong>{rr.replacementOrderId}</strong>
                  </span>
                </div>
              )}

              <Form method="post">
                <input type="hidden" name="_action" value="create_replacement" />
                <button type="submit" className="returbo-btn-primary">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <path d="M16 10a4 4 0 0 1-8 0" />
                  </svg>
                  <span>Create replacement order in Shopify</span>
                </button>
              </Form>
            </div>

            {/* 4. Exchange Specific Controls (if Exchange) */}
            {rr.type === "exchange" && (
              <div className="returbo-detail-card">
                <div className="returbo-detail-card-header">
                  <h2 className="returbo-detail-card-title">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 3 21 3 21 8" />
                      <line x1="4" y1="20" x2="21" y2="3" />
                      <polyline points="21 16 21 21 16 21" />
                      <line x1="15" y1="15" x2="21" y2="21" />
                      <line x1="4" y1="4" x2="9" y2="9" />
                    </svg>
                    <span>Exchange Replacements</span>
                  </h2>
                </div>

                <Form method="post" style={{ marginBottom: 18 }}>
                  <input type="hidden" name="_action" value="exchange_set_replacements" />
                  <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>
                    {rr.items?.map((it: any) => (
                      <div key={it.id} style={{ background: "#f9fafb", padding: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
                          {it.title} x{it.returnedQuantity || it.quantity}
                        </div>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <input
                            type="text"
                            name={`replacement_${it.id}`}
                            defaultValue={it.replacementVariantId || ""}
                            placeholder="Replacement variant ID (GID / numeric)"
                            className="returbo-detail-input"
                            style={{ flex: 1, minWidth: 220 }}
                          />
                          {it.priceDifferenceStr && (
                            <span style={{ fontSize: 13, fontWeight: 500, color: "#2563eb" }}>
                              Diff: {it.priceDifferenceStr}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="submit" className="returbo-btn-primary">
                    Save replacements
                  </button>
                </Form>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", borderTop: "1px solid #f3f4f6", paddingTop: 14 }}>
                  {rr.status === "Paid" || rr.replacementOrderId ? (
                    <span className="returbo-badge returbo-badge-green">Exchange approved</span>
                  ) : rr.status === "Awaiting Payment" ? (
                    <span className="returbo-badge returbo-badge-yellow">Payment pending</span>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="_action" value="exchange_payment_link" />
                      <button type="submit" className="returbo-btn-secondary">
                        Create payment link / approve exchange
                      </button>
                    </Form>
                  )}
                </div>
              </div>
            )}

            {/* 5. Shipping Label & Tracking History */}
            <div className="returbo-detail-card">
              {actionData?.intent === "regenerate_label" && actionData.ok === false && (
                <div className="returbo-alert-banner error" role="alert" style={{ marginBottom: 16 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{actionData.message}</span>
                </div>
              )}
              <div className="returbo-detail-card-header">
                <h2 className="returbo-detail-card-title">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="3" width="15" height="13" />
                    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                    <circle cx="5.5" cy="18.5" r="2.5" />
                    <circle cx="18.5" cy="18.5" r="2.5" />
                  </svg>
                  <span>Return Shipping & Tracking</span>
                </h2>
                {rr.label && (
                  <span className={`returbo-badge ${rr.label.status === "created" ? "returbo-badge-green" : "returbo-badge-gray"}`}>
                    {rr.label.status}
                  </span>
                )}
              </div>

              {rr.label ? (
                <div>
                  <table className="returbo-detail-info-table" style={{ marginBottom: 16 }}>
                    <tbody>
                      <tr>
                        <td className="returbo-detail-info-label">Selected Carrier</td>
                        <td className="returbo-detail-info-val">{carrierName || rr.label.connectionId || rr.carrierId || "Default carrier"}</td>
                      </tr>
                      <tr>
                        <td className="returbo-detail-info-label">Shopify warehouse</td>
                        <td className="returbo-detail-info-val">
                          {warehouseAddress
                            ? [
                                warehouseAddress.name,
                                warehouseAddress.company,
                                warehouseAddress.address1,
                                warehouseAddress.address2,
                                warehouseAddress.city,
                                warehouseAddress.state,
                                warehouseAddress.zip,
                                warehouseAddress.country,
                              ].filter(Boolean).join(", ")
                            : "Fulfillment location address unavailable"}
                        </td>
                      </tr>
                      <tr>
                        <td className="returbo-detail-info-label">Service</td>
                        <td className="returbo-detail-info-val">{rr.label.service || "—"}</td>
                      </tr>
                      <tr>
                        <td className="returbo-detail-info-label">Tracking Number</td>
                        <td className="returbo-detail-info-val">
                          {rr.label.trackingUrl ? (
                            <a href={rr.label.trackingUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--returbo-pink)", textDecoration: "none", fontWeight: 600 }}>
                              {rr.label.trackingNumber} ↗
                            </a>
                          ) : (
                            rr.label.trackingNumber || "Pending"
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
                    {rr.label.labelUrl && (
                      <a href={rr.label.labelUrl} target="_blank" rel="noopener noreferrer" className="returbo-btn-primary">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>Download shipping label</span>
                      </a>
                    )}
                    {RETRYABLE_LABEL_STATUSES.includes(rr.label.status) && (
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="_action" value="regenerate_label" />
                        <button type="submit" className="returbo-btn-pink-outline" disabled={isGeneratingLabel}>
                          {isGeneratingLabel ? "Generating label..." : "Generate label again"}
                        </button>
                      </Form>
                    )}
                    {(rr.label.status === "unknown" || rr.label.status === "sending") && (
                      <Form
                        method="post"
                        style={{ display: "inline" }}
                        onSubmit={(event) => {
                          if (!window.confirm(`Only continue if ShippyPro has NO shipment for order ${rr.orderNumber || ""}. Otherwise a second, paid label will be created.`)) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input type="hidden" name="_action" value="confirm_no_shipment" />
                        <button type="submit" className="returbo-btn-pink-outline">
                          No shipment was created
                        </button>
                      </Form>
                    )}
                    {rr.label.shippyproOrderId && rr.label.status !== "voided" && (
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="_action" value="void_label" />
                        <button type="submit" className="returbo-btn-danger-outline">
                          Void label
                        </button>
                      </Form>
                    )}
                  </div>
                  {(rr.label.status === "unknown" || rr.label.status === "sending") && (
                    <p role="alert" style={{ fontSize: 13, color: "#b45309", marginTop: -8, marginBottom: 16 }}>
                      The last label request has no confirmed result, so a shipment may already exist in ShippyPro.
                      Check ShippyPro before creating another label.
                    </p>
                  )}

                  <h3 style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 12 }}>
                    Tracking Events
                  </h3>
                  {rr.label.events && rr.label.events.length > 0 ? (
                    <ul className="returbo-detail-timeline">
                      {rr.label.events.map((ev: any) => (
                        <li key={ev.id} className="returbo-detail-timeline-item">
                          <div className="returbo-detail-timeline-dot" />
                          <div className="returbo-detail-timeline-body">
                            <div className="returbo-detail-timeline-date">
                              {formatDateTime(ev.occurredAt)}
                            </div>
                            <div className="returbo-detail-timeline-title">{ev.status}</div>
                            {ev.message && (
                              <div className="returbo-detail-timeline-desc">{ev.message}</div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
                      No tracking milestone events received from carrier yet.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 14 }}>
                    No return label has been generated yet for this request.
                  </p>
                  <Form method="post">
                    <input type="hidden" name="_action" value="regenerate_label" />
                    <button type="submit" className="returbo-btn-primary" disabled={isGeneratingLabel}>
                      {isGeneratingLabel ? "Generating label..." : "Generate shipping label"}
                    </button>
                  </Form>
                </div>
              )}
            </div>

            {/* 6. Refunds Card */}
            <div className="returbo-detail-card">
              <div className="returbo-detail-card-header">
                <h2 className="returbo-detail-card-title">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  <span>Refunds</span>
                </h2>
                <span className="returbo-detail-card-badge">
                  {rr.refunds?.length || 0} issued
                </span>
              </div>

              {rr.refunds && rr.refunds.length > 0 ? (
                <div style={{ marginBottom: 18 }}>
                  {rr.refunds.map((r: any) => (
                    <div
                      key={r.id}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        border: "1px solid #e5e7eb",
                        background: "#fafbfc",
                        marginBottom: 8,
                        fontSize: 13,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      <div>
                        <strong>{r.amount} {r.currency || "USD"}</strong>{" "}
                        <span className={`returbo-badge ${r.status === "success" ? "returbo-badge-green" : "returbo-badge-gray"}`}>
                          {r.status}
                        </span>
                        {r.shopifyRefundId && (
                          <span style={{ color: "#6b7280", marginLeft: 6 }}>
                            (Shopify ID: {r.shopifyRefundId})
                          </span>
                        )}
                        {r.note && <div style={{ color: "#4b5563", marginTop: 4 }}>{r.note}</div>}
                        {r.errorMessage && <div style={{ color: "#dc2626", marginTop: 4 }}>Error: {r.errorMessage}</div>}
                      </div>
                      <div style={{ color: "#9ca3af", fontSize: 12 }}>
                        {formatDateTime(r.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 18 }}>
                  No refunds have been processed for this return request yet.
                </p>
              )}

              <Form method="post" style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
                <input type="hidden" name="_action" value="issue_refund" />
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#111827", margin: "0 0 10px 0" }}>
                  Issue Refund
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 12 }}>
                  <div>
                    <label htmlFor="refundAmount" style={{ display: "block", fontSize: 12, color: "#4b5563", marginBottom: 4 }}>
                      Amount (blank = full)
                    </label>
                    <input
                      id="refundAmount"
                      type="number"
                      step="0.01"
                      name="refundAmount"
                      placeholder="e.g. 50.00"
                      className="returbo-detail-input"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <label htmlFor="refundNote" style={{ display: "block", fontSize: 12, color: "#4b5563", marginBottom: 4 }}>
                      Refund note
                    </label>
                    <input
                      id="refundNote"
                      type="text"
                      name="refundNote"
                      placeholder="Optional or required if adjusting amount"
                      className="returbo-detail-input"
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
                <button type="submit" className="returbo-btn-primary">
                  Process refund
                </button>
              </Form>
            </div>
          </div>

          {/* RIGHT COLUMN: Order & Customer Details, Status Actions */}
          <div className="returbo-detail-side-col">
            {/* Status Workflow Action Card */}
            <div className="returbo-detail-card">
              <div className="returbo-detail-card-header">
                <h2 className="returbo-detail-card-title">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>Request Status</span>
                </h2>
              </div>

              <div style={{ marginBottom: 16 }}>
                <span className={`returbo-status-badge ${getStatusBadgeClass(rr.status)}`} style={{ fontSize: 14, padding: "5px 14px" }}>
                  {rr.status}
                </span>
              </div>

              <Form method="post" style={{ marginBottom: 14 }}>
                <input type="hidden" name="_action" value="status_update" />
                <label htmlFor="statusSelect" style={{ display: "block", fontSize: 12, color: "#4b5563", marginBottom: 6, fontWeight: 500 }}>
                  Update workflow status:
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    id="statusSelect"
                    name="status"
                    defaultValue={rr.status}
                    className="returbo-detail-select"
                    style={{ flex: 1 }}
                  >
                    <option value="Submitted">Submitted</option>
                    <option value="Pending Approval">Pending Approval</option>
                    <option value="Approved">Approved</option>
                    <option value="Label Created">Label Created</option>
                    <option value="In Transit">In Transit</option>
                    <option value="Received">Received</option>
                    <option value="Inspected">Inspected</option>
                    <option value="Completed">Completed</option>
                  </select>
                  <button type="submit" className="returbo-btn-pink-outline">
                    Update
                  </button>
                </div>
              </Form>

              {rr.rejectionReason && (
                <div style={{ marginTop: 12, padding: 12, background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca", fontSize: 13, color: "#991b1b" }}>
                  <strong>Rejection reason:</strong> {rr.rejectionReason}
                  {rr.rejectedAt && (
                    <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 4 }}>
                      Rejected on {formatDateTime(rr.rejectedAt)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Customer & Order Information Card */}
            <div className="returbo-detail-card">
              <div className="returbo-detail-card-header">
                <h2 className="returbo-detail-card-title">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span>Customer & Order</span>
                </h2>
              </div>

              <table className="returbo-detail-info-table">
                <tbody>
                  <tr>
                    <td className="returbo-detail-info-label">Customer Name</td>
                    <td className="returbo-detail-info-val">{rr.customerName || "—"}</td>
                  </tr>
                  <tr>
                    <td className="returbo-detail-info-label">Customer Email</td>
                    <td className="returbo-detail-info-val">
                      {rr.customerEmail ? (
                        <a href={`mailto:${rr.customerEmail}`} style={{ color: "var(--returbo-pink)", textDecoration: "none" }}>
                          {rr.customerEmail}
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="returbo-detail-info-label">Order Number</td>
                    <td className="returbo-detail-info-val">{rr.orderNumber || "—"}</td>
                  </tr>
                  <tr>
                    <td className="returbo-detail-info-label">Shopify Order ID</td>
                    <td className="returbo-detail-info-val" style={{ fontFamily: "monospace", fontSize: 12 }}>
                      {rr.shopifyOrderId || "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="returbo-detail-info-label">Submitted</td>
                    <td className="returbo-detail-info-val">
                      {rr.submittedAt ? formatDate(rr.submittedAt) : "—"}
                    </td>
                  </tr>
                  {rr.approvedAt && (
                    <tr>
                      <td className="returbo-detail-info-label">Approved</td>
                      <td className="returbo-detail-info-val">
                        {formatDate(rr.approvedAt)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="returbo-detail-info-label">Market / Country</td>
                    <td className="returbo-detail-info-val">
                      {rr.market || rr.countryCode || "Global"}
                    </td>
                  </tr>
                  <tr>
                    <td className="returbo-detail-info-label">EU Withdrawal</td>
                    <td className="returbo-detail-info-val">
                      {rr.isWithdrawal ? "Yes" : "No"}
                    </td>
                  </tr>
                  {rr.deflectionOffered && (
                    <tr>
                      <td className="returbo-detail-info-label">Deflection</td>
                      <td className="returbo-detail-info-val">
                        {rr.deflectionAccepted ? "Store credit accepted" : "Offered"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
