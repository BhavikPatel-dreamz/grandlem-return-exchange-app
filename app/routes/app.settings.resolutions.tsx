/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateSettings, updateSettings } from "../services/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getOrCreateSettings(shop);
  return {
    shop,
    settings: {
      deflectionEnabled: settings.deflectionEnabled,
      storeCreditEnabled: settings.storeCreditEnabled,
      storeCreditMethod: settings.storeCreditMethod,
      storeCreditBonusPercent: settings.storeCreditBonusPercent,
      storeCreditIssueTiming: settings.storeCreditIssueTiming,
      complaintResolutionMode: settings.complaintResolutionMode,
      complaintRequireItemReturn: settings.complaintRequireItemReturn,
      exchangeShipTiming: settings.exchangeShipTiming,
      exchangeReserveDays: settings.exchangeReserveDays,
      offerCreditWhenUnavailable: settings.offerCreditWhenUnavailable,
      clawBackFreeItems: settings.clawBackFreeItems,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  try {
    await updateSettings(shop, {
      deflectionEnabled: formData.get("deflectionEnabled") === "on",
      storeCreditEnabled: formData.get("storeCreditEnabled") === "on",
      storeCreditMethod: String(formData.get("storeCreditMethod") || "gift_card"),
      storeCreditBonusPercent: Number(formData.get("storeCreditBonusPercent")),
      storeCreditIssueTiming: String(formData.get("storeCreditIssueTiming") || "on_inspection"),
      complaintResolutionMode: String(formData.get("complaintResolutionMode") || "customer_chooses"),
      complaintRequireItemReturn: formData.get("complaintRequireItemReturn") === "on",
      exchangeShipTiming: String(formData.get("exchangeShipTiming") || "SHIP_IMMEDIATELY"),
      exchangeReserveDays: Number(formData.get("exchangeReserveDays")),
      offerCreditWhenUnavailable: formData.get("offerCreditWhenUnavailable") === "on",
      clawBackFreeItems: formData.get("clawBackFreeItems") === "on",
    });
    return { ok: true, message: "Resolution settings saved" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error" };
  }
};

export default function ResolutionSettingsPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();
  useEffect(() => {
    if (actionData?.message) shopify.toast.show(actionData.message);
  }, [actionData?.message, shopify]);

  return (
    <s-page heading="Resolution & store credit settings">
      {actionData?.message && <s-banner>{actionData.message}</s-banner>}
      <Form method="post">
        <input type="hidden" name="_action" value="save_settings" />
        <s-stack direction="block" gap="base">
          <s-checkbox name="deflectionEnabled" label="Enable refund deflection" defaultChecked={data.settings.deflectionEnabled} />
          <s-checkbox name="storeCreditEnabled" label="Enable store credit" defaultChecked={data.settings.storeCreditEnabled} />
          <s-select name="storeCreditMethod" label="Store credit method" value={data.settings.storeCreditMethod}>
            <s-option value="gift_card">Gift card</s-option>
            <s-option value="store_credit">Shopify store credit</s-option>
          </s-select>
          <s-number-field name="storeCreditBonusPercent" label="Store credit bonus %" value={String(data.settings.storeCreditBonusPercent)} />
          <s-select name="storeCreditIssueTiming" label="Issue timing" value={data.settings.storeCreditIssueTiming}>
            <s-option value="on_submit">On submit</s-option>
            <s-option value="on_approval">On approval</s-option>
            <s-option value="on_inspection">On inspection</s-option>
          </s-select>
          <s-section heading="Complaints">
            <s-select name="complaintResolutionMode" label="Complaint resolution flow" value={data.settings.complaintResolutionMode}>
              <s-option value="customer_chooses">Let customer choose replacement or refund</s-option>
              <s-option value="always_replacement">Always replacement</s-option>
              <s-option value="always_refund">Always refund</s-option>
            </s-select>
            <s-checkbox name="complaintRequireItemReturn" label="Require faulty item to be returned" defaultChecked={data.settings.complaintRequireItemReturn} />
          </s-section>
          <s-section heading="Advanced exchanges">
            <s-select name="exchangeShipTiming" label="Ship timing" value={data.settings.exchangeShipTiming}>
              <s-option value="SHIP_IMMEDIATELY">Ship immediately</s-option>
              <s-option value="AFTER_IN_TRANSIT">After in transit</s-option>
              <s-option value="AFTER_INSPECTED">After inspected</s-option>
            </s-select>
            <s-number-field name="exchangeReserveDays" label="Reserve days" value={String(data.settings.exchangeReserveDays)} />
            <s-checkbox name="offerCreditWhenUnavailable" label="Offer store credit when unavailable" defaultChecked={data.settings.offerCreditWhenUnavailable} />
          </s-section>
          <s-section heading="Smart refunds">
            <s-checkbox name="clawBackFreeItems" label="Claw back free/discounted benefit" defaultChecked={data.settings.clawBackFreeItems} />
          </s-section>
          <s-button type="submit">Save</s-button>
        </s-stack>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);