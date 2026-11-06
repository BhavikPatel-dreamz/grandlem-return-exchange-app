/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { createWithdrawal } from "../services/withdrawal.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return { shop: url.searchParams.get("shop") || "", lang: (url.searchParams.get("lang") as "en" | "sv") || "en" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const shop = String(formData.get("shop") || "").trim();
  const lang = (String(formData.get("lang") || "en") as "en" | "sv");
  const stage = String(formData.get("_stage") || "lookup");

  if (stage === "confirm") {
    const orderNumber = String(formData.get("orderNumber") || "").trim();
    const email = String(formData.get("email") || "").trim();
    try {
      const result = await createWithdrawal(shop, orderNumber, email, lang);
      return { ok: true, created: true, ...result, lang };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Error", lang };
    }
  }

  const orderNumber = String(formData.get("orderNumber") || "").trim();
  const email = String(formData.get("email") || "").trim();
  if (!shop || !orderNumber || !email) {
    return { ok: false, message: "Missing required fields.", lang };
  }
  return { ok: true, readyToConfirm: true, shop, orderNumber, email, lang };
};

export default function WithdrawIndexPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shop = actionData && "shop" in actionData ? (actionData as any).shop : loaderData.shop;
  const lang = (actionData && "lang" in actionData ? (actionData as any).lang : loaderData.lang) as "en" | "sv";
  const confirmed = !!actionData && "created" in actionData && (actionData as any).created === true;

  return (
    <s-page heading="Withdraw from contract">
      {actionData && "ok" in actionData && actionData.ok === false && (
        <s-section heading="Error"><s-paragraph>{(actionData as any).message}</s-paragraph></s-section>
      )}

      {confirmed ? (
        <s-section heading="Withdrawal confirmed">
          <s-paragraph>Your withdrawal has been received.</s-paragraph>
          <s-paragraph>Order: {(actionData as any).orderName}</s-paragraph>
          <s-paragraph>Received at: {new Date((actionData as any).receivedAt).toLocaleString()}</s-paragraph>
          <s-paragraph>{(actionData as any).content}</s-paragraph>
        </s-section>
      ) : actionData && "readyToConfirm" in actionData ? (
        <s-section heading="Confirm withdrawal">
          <s-paragraph>Order: {(actionData as any).orderNumber}</s-paragraph>
          <Form method="post">
            <input type="hidden" name="shop" value={shop} />
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="orderNumber" value={(actionData as any).orderNumber} />
            <input type="hidden" name="email" value={(actionData as any).email} />
            <input type="hidden" name="_stage" value="confirm" />
            <s-button type="submit">Confirm withdrawal here</s-button>
          </Form>
        </s-section>
      ) : (
        <s-section heading="Find your order">
          <Form method="post">
            <input type="hidden" name="lang" value={lang} />
            <s-stack direction="block" gap="base">
              <s-text-field name="shop" label="Shop domain" value={shop} />
              <s-text-field name="orderNumber" label="Order number" />
              <s-email-field name="email" label="Email address" />
              <s-button type="submit">Continue</s-button>
            </s-stack>
          </Form>
        </s-section>
      )}
    </s-page>
  );
}