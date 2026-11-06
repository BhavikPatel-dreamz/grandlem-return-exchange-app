/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import {
  checkRateLimit,
  lookupAndValidateOrder,
  portalErrorCodeToMessage,
} from "../services/portal.server";
import { createReturnRequest } from "../services/returns.server";

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return {
    shop: url.searchParams.get("shop") || "",
    lang: (url.searchParams.get("lang") as "en" | "sv") || "en",
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
  const lang = (String(formData.get("lang") || "en") as "en" | "sv");
  const requestType = (String(formData.get("requestType") || "return") as "return" | "exchange" | "complaint");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`${ip}:${shop}`)) {
    return { ok: false, code: "RATE_LIMITED", message: portalErrorCodeToMessage("RATE_LIMITED", lang), lang } as const;
  }

  if (formData.get("_action") === "create_request") {
    const result = await lookupAndValidateOrder(shop, orderNumber, email, requestType);
    if (!result.ok) {
      return { ...result, message: portalErrorCodeToMessage(result.code, lang), lang } as const;
    }

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
      const file = formData.get(`photo_${id}`);
      if (file && typeof file !== "string" && (file as File).size > 0) {
        const f = file as File;
        if (!f.type.startsWith("image/")) {
          return { ok: false, code: "INVALID_INPUT", message: "Only image files are allowed.", lang } as const;
        }
        if (f.size > MAX_PHOTO_SIZE) {
          return { ok: false, code: "INVALID_INPUT", message: "Photo exceeds 5MB limit.", lang } as const;
        }
        photos.push({ url: await fileToDataUrl(f), fileName: f.name, mimeType: f.type, size: f.size });
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
      market: null,
      customerEmail: result.order.email,
      customerName: null,
      type: requestType,
      items,
    });

    return {
      ok: true,
      created: true,
      requestId: request.id,
      orderName: result.order.name,
      lang,
    } as const;
  }

  const result = await lookupAndValidateOrder(shop, orderNumber, email, requestType);
  if (!result.ok) {
    return { ...result, message: portalErrorCodeToMessage(result.code, lang), lang } as const;
  }
  return { ...result, message: portalErrorCodeToMessage("ORDER_NOT_FOUND", lang) === "" ? "" : "Order validated.", lang } as const;
};

export default function PortalPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const lang = (actionData && "lang" in actionData ? actionData.lang : loaderData.lang) as "en" | "sv";
  const hasOrder = !!actionData && "ok" in actionData && actionData.ok === true && !("created" in actionData);
  const created = !!actionData && "created" in actionData && actionData.created === true;

  const items = hasOrder ? (actionData as any).order.lineItems ?? [] : [];
  const reasons = hasOrder ? (actionData as any).reasons ?? [] : [];

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
                            {r.labelEn}
                          </s-option>
                        ))}
                      </s-select>
                      <s-text-field name={`comment_${li.id}`} label="Comment (optional)" />
                      <input type="file" name={`photo_${li.id}`} accept="image/*" />
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
          <s-paragraph>Your return request has been submitted.</s-paragraph>
          <s-paragraph>Request ID: {(actionData as any).requestId}</s-paragraph>
          <s-paragraph>Order: {(actionData as any).orderName}</s-paragraph>
        </s-section>
      )}
    </s-page>
  );
}
