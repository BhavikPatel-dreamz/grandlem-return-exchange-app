import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, Form, useLoaderData, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SettingsLayout } from "../components/admin/SettingsLayout";
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
import { syncCarriers, setShippyproApiKey, getShippyproConnection } from "../services/shippypro.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab");
  if (tab === "inspection") return redirect("/app/inspection");
  if (tab === "analytics") return redirect("/app/analytics");
  if (tab === "emails") return redirect("/app/email-templates");

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
    shippypro: await getShippyproConnection(shop),
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

    if (intent === "save_shippypro_key") {
      await setShippyproApiKey(
        shop,
        String(formData.get("shippyproApiKey") || ""),
        String(formData.get("shippyproApiUrl") || "").trim() || null,
      );
      return { ok: true, message: "ShippyPro connection saved" };
    }

    return { ok: false, message: "Unknown action" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error" };
  }
};


export function SettingsView() {
  const data = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<"general" | "compliance" | "extensions">("general");
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data?.message, shopify]);

  return (
    <SettingsLayout activeTab="settings">
      <div className="returbo-pills-bar">
        <button
          type="button"
          className={`returbo-pill-btn ${activeTab === "general" ? "active" : ""}`}
          onClick={() => setActiveTab("general")}
        >
          General
        </button>
        <button
          type="button"
          className={`returbo-pill-btn ${activeTab === "compliance" ? "active" : ""}`}
          onClick={() => setActiveTab("compliance")}
        >
          Compliance
        </button>
        <button
          type="button"
          className={`returbo-pill-btn ${activeTab === "extensions" ? "active" : ""}`}
          onClick={() => setActiveTab("extensions")}
        >
          Extensions & More
        </button>
      </div>

      <div style={{ display: activeTab === "general" ? "block" : "none" }}>
        <div className="returbo-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">Deadlines (days)</h2>
            <p className="returbo-card-subtitle">Set return, exchange, and complaint deadlines and claim requirements.</p>
          </div>
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
              <div>
                <s-button type="submit" variant="primary">Save deadlines</s-button>
              </div>
            </s-stack>
          </Form>
        </div>

        <div className="returbo-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">ShippyPro connection</h2>
            <p className="returbo-card-subtitle">Connect your ShippyPro account for automated carrier label generation.</p>
          </div>
          <p style={{ margin: "0 0 16px 0", fontSize: 13 }}>
            {data.shippypro.hasKey ? (
              <span className="returbo-badge returbo-badge-green">Key saved ({data.shippypro.hint || "****"})</span>
            ) : (
              <span className="returbo-badge returbo-badge-yellow">No per-shop key saved; using SHIPPYPRO_API_KEY env fallback.</span>
            )}
          </p>
          <Form method="post">
            <input type="hidden" name="_action" value="save_shippypro_key" />
            <s-stack direction="block" gap="base">
              <s-text-field name="shippyproApiKey" label="ShippyPro API key" />
              <s-text-field name="shippyproApiUrl" label="ShippyPro API URL (optional)" value={data.shippypro.apiUrl || ""} />
              <div>
                <s-button type="submit" variant="primary">Save connection</s-button>
              </div>
            </s-stack>
          </Form>
        </div>

        <div className="returbo-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">ShippyPro carriers</h2>
            <p className="returbo-card-subtitle">Synchronize available shipping carriers configured in your ShippyPro account.</p>
          </div>
          <Form method="post">
            <input type="hidden" name="_action" value="sync_carriers" />
            <div>
              <s-button type="submit">Re-sync carriers</s-button>
            </div>
          </Form>
        </div>
      </div>

      <div style={{ display: activeTab === "compliance" ? "block" : "none" }}>
        <div className="returbo-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">Return reasons</h2>
            <p className="returbo-card-subtitle">Configure reasons customers can select when initiating a return, exchange, or claim.</p>
          </div>
          <Form method="post" style={{ marginBottom: 20 }}>
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
              <div>
                <s-button type="submit" variant="primary">Add reason</s-button>
              </div>
            </s-stack>
          </Form>
          <div className="returbo-card-header" style={{ marginTop: 24, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Active Reasons ({data.reasons.length})</h3>
          </div>
          <div>
            {data.reasons.length === 0 && (
              <p style={{ color: "var(--returbo-text-muted)", fontSize: 13, margin: "12px 0" }}>No return reasons configured yet.</p>
            )}
            {data.reasons.map((r) => (
              <div key={r.id} className="returbo-list-item">
                <div>
                  <strong>{r.labelEn}</strong> {r.labelSv ? `(${r.labelSv})` : ""}{" "}
                  <span className="returbo-badge returbo-badge-gray" style={{ marginLeft: 6 }}>{r.appliesTo}</span>
                </div>
                <Form method="post" style={{ display: "inline" }}>
                  <input type="hidden" name="_action" value="delete_reason" />
                  <input type="hidden" name="id" value={r.id} />
                  <s-button type="submit" variant="tertiary">Delete</s-button>
                </Form>
              </div>
            ))}
          </div>
        </div>

        <div className="returbo-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">Exclusion rules</h2>
            <p className="returbo-card-subtitle">Specify products, collections, or variants excluded from returns or exchanges.</p>
          </div>
          <Form method="post" style={{ marginBottom: 20 }}>
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
              <div>
                <s-button type="submit" variant="primary">Add exclusion</s-button>
              </div>
            </s-stack>
          </Form>
          <div className="returbo-card-header" style={{ marginTop: 24, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Active Exclusion Rules ({data.exclusions.length})</h3>
          </div>
          <div>
            {data.exclusions.length === 0 && (
              <p style={{ color: "var(--returbo-text-muted)", fontSize: 13, margin: "12px 0" }}>No exclusion rules configured yet.</p>
            )}
            {data.exclusions.map((e) => (
              <div key={e.id} className="returbo-list-item">
                <div>
                  <strong>{e.targetType}</strong>: <code>{e.targetId}</code>{" "}
                  <span className="returbo-badge returbo-badge-gray" style={{ marginLeft: 6 }}>
                    returns: {String(e.appliesToReturns)} | exchanges: {String(e.appliesToExchanges)}
                  </span>
                </div>
                <Form method="post" style={{ display: "inline" }}>
                  <input type="hidden" name="_action" value="delete_exclusion" />
                  <input type="hidden" name="id" value={e.id} />
                  <s-button type="submit" variant="tertiary">Delete</s-button>
                </Form>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: activeTab === "extensions" ? "block" : "none" }}>
        <div className="returbo-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">Order-specific deadline extensions</h2>
            <p className="returbo-card-subtitle">Extend return or exchange deadlines for specific orders upon customer request.</p>
          </div>
          <Form method="post" style={{ marginBottom: 20 }}>
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
              <div>
                <s-button type="submit" variant="primary">Save extension</s-button>
              </div>
            </s-stack>
          </Form>
          <div className="returbo-card-header" style={{ marginTop: 24, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Active Extensions ({data.deadlineExtensions.length})</h3>
          </div>
          <div>
            {data.deadlineExtensions.length === 0 && (
              <p style={{ color: "var(--returbo-text-muted)", fontSize: 13, margin: "12px 0" }}>No order-specific deadline extensions.</p>
            )}
            {data.deadlineExtensions.map((d) => (
              <div key={d.id} className="returbo-list-item">
                <div>
                  <strong>Order {d.shopifyOrderId}</strong> – {d.type}: {new Date(d.newDeadline).toLocaleDateString()}{" "}
                  {d.note && <span style={{ color: "var(--returbo-text-muted)", fontSize: 13 }}>({d.note})</span>}
                </div>
                <Form method="post" style={{ display: "inline" }}>
                  <input type="hidden" name="_action" value="delete_deadline_extension" />
                  <input type="hidden" name="id" value={d.id} />
                  <s-button type="submit" variant="tertiary">Delete</s-button>
                </Form>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SettingsLayout>
  );
}

export default SettingsView;
export const headers: HeadersFunction = (a) => boundary.headers(a);
