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
import prisma from "../db.server";
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
const DEADLINE_UNIT_DAYS = { days: 1, weeks: 7, months: 30 } as const;

function deadlineDaysFromForm(formData: FormData, prefix: "returnDeadline" | "exchangeDeadline") {
  const amount = Number(formData.get(`${prefix}Days`));
  const unit = String(formData.get(`${prefix}Unit`) || "days") as keyof typeof DEADLINE_UNIT_DAYS;
  return Math.round(amount * (DEADLINE_UNIT_DAYS[unit] || 1));
}

function deadlineDisplay(days: number) {
  if (days > 0 && days % 30 === 0) return { amount: days / 30, unit: "months" };
  if (days > 0 && days % 7 === 0) return { amount: days / 7, unit: "weeks" };
  return { amount: days, unit: "days" };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab");
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
    carriers: await prisma.carrier.findMany({
      where: { shop },
      orderBy: { name: "asc" },
      select: { id: true, shippyproCarrierId: true, name: true, service: true, syncedAt: true },
    }),
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
        returnDeadlineDays: deadlineDaysFromForm(formData, "returnDeadline"),
        exchangeDeadlineDays: deadlineDaysFromForm(formData, "exchangeDeadline"),
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
        newDeadline: new Date(`${String(formData.get("newDeadline") || "")}T23:59:59.999Z`),
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


const MARKET_INFO: Record<string, { label: string; flag: string; badge: string; description: string }> = {
  DEFAULT: {
    label: "Default",
    flag: "🌐",
    badge: "All other markets",
    description: "Destination and carrier rules for all customer return requests not covered by a specific country rule.",
  },
  US: {
    label: "United States",
    flag: "🇺🇸",
    badge: "US",
    description: "Destination warehouse and carrier configuration for return orders shipped from the United States.",
  },
  SE: {
    label: "Sweden",
    flag: "🇸🇪",
    badge: "SE",
    description: "Destination warehouse and carrier configuration for return orders shipped from Sweden.",
  },
  GB: {
    label: "United Kingdom",
    flag: "🇬🇧",
    badge: "GB",
    description: "Destination warehouse and carrier configuration for return orders shipped from the United Kingdom.",
  },
};

export function SettingsView() {
  const data = useLoaderData<typeof loader>();
  const returnDeadline = deadlineDisplay(data.settings.returnDeadlineDays ?? 14);
  const exchangeDeadline = deadlineDisplay(data.settings.exchangeDeadlineDays ?? 14);
  const [activeTab, setActiveTab] = useState<"general" | "compliance" | "integrations">("general");
  const [showExtendForm, setShowExtendForm] = useState(false);
  const [selectedRoutingMarket, setSelectedRoutingMarket] = useState<string>("DEFAULT");
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
          className={`returbo-pill-btn ${activeTab === "integrations" ? "active" : ""}`}
          onClick={() => setActiveTab("integrations")}
        >
          Integrations
        </button>
      </div>

      <div style={{ display: activeTab === "general" ? "block" : "none" }}>
        <ReturnReasonsSection reasons={data.reasons} />

        {/* Request deadline card */}
        <div className="returbo-card" style={{ marginBottom: 22 }}>
          <div className="returbo-card-header" style={{ marginBottom: 18, paddingBottom: 0, borderBottom: "none" }}>
            <h2 className="returbo-card-title" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 6px 0" }}>
              Request deadline
            </h2>
            <p className="returbo-card-subtitle" style={{ fontSize: 12.5, color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
              You can limit the time that a customer has to send in any request from the time the order was fulfilled.
            </p>
          </div>

          <Form method="post">
            <input type="hidden" name="_action" value="save_settings" />

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Returns */}
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#111827", marginBottom: 6 }}>
                  Returns
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "#374151" }}>
                  <input
                    type="number"
                    name="returnDeadlineDays"
                    defaultValue={String(returnDeadline.amount)}
                    style={{
                      width: 58,
                      height: 34,
                      textAlign: "center",
                      border: "1px solid #d1d5db",
                      borderRadius: 4,
                      fontSize: 12.5,
                      color: "#111827",
                      background: "#ffffff",
                      boxSizing: "border-box",
                    }}
                  />
                  <select
                    name="returnDeadlineUnit"
                    defaultValue={returnDeadline.unit}
                    style={{
                      height: 34,
                      padding: "0 8px",
                      border: "1px solid #d1d5db",
                      borderRadius: 4,
                      fontSize: 12.5,
                      color: "#111827",
                      background: "#ffffff",
                      cursor: "pointer",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="days">Days</option>
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                  </select>
                  <span>
                    is the general allowed period to submit a <strong>return request</strong> after the item has been shipped.
                  </span>
                  <span title="Allowed period after shipment" style={{ color: "#9ca3af", cursor: "help", display: "inline-flex", alignItems: "center" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </span>
                </div>
              </div>

              {/* Exchanges */}
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#111827", marginBottom: 6 }}>
                  Exchanges
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "#374151" }}>
                  <input
                    type="number"
                    name="exchangeDeadlineDays"
                    defaultValue={String(exchangeDeadline.amount)}
                    style={{
                      width: 58,
                      height: 34,
                      textAlign: "center",
                      border: "1px solid #d1d5db",
                      borderRadius: 4,
                      fontSize: 12.5,
                      color: "#111827",
                      background: "#ffffff",
                      boxSizing: "border-box",
                    }}
                  />
                  <select
                    name="exchangeDeadlineUnit"
                    defaultValue={exchangeDeadline.unit}
                    style={{
                      height: 34,
                      padding: "0 8px",
                      border: "1px solid #d1d5db",
                      borderRadius: 4,
                      fontSize: 12.5,
                      color: "#111827",
                      background: "#ffffff",
                      cursor: "pointer",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="days">Days</option>
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                  </select>
                  <span>
                    is the general allowed period to submit an <strong>exchange request</strong> after the item has been shipped.
                  </span>
                </div>
              </div>

              {/* Inspection and Claim Requirements */}
              <div style={{ marginTop: 14, paddingTop: 16, borderTop: "1px solid #f1f5f9", display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    name="autoRefundOnInspection"
                    defaultChecked={data.settings.autoRefundOnInspection}
                    style={{ width: 15, height: 15, accentColor: "#de4066", cursor: "pointer" }}
                  />
                  <span>Auto refund on inspection</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    name="refundShippingCost"
                    defaultChecked={data.settings.refundShippingCost}
                    style={{ width: 15, height: 15, accentColor: "#de4066", cursor: "pointer" }}
                  />
                  <span>Include shipping in refunds</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    name="claimRequiresPhoto"
                    defaultChecked={data.settings.claimRequiresPhoto}
                    style={{ width: 15, height: 15, accentColor: "#de4066", cursor: "pointer" }}
                  />
                  <span>Require photo for complaints</span>
                </label>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 4 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#374151" }}>
                    <span>Minimum photos per complaint:</span>
                    <input
                      type="number"
                      name="claimMinPhotos"
                      defaultValue={String(data.settings.claimMinPhotos)}
                      style={{ width: 50, height: 30, textAlign: "center", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 12.5 }}
                    />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#374151" }}>
                    <span>Minimum comment length for complaints:</span>
                    <input
                      type="number"
                      name="claimMinCommentLength"
                      defaultValue={String(data.settings.claimMinCommentLength)}
                      style={{ width: 50, height: 30, textAlign: "center", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 12.5 }}
                    />
                  </label>
                </div>
              </div>

              {/* Submit Button */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button
                  type="submit"
                  style={{
                    backgroundColor: "#de4066",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 20px",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(222, 64, 102, 0.2)",
                  }}
                >
                  Save changes
                </button>
              </div>
            </div>
          </Form>
        </div>

        {/* Extending deadline on a specific order card */}
        <div className="returbo-card" style={{ marginBottom: 22 }}>
          <div className="returbo-card-header" style={{ marginBottom: 14, paddingBottom: 0, borderBottom: "none" }}>
            <h2 className="returbo-card-title" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 6px 0" }}>
              Extending deadline on a specific order
            </h2>
            <p className="returbo-card-subtitle" style={{ fontSize: 12.5, color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
              Extend the deadline on a specific order, so that the customer can still submit a request even after the general deadline has passed.
            </p>
          </div>

          {!showExtendForm ? (
            <button
              type="button"
              onClick={() => setShowExtendForm(true)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: "#de4066",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>+ Extend deadline on specific order</span>
            </button>
          ) : (
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "16px 18px", marginTop: 10 }}>
              <Form method="post">
                <input type="hidden" name="_action" value="create_deadline_extension" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Shopify Order ID</label>
                    <input
                      type="text"
                      name="shopifyOrderId"
                      placeholder="e.g. 1021"
                      required
                      style={{ width: "100%", height: 34, border: "1px solid #d1d5db", borderRadius: 6, padding: "0 10px", fontSize: 13, boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Type</label>
                    <select
                      name="deadlineType"
                      style={{ width: "100%", height: 34, border: "1px solid #d1d5db", borderRadius: 6, padding: "0 10px", fontSize: 13, boxSizing: "border-box", background: "#ffffff" }}
                    >
                      <option value="return">Return</option>
                      <option value="exchange">Exchange</option>
                      <option value="complaint">Complaint</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>New deadline</label>
                    <input
                      type="date"
                      name="newDeadline"
                      required
                      style={{ width: "100%", height: 34, border: "1px solid #d1d5db", borderRadius: 6, padding: "0 10px", fontSize: 13, boxSizing: "border-box", background: "#ffffff" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Note (optional)</label>
                    <input
                      type="text"
                      name="note"
                      placeholder="Reason for extension"
                      style={{ width: "100%", height: 34, border: "1px solid #d1d5db", borderRadius: 6, padding: "0 10px", fontSize: 13, boxSizing: "border-box" }}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setShowExtendForm(false)}
                    style={{ background: "#ffffff", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 14px", fontSize: 12.5, fontWeight: 500, color: "#374151", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{ backgroundColor: "#de4066", color: "#ffffff", border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    Save extension
                  </button>
                </div>
              </Form>
            </div>
          )}

          {/* Active Extensions List */}
          {data.deadlineExtensions.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1f5f9" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 8 }}>
                Active Extensions ({data.deadlineExtensions.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.deadlineExtensions.map((d: any) => (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 6, background: "#fafafa" }}>
                    <div style={{ fontSize: 12.5, color: "#1f2937" }}>
                      <strong>Order {d.shopifyOrderId}</strong> – {d.type}: {new Date(d.newDeadline).toLocaleDateString()}{" "}
                      {d.note && <span style={{ color: "#6b7280" }}>({d.note})</span>}
                    </div>
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="_action" value="delete_deadline_extension" />
                      <input type="hidden" name="id" value={d.id} />
                      <button
                        type="submit"
                        style={{ background: "none", border: "none", color: "#ef4444", fontSize: 12, cursor: "pointer", fontWeight: 500 }}
                      >
                        Delete
                      </button>
                    </Form>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>

      <div style={{ display: activeTab === "compliance" ? "block" : "none" }}>
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

        <ReturnImageCommentSection config={data.returnImageCommentConfig} />

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

      <div style={{ display: activeTab === "integrations" ? "block" : "none" }}>
        {/* ShippyPro connection */}
        <div className="returbo-card" style={{ marginBottom: 22 }}>
          <div className="returbo-card-header" style={{ marginBottom: 18, paddingBottom: 0, borderBottom: "none" }}>
            <h2 className="returbo-card-title" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 6px 0" }}>
              ShippyPro connection
            </h2>
            <p className="returbo-card-subtitle" style={{ fontSize: 12.5, color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
              Connect your ShippyPro account for automated carrier label generation.
            </p>
          </div>

          {data.shippypro.hasKey ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 20,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#166534" }}>
                  ShippyPro Connected
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#15803d" }}>
                  API key is saved ({data.shippypro.hint || "****"}). Automated label generation is active.
                </p>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "#fffbeb",
                border: "1px solid #fef3c7",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 20,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                  No per-shop key saved
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#b45309" }}>
                  Using <code>SHIPPYPRO_API_KEY</code> env fallback. Enter a custom key below to configure a dedicated connection.
                </p>
              </div>
            </div>
          )}

          <fetcher.Form method="post">
            <input type="hidden" name="_action" value="save_shippypro_key" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 20 }}>
              <div>
                <label htmlFor="shippyproApiKey" style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                  ShippyPro API key <span style={{ color: "#de4066" }}>*</span>
                </label>
                <input
                  id="shippyproApiKey"
                  type="password"
                  name="shippyproApiKey"
                  placeholder={data.shippypro.hasKey ? "Enter new API key to replace current" : "Enter your ShippyPro API key"}
                  className="returbo-detail-input"
                  style={{ width: "100%", height: 38 }}
                />
                <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#64748b" }}>
                  Generate your API key in ShippyPro &gt; Integrations &gt; API.
                </p>
              </div>

              <div>
                <label htmlFor="shippyproApiUrl" style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                  ShippyPro API URL <span style={{ color: "#64748b", fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  id="shippyproApiUrl"
                  type="text"
                  name="shippyproApiUrl"
                  defaultValue={data.shippypro.apiUrl || ""}
                  placeholder="https://www.shippypro.com/api"
                  className="returbo-detail-input"
                  style={{ width: "100%", height: 38 }}
                />
                <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#64748b" }}>
                  Leave empty to use default production endpoint.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                type="submit"
                className="returbo-btn-primary"
                disabled={fetcher.state === "submitting"}
                style={{
                  backgroundColor: "#de4066",
                  borderColor: "#de4066",
                  borderRadius: 6,
                  padding: "9px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {fetcher.state === "submitting" ? "Saving..." : "Save connection"}
              </button>
              {fetcher.data?.message === "ShippyPro connection saved" && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#16a34a", fontSize: 13, fontWeight: 600 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  ShippyPro connection saved
                </span>
              )}
            </div>
          </fetcher.Form>
        </div>

        {/* ShippyPro carriers */}
        <div className="returbo-card" style={{ marginBottom: 22 }}>
          <div className="returbo-card-header" style={{ marginBottom: 18, paddingBottom: 0, borderBottom: "none" }}>
            <h2 className="returbo-card-title" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 6px 0" }}>
              ShippyPro carriers
            </h2>
            <p className="returbo-card-subtitle" style={{ fontSize: 12.5, color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
              Synchronize available shipping carriers configured in your ShippyPro account.
            </p>
          </div>

          {data.carriers && data.carriers.length > 0 ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                  Synchronized Carriers ({data.carriers.length})
                </span>
                {data.carriers[0]?.syncedAt && (
                  <span style={{ fontSize: 11.5, color: "#64748b" }}>
                    Last synced: {new Date(data.carriers[0].syncedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {data.carriers.map((c: any) => (
                  <div
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                      background: "#f8fafc",
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#de4066" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <rect x="1" y="3" width="15" height="13" />
                      <polygon points="16 8 20 8 23 11 23 16 16 16 8" />
                      <circle cx="5.5" cy="18.5" r="2.5" />
                      <circle cx="18.5" cy="18.5" r="2.5" />
                    </svg>
                    <div style={{ overflow: "hidden" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                        {c.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: "#64748b" }}>
                        ID: <code style={{ color: "#334155" }}>{c.shippyproCarrierId}</code>{c.service ? ` • ${c.service}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "14px 16px",
                marginBottom: 18,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              <p style={{ margin: 0, fontSize: 12.5, color: "#475569", lineHeight: 1.5 }}>
                No carriers synchronized yet. Click <strong>Re-sync carriers</strong> below to fetch your active carriers from ShippyPro.
              </p>
            </div>
          )}

          <fetcher.Form method="post">
            <input type="hidden" name="_action" value="sync_carriers" />
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                type="submit"
                className="returbo-btn-primary"
                disabled={fetcher.state === "submitting"}
                style={{
                  backgroundColor: "#de4066",
                  borderColor: "#de4066",
                  borderRadius: 6,
                  padding: "9px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                <span>{fetcher.state === "submitting" ? "Syncing..." : "Re-sync carriers"}</span>
              </button>

              {fetcher.data?.message?.startsWith("Carriers synced") && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#16a34a", fontSize: 13, fontWeight: 600 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {fetcher.data.message}
                </span>
              )}
            </div>
          </fetcher.Form>
        </div>

        <div className="returbo-card">
          <div className="returbo-card-header" style={{ marginBottom: 18, paddingBottom: 0, borderBottom: "none" }}>
            <h2 className="returbo-card-title" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 6px 0" }}>
              Return labels and routing
            </h2>
            <p className="returbo-card-subtitle" style={{ fontSize: 12.5, color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
              Choose when labels are created and configure each destination and carrier by shipping country.
            </p>
          </div>

          <fetcher.Form method="post">
            <input type="hidden" name="_action" value="save_routing_settings" />

            {/* Market Selection Tabs */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #f1f5f9" }}>
              {ROUTING_MARKETS.map((market) => {
                const isSelected = selectedRoutingMarket === market;
                const info = MARKET_INFO[market];
                return (
                  <button
                    key={market}
                    type="button"
                    onClick={() => setSelectedRoutingMarket(market)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 14px",
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: isSelected ? 600 : 500,
                      border: isSelected ? "1.5px solid #de4066" : "1px solid #e2e8f0",
                      background: isSelected ? "#fff0f3" : "#ffffff",
                      color: isSelected ? "#de4066" : "#475569",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span style={{ fontSize: 16, lineHeight: 1 }}>{info.flag}</span>
                    <span>{info.label}</span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: isSelected ? "rgba(222, 64, 102, 0.12)" : "#f1f5f9",
                        color: isSelected ? "#de4066" : "#64748b",
                        fontWeight: 600,
                      }}
                    >
                      {info.badge}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Markets Panels (All kept in DOM for form submission) */}
            {ROUTING_MARKETS.map((market) => {
              const address = data.settings.warehouseAddressesPerMarket[market] || {};
              const method = data.settings.defaultReturnMethodPerMarket[market] || {};
              const info = MARKET_INFO[market];
              const isVisible = selectedRoutingMarket === market;

              return (
                <div key={market} style={{ display: isVisible ? "block" : "none" }}>
                  {/* Market info banner */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "12px 16px",
                      marginBottom: 18,
                    }}
                  >
                    <span style={{ fontSize: 24, lineHeight: 1 }}>{info.flag}</span>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{info.label}</span>
                        <span className="returbo-badge returbo-badge-pink" style={{ fontSize: 11 }}>{info.badge}</span>
                      </div>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.4 }}>{info.description}</p>
                    </div>
                  </div>

                  {/* Section 1: Label Timing & Carrier */}
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "18px 20px",
                      marginBottom: 18,
                      background: "#ffffff",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#de4066" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="1" y="3" width="15" height="13" />
                        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                        <circle cx="5.5" cy="18.5" r="2.5" />
                        <circle cx="18.5" cy="18.5" r="2.5" />
                      </svg>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "#1e293b" }}>
                          Label generation & carrier
                        </h3>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                          Configure when labels are triggered and which carrier settings to apply.
                        </p>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
                      <div>
                        <label htmlFor={`labelTiming_${market}`} style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                          Label generation timing
                        </label>
                        <select
                          id={`labelTiming_${market}`}
                          name={`labelTiming_${market}`}
                          defaultValue={data.settings.labelTimingPerMarket[market] || "after_approval"}
                          className="returbo-detail-input"
                          style={{ width: "100%", height: 38 }}
                        >
                          <option value="after_approval">After admin approval (Recommended)</option>
                          <option value="immediate">Immediately after request</option>
                        </select>
                        <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#64748b" }}>
                          Choose whether labels are auto-generated or hold for review.
                        </p>
                      </div>

                      <div>
                        <label htmlFor={`carrierId_${market}`} style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                          ShippyPro carrier ID
                        </label>
                        <input
                          id={`carrierId_${market}`}
                          type="text"
                          name={`carrierId_${market}`}
                          defaultValue={method.carrierId || ""}
                          placeholder="e.g. 101, DHL, UPS"
                          className="returbo-detail-input"
                          style={{ width: "100%", height: 38 }}
                        />
                        <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#64748b" }}>
                          Carrier ID from your ShippyPro connected carriers.
                        </p>
                      </div>

                      <div>
                        <label htmlFor={`service_${market}`} style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                          Carrier service
                        </label>
                        <input
                          id={`service_${market}`}
                          type="text"
                          name={`service_${market}`}
                          defaultValue={method.service || ""}
                          placeholder="e.g. Standard, Express, Return"
                          className="returbo-detail-input"
                          style={{ width: "100%", height: 38 }}
                        />
                        <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#64748b" }}>
                          Rate or service code (e.g. Express, Ground).
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Destination Warehouse Address */}
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "18px 20px",
                      background: "#ffffff",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#de4066" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "#1e293b" }}>
                          Return destination warehouse address
                        </h3>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                          The shipping address printed on return labels for orders in this country.
                        </p>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {/* Row 1: Contact Name and Company */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                        <div>
                          <label htmlFor={`name_${market}`} style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                            Warehouse / Contact name
                          </label>
                          <input
                            id={`name_${market}`}
                            type="text"
                            name={`name_${market}`}
                            defaultValue={address.name || ""}
                            placeholder="e.g. Return Warehouse Manager"
                            className="returbo-detail-input"
                            style={{ width: "100%", height: 38 }}
                          />
                        </div>

                        <div>
                          <label htmlFor={`company_${market}`} style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                            Company
                          </label>
                          <input
                            id={`company_${market}`}
                            type="text"
                            name={`company_${market}`}
                            defaultValue={address.company || ""}
                            placeholder="e.g. Grand Le Mar"
                            className="returbo-detail-input"
                            style={{ width: "100%", height: 38 }}
                          />
                        </div>
                      </div>

                      {/* Row 2: Street Address */}
                      <div>
                        <label htmlFor={`address1_${market}`} style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                          Street address
                        </label>
                        <input
                          id={`address1_${market}`}
                          type="text"
                          name={`address1_${market}`}
                          defaultValue={address.address1 || address.address || ""}
                          placeholder="e.g. Kungsgatan 12"
                          className="returbo-detail-input"
                          style={{ width: "100%", height: 38 }}
                        />
                      </div>

                      {/* Row 3: Address line 2 */}
                      <div>
                        <label htmlFor={`address2_${market}`} style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                          Address line 2 (optional)
                        </label>
                        <input
                          id={`address2_${market}`}
                          type="text"
                          name={`address2_${market}`}
                          defaultValue={address.address2 || ""}
                          placeholder="e.g. Building B, Dock 4"
                          className="returbo-detail-input"
                          style={{ width: "100%", height: 38 }}
                        />
                      </div>

                      {/* Row 4: City, Postal code, Country */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
                        <div>
                          <label htmlFor={`city_${market}`} style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                            City
                          </label>
                          <input
                            id={`city_${market}`}
                            type="text"
                            name={`city_${market}`}
                            defaultValue={address.city || ""}
                            placeholder="e.g. Stockholm"
                            className="returbo-detail-input"
                            style={{ width: "100%", height: 38 }}
                          />
                        </div>

                        <div>
                          <label htmlFor={`zip_${market}`} style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                            Postal code
                          </label>
                          <input
                            id={`zip_${market}`}
                            type="text"
                            name={`zip_${market}`}
                            defaultValue={address.zip || ""}
                            placeholder="e.g. 111 43"
                            className="returbo-detail-input"
                            style={{ width: "100%", height: 38 }}
                          />
                        </div>

                        <div>
                          <label htmlFor={`country_${market}`} style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                            Country
                          </label>
                          <input
                            id={`country_${market}`}
                            type="text"
                            name={`country_${market}`}
                            defaultValue={address.country || (market === "DEFAULT" ? "" : market)}
                            placeholder="e.g. Sweden, SE, US"
                            className="returbo-detail-input"
                            style={{ width: "100%", height: 38 }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Bottom Save Action Bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22, paddingTop: 18, borderTop: "1px solid #f1f5f9" }}>
              <button
                type="submit"
                className="returbo-btn-primary"
                disabled={fetcher.state === "submitting"}
                style={{
                  backgroundColor: "#de4066",
                  borderColor: "#de4066",
                  borderRadius: 6,
                  padding: "9px 22px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {fetcher.state === "submitting" ? "Saving..." : "Save return routing"}
              </button>
              {fetcher.data?.message === "Return routing settings saved" && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#16a34a", fontSize: 13, fontWeight: 600 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Return routing settings saved
                </span>
              )}
            </div>
          </fetcher.Form>
        </div>
      </div>
    </SettingsLayout>
  );
}

export default SettingsView;
export const headers: HeadersFunction = (a) => boundary.headers(a);
