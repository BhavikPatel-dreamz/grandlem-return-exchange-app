/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import {
  checkRateLimit,
  lookupAndValidateOrder,
  portalErrorCodeToMessage,
} from "../services/portal.server";
import { getLabelTimingForMarket, getOrCreateSettings } from "../services/settings.server";
import { createReturnRequest } from "../services/returns.server";
import { createReturnLabel } from "../services/shippypro.server";
import { sendEventEmail } from "../services/email.server";
import prisma from "../db.server";

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return {
    shop: url.searchParams.get("shop") || "",
    lang: "en" as const,
  };
};

async function fileToDataUrl(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${buf.toString("base64")}`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const shop = String(formData.get("shop") || "").trim();
  const orderNumber = String(formData.get("orderNumber") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const lang = "en" as const;
  const requestType = (String(formData.get("requestType") || "return") as "return" | "exchange" | "complaint");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`${ip}:${shop}`)) {
    return { ok: false, code: "RATE_LIMITED", message: portalErrorCodeToMessage("RATE_LIMITED"), lang } as const;
  }

  if (formData.get("_action") === "create_request") {
    const result = await lookupAndValidateOrder(shop, orderNumber, email, requestType);
    if (!result.ok) {
      return { ...result, message: portalErrorCodeToMessage(result.code), lang } as const;
    }

    const settings = await getOrCreateSettings(shop);
    const selected = formData.getAll("selected").map(String);
    if (selected.length === 0) {
      return { ok: false, code: "INVALID_INPUT", message: "Select at least one item.", lang } as const;
    }

    const items: {
      shopifyLineItemId: string;
      productId: string | null;
      variantId: string | null;
      title: string | null;
      quantity: number;
      reasonId: string | null;
      comment: string | null;
      photos: { url: string; fileName?: string; mimeType?: string; size?: number }[];
    }[] = [];

    for (const id of selected) {
      const li = result.order.lineItems.find((x) => x.id === id);
      if (!li || li.excluded) continue;
      const qty = Number(formData.get(`qty_${id}`));
      if (!Number.isFinite(qty) || qty < 1 || qty > li.quantity) {
        return { ok: false, code: "INVALID_INPUT", message: `Invalid quantity for ${li.title}.`, lang } as const;
      }
      const reasonIdRaw = String(formData.get(`reason_${id}`) || "").trim();
      const reasonId = reasonIdRaw ? reasonIdRaw : null;
      if (reasonId && !result.reasons.some((r) => r.id === reasonId)) {
        return { ok: false, code: "INVALID_INPUT", message: "Invalid reason selected.", lang } as const;
      }
      const commentRaw = String(formData.get(`comment_${id}`) || "").trim();
      const comment = commentRaw ? commentRaw : null;

      const photos: { url: string; fileName?: string; mimeType?: string; size?: number }[] = [];
      const files = formData.getAll(`photo_${id}`);
      for (const entry of files) {
        if (!entry || typeof entry === "string") continue;
        const f = entry as File;
        if (f.size <= 0) continue;
        if (!f.type.startsWith("image/")) {
          return { ok: false, code: "INVALID_INPUT", message: "Only image files are allowed.", lang } as const;
        }
        if (f.size > MAX_PHOTO_SIZE) {
          return { ok: false, code: "INVALID_INPUT", message: "Photo exceeds 5MB limit.", lang } as const;
        }
        photos.push({ url: await fileToDataUrl(f), fileName: f.name, mimeType: f.type, size: f.size });
      }

      const isComplaint = requestType === "complaint";
      if (isComplaint && settings.claimRequiresPhoto && photos.length < settings.claimMinPhotos) {
        return {
          ok: false,
          code: "INVALID_INPUT",
          message: `Complaint requires at least ${settings.claimMinPhotos} photo(s).`,
          lang,
        } as const;
      }
      if (isComplaint && (comment?.length ?? 0) < settings.claimMinCommentLength) {
        return {
          ok: false,
          code: "INVALID_INPUT",
          message: `Complaint comment must be at least ${settings.claimMinCommentLength} characters.`,
          lang,
        } as const;
      }

      items.push({
        shopifyLineItemId: li.id,
        productId: li.productId,
        variantId: li.variantId,
        title: li.title,
        quantity: qty,
        reasonId,
        comment,
        photos,
      });
    }

    if (items.length === 0) {
      return { ok: false, code: "INVALID_INPUT", message: "No eligible items selected.", lang } as const;
    }

    const request = await createReturnRequest({
      shop,
      shopifyOrderId: result.order.id,
      orderNumber: result.order.name,
      market: result.order.market ?? null,
      customerEmail: result.order.email,
      customerName: result.order.customerName,
      type: requestType,
      autoApprove: settings.autoApproveRequests,
      items,
      fulfillmentLocationId: result.order.fulfillmentLocationId ?? null,
    });

    let labelUrl: string | null = null;
    let trackingUrl: string | null = null;
    if (settings.autoApproveRequests || getLabelTimingForMarket(settings.labelTimingPerMarket, result.order.market) === "immediate") {
      const generated = await createReturnLabel(request.id);
      if (generated.ok) {
        const label = await prisma.returnLabel.findUnique({ where: { returnRequestId: request.id } });
        labelUrl = label?.labelUrl ?? null;
        trackingUrl = label?.trackingUrl ?? null;
      }
    }

    await sendEventEmail(shop, settings.autoApproveRequests ? "approved" : "received", lang, result.order.email || "", {
      customerName: result.order.customerName || result.order.email || "customer",
      orderNumber: result.order.name,
      requestNumber: request.requestNumber,
      items: items.map((it) => it.title).join(", "),
      labelLink: labelUrl || "",
      trackingLink: trackingUrl || "",
    }).catch(() => null);

    return {
      ok: true,
      created: true,
      requestId: request.id,
      requestNumber: request.requestNumber,
      orderName: result.order.name,
      labelUrl,
      lang,
    } as const;
  }

  const result = await lookupAndValidateOrder(shop, orderNumber, email, requestType);
  if (!result.ok) {
    return { ...result, message: portalErrorCodeToMessage(result.code), lang } as const;
  }
  return { ...result, message: portalErrorCodeToMessage("ORDER_NOT_FOUND") === "" ? "" : "Order validated.", lang } as const;
};

export default function PortalPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const lang = "en" as const;
  const hasOrder = !!actionData && "ok" in actionData && actionData.ok === true && !("created" in actionData);
  const created = !!actionData && "created" in actionData && actionData.created === true;

  const items = hasOrder ? (actionData as any).order.lineItems ?? [] : [];
  const reasons = hasOrder ? (actionData as any).reasons ?? [] : [];
  const currentRequestType = hasOrder
    ? String((actionData as any).requestType ?? "return")
    : "return";
  const isComplaint = currentRequestType === "complaint";

  return (
    <s-page heading="Returns portal">
      <s-section heading="Find your order">
        <Form method="post">
          <input type="hidden" name="_action" value="validate" />
          <input type="hidden" name="lang" value={lang} />
          <s-stack direction="block" gap="base">
            <s-text-field name="shop" label="Shop domain" value={loaderData.shop} />
            <s-select name="requestType" label="Request type">
              <s-option value="return">Return</s-option>
              <s-option value="exchange">Exchange</s-option>
              <s-option value="complaint">Complaint</s-option>
            </s-select>
            <s-text-field name="orderNumber" label="Order number" />
            <s-email-field name="email" label="Email address" />
            <s-button type="submit">Find order</s-button>
          </s-stack>
        </Form>
      </s-section>

      {actionData && "ok" in actionData && actionData.ok === false && (
        <s-section heading="Error">
          <s-paragraph>{actionData.message}</s-paragraph>
        </s-section>
      )}

      {hasOrder && (
        <s-section heading={`Order ${ (actionData as any).order.name }`}>
          <s-paragraph>Return deadline: {new Date((actionData as any).deadline).toLocaleDateString()}</s-paragraph>
          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="_action" value="create_request" />
            <input type="hidden" name="shop" value={(actionData as any).shop} />
            <input type="hidden" name="orderNumber" value={(actionData as any).order.name} />
            <input type="hidden" name="email" value={(actionData as any).order.email ?? ""} />
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="requestType" value={(actionData as any)?.requestType ?? "return"} />
            <s-stack direction="block" gap="base">
              {(items as any[]).map((li: any) => {
                if (li.excluded) {
                  return (
                    <s-box key={li.id} padding="base" borderWidth="base" borderRadius="base">
                      <s-paragraph>
                        {li.title} x{li.quantity} — excluded/already returned
                      </s-paragraph>
                    </s-box>
                  );
                }
                return (
                  <s-box key={li.id} padding="base" borderWidth="base" borderRadius="base">
                    <s-stack direction="block" gap="base">
                      <s-checkbox name="selected" value={li.id} label={`${li.title} x${li.quantity}`} />
                      <s-number-field name={`qty_${li.id}`} label="Quantity to return" defaultValue="1" />
                      <s-select name={`reason_${li.id}`} label="Reason">
                        <s-option value="">Select reason</s-option>
                        {reasons.map((r: any) => (
                          <s-option key={r.id} value={r.id}>
                            {r.parentLabel ? `${r.parentLabel} / ${r.labelEn}` : r.labelEn}
                          </s-option>
                        ))}
                      </s-select>
                      <s-text-field
                        name={`comment_${li.id}`}
                        label={isComplaint ? "Comment (required for complaints)" : "Comment (optional)"}
                        required={isComplaint}
                      />
                      <input type="file" name={`photo_${li.id}`} accept="image/*" multiple required={isComplaint} />
                    </s-stack>
                  </s-box>
                );
              })}
              <s-button type="submit">Submit return request</s-button>
            </s-stack>
          </Form>
        </s-section>
      )}

      {created && (
        <s-section heading="Confirmation">
          <s-paragraph>Your return is locked in.</s-paragraph>
          <s-paragraph>Request number: {(actionData as any).requestNumber || (actionData as any).requestId}</s-paragraph>
          <s-paragraph>Order: {(actionData as any).orderName}</s-paragraph>
          {(actionData as any).labelUrl && <s-link href={(actionData as any).labelUrl} target="_blank">Download return label</s-link>}
          <s-paragraph>What happens next: show the label/QR at a drop-off, pack the item, and we&apos;ll email you when it reaches our warehouse.</s-paragraph>
        </s-section>
      )}
    </s-page>
  );
}
