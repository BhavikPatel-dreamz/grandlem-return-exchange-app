import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, Form, useLoaderData, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SettingsLayout } from "../components/admin/SettingsLayout";
import { ReturnReasonsSection } from "../components/admin/ReturnReasonsSection";
import { ReturnImageCommentSection } from "../components/admin/ReturnImageCommentSection";
import {
  getOrCreateSettings,
  updateSettings,
  parseJson,
  getReturnImageCommentConfig,
  updateReturnImageCommentConfig,
} from "../services/settings.server";
import {
  listReturnReasons,
  createReturnReason,
  updateReturnReason,
  ensureDefaultReturnReasons,
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

const ROUTING_MARKETS = ["DEFAULT", "US", "SE", "GB"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab");
  if (tab === "inspection") return redirect("/app/inspection");
  if (tab === "analytics") return redirect("/app/analytics");
  if (tab === "emails") return redirect("/app/email-templates");

  const settings = await getOrCreateSettings(shop);
  await ensureDefaultReturnReasons(shop);
  const reasons = await listReturnReasons(shop);
  const exclusions = await listExclusionRules(shop);
  const deadlineExtensions = await listDeadlineExtensions(shop);
  return {
    shop,
    settings: {
      returnDeadlineDays: settings.returnDeadlineDays,
      exchangeDeadlineDays: settings.exchangeDeadlineDays,
      autoApproveRequests: settings.autoApproveRequests,
      autoRefundOnInspection: settings.autoRefundOnInspection,
      refundShippingCost: settings.refundShippingCost,
      claimRequiresPhoto: settings.claimRequiresPhoto,
      claimMinPhotos: settings.claimMinPhotos,
      claimMinCommentLength: settings.claimMinCommentLength,
      labelTimingPerMarket: parseJson<Record<string, string>>(settings.labelTimingPerMarket, {}),
      defaultReturnMethodPerMarket: parseJson<Record<string, { carrierId?: string; service?: string }>>(settings.defaultReturnMethodPerMarket, {}),
      warehouseAddressesPerMarket: parseJson<Record<string, Record<string, string>>>(settings.warehouseAddressesPerMarket, {}),
    },
    reasons,
    exclusions,
    deadlineExtensions,
    shippypro: await getShippyproConnection(shop),
    returnImageCommentConfig: getReturnImageCommentConfig(settings),
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
        autoRefundOnInspection: formData.get("autoRefundOnInspection") === "on",
        refundShippingCost: formData.get("refundShippingCost") === "on",
        claimRequiresPhoto: formData.get("claimRequiresPhoto") === "on",
        claimMinPhotos: Number(formData.get("claimMinPhotos")),
        claimMinCommentLength: Number(formData.get("claimMinCommentLength")),
      });
      return { ok: true, message: "Settings saved" };
    }

    if (intent === "save_approval_settings") {
      await updateSettings(shop, {
        autoApproveRequests: formData.get("autoApproveRequests") === "true",
      });
      return { ok: true, message: "Approval settings saved" };
    }

    if (intent === "save_routing_settings") {
      const current = await getOrCreateSettings(shop);
      const timings = parseJson<Record<string, string>>(current.labelTimingPerMarket, {});
      const methods = parseJson<Record<string, { carrierId?: string; service?: string }>>(current.defaultReturnMethodPerMarket, {});
      const warehouses = parseJson<Record<string, Record<string, string>>>(current.warehouseAddressesPerMarket, {});

      for (const market of ROUTING_MARKETS) {
        timings[market] = String(formData.get(`labelTiming_${market}`) || "after_approval") === "immediate"
          ? "immediate"
          : "after_approval";

        const method = {
          carrierId: String(formData.get(`carrierId_${market}`) || "").trim(),
          service: String(formData.get(`service_${market}`) || "").trim(),
        };
        if (method.carrierId || method.service) methods[market] = method;
        else delete methods[market];

        const address = Object.fromEntries(
          ["name", "company", "address1", "address2", "city", "zip", "country"].map((field) => [
            field,
            String(formData.get(`${field}_${market}`) || "").trim(),
          ]),
        );
        if (Object.values(address).some(Boolean)) warehouses[market] = address;
        else delete warehouses[market];
      }

      await updateSettings(shop, {
        labelTimingPerMarket: timings as Record<string, "immediate" | "after_approval">,
        defaultReturnMethodPerMarket: methods,
        warehouseAddressesPerMarket: warehouses,
      });
      return { ok: true, message: "Return routing settings saved" };
    }

    if (intent === "save_return_reasons") {
      const allReasons = await listReturnReasons(shop);
      for (const r of allReasons) {
        const activeVal = formData.get(`reason_active_${r.id}`);
        if (activeVal !== null) {
          await updateReturnReason(shop, r.id, { active: activeVal === "on" });
        }
      }
      return { ok: true, message: "Return reasons updated successfully" };
    }

    if (intent === "create_custom_reason") {
      const labelEn = String(formData.get("labelEn") || "").trim();
      const appliesTo = String(formData.get("appliesTo") || "return,exchange");
      if (labelEn) {
        await createReturnReason(shop, {
          labelEn,
          appliesTo,
          active: true,
          autoRestock: false,
        });
        return { ok: true, message: "Custom reason added" };
      }
      return { ok: false, message: "Please enter a reason name" };
    }

    if (intent === "create_sub_reason") {
      const labelEn = String(formData.get("labelEn") || "").trim();
      const parentLabel = String(formData.get("parentLabel") || "").trim();
      const appliesTo = String(formData.get("appliesTo") || "return,exchange");
      if (labelEn) {
        await createReturnReason(shop, {
          labelEn,
          parentLabel,
          appliesTo,
          active: true,
          autoRestock: false,
        });
        return { ok: true, message: `Sub-reason "${labelEn}" added` };
      }
      return { ok: false, message: "Please enter a sub-reason name" };
    }

    if (intent === "update_reason_code") {
      const reasonId = String(formData.get("reasonId"));
      const code = String(formData.get("code") || "").trim();
      // labelSv removed - Swedish support removed
      return { ok: true, message: "Reason code updated" };
    }

    if (intent === "archive_reason") {
      const reasonId = String(formData.get("reasonId"));
      await updateReturnReason(shop, reasonId, { active: false });
      return { ok: true, message: "Reason archived" };
    }

    if (intent === "unarchive_reason") {
      const reasonId = String(formData.get("reasonId"));
      await updateReturnReason(shop, reasonId, { active: true });
      return { ok: true, message: "Reason restored from archive" };
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

    if (intent === "save_return_image_comment_config") {
      const enabled = formData.get("enabled") === "true";
      const imageUploadMode = String(formData.get("imageUploadMode") || "optional") as "optional" | "mandatory" | "disabled";
      const maxPhotos = Number(formData.get("maxPhotos") || 1);
      const includeInstructions = formData.get("includeInstructions") === "on";
      const instructions = String(formData.get("instructions") || "").slice(0, 60);
      const commentMode = String(formData.get("commentMode") || "optional") as "optional" | "mandatory" | "disabled";

      await updateReturnImageCommentConfig(shop, {
        enabled,
        imageUploadMode,
        maxPhotos,
        includeInstructions,
        instructions,
        commentMode,
      });
      return { ok: true, message: "Return image and comment options saved" };
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
        <ReturnReasonsSection reasons={data.reasons} />

        <div className="returbo-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">Deadlines (days)</h2>
            <p className="returbo-card-subtitle">Set return and exchange deadlines and claim requirements.</p>
          </div>
          <Form method="post">
            <input type="hidden" name="_action" value="save_settings" />
            <s-stack direction="block" gap="base">
              <s-number-field name="returnDeadlineDays" label="Return deadline" value={String(data.settings.returnDeadlineDays)} />
              <s-number-field name="exchangeDeadlineDays" label="Exchange deadline" value={String(data.settings.exchangeDeadlineDays)} />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" name="autoRefundOnInspection" defaultChecked={data.settings.autoRefundOnInspection} style={{ accentColor: "var(--returbo-pink)" }} />
                <span>Auto refund on inspection</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" name="refundShippingCost" defaultChecked={data.settings.refundShippingCost} style={{ accentColor: "var(--returbo-pink)" }} />
                <span>Include shipping in refunds</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" name="claimRequiresPhoto" defaultChecked={data.settings.claimRequiresPhoto} style={{ accentColor: "var(--returbo-pink)" }} />
                <span>Require photo for complaints</span>
              </label>
              <s-number-field name="claimMinPhotos" label="Minimum photos per complaint item" value={String(data.settings.claimMinPhotos)} />
              <s-number-field name="claimMinCommentLength" label="Minimum comment length for complaints" value={String(data.settings.claimMinCommentLength)} />
              <div>
                <button type="submit" className="returbo-btn-primary">Save deadlines</button>
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
                <button type="submit" className="returbo-btn-primary">Save connection</button>
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
              <button type="submit" className="returbo-btn-primary">Re-sync carriers</button>
            </div>
          </Form>
        </div>

        <div className="returbo-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">Return labels and routing</h2>
            <p className="returbo-card-subtitle">Choose when labels are created and configure each destination and fallback carrier by shipping country.</p>
          </div>
          <Form method="post">
            <input type="hidden" name="_action" value="save_routing_settings" />
            <s-stack direction="block" gap="base">
              {ROUTING_MARKETS.map((market) => {
                const address = data.settings.warehouseAddressesPerMarket[market] || {};
                const method = data.settings.defaultReturnMethodPerMarket[market] || {};
                return (
                  <fieldset key={market} style={{ border: "1px solid var(--returbo-border)", borderRadius: 8, padding: 16 }}>
                    <legend style={{ fontWeight: 600, padding: "0 6px" }}>{market === "DEFAULT" ? "Default fallback" : `${market} shipping country`}</legend>
                    <s-stack direction="block" gap="base">
                      <s-select name={`labelTiming_${market}`} label="Label generation timing" value={data.settings.labelTimingPerMarket[market] || "after_approval"}>
                        <s-option value="after_approval">After admin approval</s-option>
                        <s-option value="immediate">Immediately after request</s-option>
                      </s-select>
                      <s-text-field name={`carrierId_${market}`} label="Fallback ShippyPro Carrier ID" value={method.carrierId || ""} />
                      <s-text-field name={`service_${market}`} label="Fallback carrier service" value={method.service || ""} />
                      <s-text-field name={`name_${market}`} label="Return warehouse name" value={address.name || ""} />
                      <s-text-field name={`company_${market}`} label="Company" value={address.company || ""} />
                      <s-text-field name={`address1_${market}`} label="Address" value={address.address1 || address.address || ""} />
                      <s-text-field name={`address2_${market}`} label="Address line 2" value={address.address2 || ""} />
                      <s-text-field name={`city_${market}`} label="City" value={address.city || ""} />
                      <s-text-field name={`zip_${market}`} label="Postal code" value={address.zip || ""} />
                      <s-text-field name={`country_${market}`} label="Country" value={address.country || ""} />
                    </s-stack>
                  </fieldset>
                );
              })}
              <div style={{ width: "fit-content" }}>
                <button type="submit" className="returbo-btn-primary">Save return routing</button>
              </div>
            </s-stack>
          </Form>
        </div>
      </div>

      <div style={{ display: activeTab === "compliance" ? "block" : "none" }}>
        <ReturnImageCommentSection config={data.returnImageCommentConfig} />

        <div className="returbo-card" style={{ marginBottom: 24 }}>
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">Reviewing and pre-approving return requests</h2>
            <p className="returbo-card-subtitle">
              Choose whether requests are approved automatically or held for manual review before labels are sent. Automatic approval does not issue refunds; refunds still follow your normal review process.
            </p>
          </div>
          <Form method="post">
            <input type="hidden" name="_action" value="save_approval_settings" />
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <input
                  type="radio"
                  id="auto-approve-requests-yes"
                  aria-labelledby="auto-approve-requests-yes-label"
                  name="autoApproveRequests"
                  value="true"
                  defaultChecked={data.settings.autoApproveRequests}
                  style={{ accentColor: "var(--returbo-pink)" }}
                />
                <span id="auto-approve-requests-yes-label"><strong>Automatically pre-approve all your return requests</strong></span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <input
                  type="radio"
                  id="auto-approve-requests-no"
                  aria-labelledby="auto-approve-requests-no-label"
                  name="autoApproveRequests"
                  value="false"
                  defaultChecked={!data.settings.autoApproveRequests}
                  style={{ accentColor: "var(--returbo-pink)" }}
                />
                <span id="auto-approve-requests-no-label"><strong>Manually pre-approve all your return requests</strong></span>
              </div>
            </div>
            <button type="submit" className="returbo-btn-primary">Save approval settings</button>
          </Form>
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
                <button type="submit" className="returbo-btn-primary">Add exclusion</button>
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
                <button type="submit" className="returbo-btn-primary">Save extension</button>
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
