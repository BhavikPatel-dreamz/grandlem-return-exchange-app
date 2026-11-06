import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, Form, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getOrCreateSettings,
  updateSettings,
  parseJson,
} from "../services/settings.server";
import {
  listReturnReasons,
  createReturnReason,
  deleteReturnReason,
  updateReturnReason,
} from "../services/return-reasons.server";
import {
  listExclusionRules,
  createExclusionRule,
  deleteExclusionRule,
} from "../services/exclusion-rules.server";
import {
  listDeadlineExtensions,
  upsertDeadlineExtension,
  deleteDeadlineExtension,
} from "../services/deadline-extensions.server";
import { syncCarriers } from "../services/shippypro.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getOrCreateSettings(shop);
  const reasons = await listReturnReasons(shop);
  const exclusions = await listExclusionRules(shop);
  const deadlineExtensions = await listDeadlineExtensions(shop);
  return {
    shop,
    settings: {
      returnDeadlineDays: settings.returnDeadlineDays,
      exchangeDeadlineDays: settings.exchangeDeadlineDays,
      complaintDeadlineDays: settings.complaintDeadlineDays,
      autoRefundOnInspection: settings.autoRefundOnInspection,
      refundShippingCost: settings.refundShippingCost,
      claimRequiresPhoto: settings.claimRequiresPhoto,
      claimMinPhotos: settings.claimMinPhotos,
      claimMinCommentLength: settings.claimMinCommentLength,
      labelTimingPerMarket: parseJson<Record<string, string>>(settings.labelTimingPerMarket, {}),
      defaultReturnMethodPerMarket: parseJson<Record<string, unknown>>(settings.defaultReturnMethodPerMarket, {}),
    },
    reasons,
    exclusions,
    deadlineExtensions,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("_action") || "save_settings");

  try {
    if (intent === "save_settings") {
      await updateSettings(shop, {
        returnDeadlineDays: Number(formData.get("returnDeadlineDays")),
        exchangeDeadlineDays: Number(formData.get("exchangeDeadlineDays")),
        complaintDeadlineDays: Number(formData.get("complaintDeadlineDays")),
        autoRefundOnInspection: formData.get("autoRefundOnInspection") === "on",
        refundShippingCost: formData.get("refundShippingCost") === "on",
        claimRequiresPhoto: formData.get("claimRequiresPhoto") === "on",
        claimMinPhotos: Number(formData.get("claimMinPhotos")),
        claimMinCommentLength: Number(formData.get("claimMinCommentLength")),
      });
      return { ok: true, message: "Settings saved" };
    }

    if (intent === "create_reason") {
      await createReturnReason(shop, {
        labelEn: String(formData.get("labelEn") || ""),
        labelSv: String(formData.get("labelSv") || ""),
        appliesTo: String(formData.get("appliesTo") || "return,exchange,complaint"),
        autoRestock: formData.get("autoRestock") === "on",
      });
      return { ok: true, message: "Return reason created" };
    }

    if (intent === "delete_reason") {
      await deleteReturnReason(shop, String(formData.get("id")));
      return { ok: true, message: "Return reason deleted" };
    }

    if (intent === "toggle_reason") {
      const id = String(formData.get("id"));
      const active = formData.get("active") === "true";
      await updateReturnReason(shop, id, { active: !active });
      return { ok: true, message: "Return reason updated" };
    }

    if (intent === "create_exclusion") {
      await createExclusionRule(shop, {
        targetType: String(formData.get("targetType")) as "collection" | "product" | "variant",
        targetId: String(formData.get("targetId") || ""),
        appliesToReturns: formData.get("appliesToReturns") === "on",
        appliesToExchanges: formData.get("appliesToExchanges") === "on",
      });
      return { ok: true, message: "Exclusion rule created" };
    }

    if (intent === "delete_exclusion") {
      await deleteExclusionRule(shop, String(formData.get("id")));
      return { ok: true, message: "Exclusion rule deleted" };
    }

    if (intent === "create_deadline_extension") {
      await upsertDeadlineExtension(shop, {
        shopifyOrderId: String(formData.get("shopifyOrderId") || ""),
        type: String(formData.get("deadlineType")) as "return" | "exchange" | "complaint",
        newDeadline: new Date(String(formData.get("newDeadline"))),
        note: String(formData.get("note") || "") || undefined,
      });
      return { ok: true, message: "Deadline extension saved" };
    }

    if (intent === "delete_deadline_extension") {
      await deleteDeadlineExtension(shop, String(formData.get("id")));
      return { ok: true, message: "Deadline extension deleted" };
    }

    if (intent === "sync_carriers") {
      const result = await syncCarriers(shop);
      if (!result.ok) {
        return { ok: false, message: `Carrier sync failed: ${result.error}` };
      }
      const count = Array.isArray(result.data) ? result.data.length : 0;
      return { ok: true, message: `Carriers synced (${count}).` };
    }

    return { ok: false, message: "Unknown action" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error" };
  }
};


export function SettingsView() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data?.message, shopify]);

  return (
    <s-page heading="Return settings">
      <s-section heading="Deadlines (days)">
        <Form method="post">
          <input type="hidden" name="_action" value="save_settings" />
          <s-stack direction="block" gap="base">
            <s-number-field name="returnDeadlineDays" label="Return deadline" value={String(data.settings.returnDeadlineDays)} />
            <s-number-field name="exchangeDeadlineDays" label="Exchange deadline" value={String(data.settings.exchangeDeadlineDays)} />
            <s-number-field name="complaintDeadlineDays" label="Complaint deadline" value={String(data.settings.complaintDeadlineDays)} />
            <s-checkbox name="autoRefundOnInspection" label="Auto refund on inspection" defaultChecked={data.settings.autoRefundOnInspection} />
            <s-checkbox name="refundShippingCost" label="Include shipping in refunds" defaultChecked={data.settings.refundShippingCost} />
            <s-checkbox name="claimRequiresPhoto" label="Require photo for complaints" defaultChecked={data.settings.claimRequiresPhoto} />
            <s-number-field name="claimMinPhotos" label="Minimum photos per complaint item" value={String(data.settings.claimMinPhotos)} />
            <s-number-field name="claimMinCommentLength" label="Minimum comment length for complaints" value={String(data.settings.claimMinCommentLength)} />
            <s-button type="submit">Save deadlines</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Return reasons">
        <Form method="post">
          <input type="hidden" name="_action" value="create_reason" />
          <s-stack direction="block" gap="base">
            <s-text-field name="labelEn" label="Label (English)" />
            <s-text-field name="labelSv" label="Label (Swedish)" />
            <s-select name="appliesTo" label="Applies to">
              <s-option value="return,exchange,complaint">All</s-option>
              <s-option value="return">Return</s-option>
              <s-option value="exchange">Exchange</s-option>
              <s-option value="complaint">Complaint</s-option>
            </s-select>
            <s-checkbox name="autoRestock" label="Auto restock" />
            <s-button type="submit">Add reason</s-button>
          </s-stack>
        </Form>
        <s-unordered-list>
          {data.reasons.map((r) => (
            <s-list-item key={r.id}>
              {r.labelEn} {r.labelSv ? `(${r.labelSv})` : ""} — {r.appliesTo}{" "}
              <Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="_action" value="delete_reason" />
                <input type="hidden" name="id" value={r.id} />
                <s-button type="submit" variant="tertiary">Delete</s-button>
              </Form>
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

      <s-section heading="Exclusion rules">
        <Form method="post">
          <input type="hidden" name="_action" value="create_exclusion" />
          <s-stack direction="block" gap="base">
            <s-select name="targetType" label="Target type">
              <s-option value="collection">Collection</s-option>
              <s-option value="product">Product</s-option>
              <s-option value="variant">Variant</s-option>
            </s-select>
            <s-text-field name="targetId" label="Target ID (GID/numeric)" />
            <s-checkbox name="appliesToReturns" label="Applies to returns" defaultChecked />
            <s-checkbox name="appliesToExchanges" label="Applies to exchanges" defaultChecked />
            <s-button type="submit">Add exclusion</s-button>
          </s-stack>
        </Form>
        <s-unordered-list>
          {data.exclusions.map((e) => (
            <s-list-item key={e.id}>
              {e.targetType}: {e.targetId} (returns: {String(e.appliesToReturns)}, exchanges: {String(e.appliesToExchanges)}){" "}
              <Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="_action" value="delete_exclusion" />
                <input type="hidden" name="id" value={e.id} />
                <s-button type="submit" variant="tertiary">Delete</s-button>
              </Form>
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

      <s-section heading="ShippyPro carriers">
        <Form method="post">
          <input type="hidden" name="_action" value="sync_carriers" />
          <s-button type="submit">Re-sync carriers</s-button>
        </Form>
      </s-section>

      <s-section heading="Order-specific deadline extensions">
        <Form method="post">
          <input type="hidden" name="_action" value="create_deadline_extension" />
          <s-stack direction="block" gap="base">
            <s-text-field name="shopifyOrderId" label="Shopify Order ID" />
            <s-select name="deadlineType" label="Type">
              <s-option value="return">Return</s-option>
              <s-option value="exchange">Exchange</s-option>
              <s-option value="complaint">Complaint</s-option>
            </s-select>
            <s-date-field name="newDeadline" label="New deadline" />
            <s-text-field name="note" label="Note" />
            <s-button type="submit">Save extension</s-button>
          </s-stack>
        </Form>
        <s-unordered-list>
          {data.deadlineExtensions.map((d) => (
            <s-list-item key={d.id}>
              Order {d.shopifyOrderId} – {d.type}: {new Date(d.newDeadline).toLocaleDateString()}{" "}
              <Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="_action" value="delete_deadline_extension" />
                <input type="hidden" name="id" value={d.id} />
                <s-button type="submit" variant="tertiary">Delete</s-button>
              </Form>
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export default SettingsView;
export const headers: HeadersFunction = (a) => boundary.headers(a);
