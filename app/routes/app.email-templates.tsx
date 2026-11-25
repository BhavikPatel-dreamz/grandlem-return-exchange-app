/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { storefrontReturnsUrl } from "../services/storefront-links.server";
import { listEmailTemplates, upsertEmailTemplate, deleteEmailTemplate } from "../services/email-templates.server";
import { sendEmail, renderTemplate, isHtmlBody } from "../services/email.server";
import {
  getOrCreateSettings,
  updateSettings,
  getReturnFormCustomization,
  updateReturnFormCustomization,
  getReturnPolicy,
  updateReturnPolicy,
} from "../services/settings.server";
import { DEFAULT_RETURN_POLICY_EN } from "../services/return-policy";
import { SettingsLayout } from "../components/admin/SettingsLayout";
import { ReturnFormPreview } from "../components/admin/ReturnFormPreview";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const templates = await listEmailTemplates(session.shop);
  const settings = await getOrCreateSettings(session.shop);
  const customization = getReturnFormCustomization(settings);
  const DEFAULT_RETURN_FORM_CUSTOMIZATION = {
    primaryColor: "#de4066",
    primaryTextColor: "#121212",
    textColor: "#ffffff",
    secondaryBgColor: "#fff7f8",
    showLogo: true,
    showStoreName: true,
    logoUrl: "",
    storeName: "Grand Le Mar",
  };
  return {
    shop: session.shop,
    templates,
    emailFrom: settings.emailFrom || "",
    returnsUrl: storefrontReturnsUrl(session.shop),
    customization,
    DEFAULT_RETURN_FORM_CUSTOMIZATION,
    returnPolicy: getReturnPolicy(settings),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("_action") || "");
  try {
    if (intent === "save_sender_email") {
      const emailFrom = String(formData.get("emailFrom") || "").trim();
      if (!emailFrom) return { ok: false, message: "Enter a company sender email address" };
      await updateSettings(shop, { emailFrom });
      return { ok: true, message: "Company sender email saved" };
    }
    if (intent === "save_form_customization") {
      const primaryColor = String(formData.get("primaryColor") || "#de4066").trim();
      const primaryTextColor = String(formData.get("primaryTextColor") || "#121212").trim();
      const textColor = String(formData.get("textColor") || "#ffffff").trim();
      const secondaryBgColor = String(formData.get("secondaryBgColor") || "#fff7f8").trim();
      const showLogo = formData.get("showLogo") === "true";
      const showStoreName = formData.get("showStoreName") === "true";
      const logoUrl = String(formData.get("logoUrl") || "");
      const storeName = String(formData.get("storeName") || "Grand Le Mar");

      await updateReturnFormCustomization(shop, {
        primaryColor,
        primaryTextColor,
        textColor,
        secondaryBgColor,
        showLogo,
        showStoreName,
        logoUrl,
        storeName,
      });
      return { ok: true, message: "Palette saved successfully" };
    }
    if (intent === "save_return_policy") {
      const policy = String(formData.get("policy") || "").trim();
      await updateReturnPolicy(shop, policy);
      return { ok: true, message: "Return policy saved" };
    }
    if (intent === "save_template") {
      await upsertEmailTemplate(shop, {
        id: String(formData.get("id") || "") || undefined,
        event: String(formData.get("event")),
        language: String(formData.get("language")),
        subject: String(formData.get("subject")),
        body: String(formData.get("body")),
      });
      return { ok: true, message: "Template saved" };
    }
    if (intent === "delete_template") {
      await deleteEmailTemplate(shop, String(formData.get("id")));
      return { ok: true, message: "Template deleted" };
    }
    if (intent === "test_send") {
      const to = String(formData.get("testEmail") || "");
      if (!to) return { ok: false, message: "Enter a test email address" };
      const templateId = String(formData.get("id") || "");
      const templateEvent = String(formData.get("event") || "");
      const templateLanguage = String(formData.get("language") || "en");
      const templateSubject = String(formData.get("subject") || "Test");
      const templateBody = String(formData.get("body") || "");
      if (templateId && templateEvent) {
        await upsertEmailTemplate(shop, {
          id: templateId,
          event: templateEvent,
          language: templateLanguage,
          subject: templateSubject,
          body: templateBody,
        });
      }
      // Use test variables so email has content during testing
      const testVars = {
        orderNumber: "#1021",
        requestNumber: "GLM-1021",
        customerName: "Test Customer",
        items: "Jacket, Blue Shirt",
        labelLink: "https://example.com/label.pdf",
        trackingLink: "https://example.com/tracking",
        reason: "Item was worn",
        amount: "25.00",
        paymentLink: "https://example.com/pay",
        returnsUrl: storefrontReturnsUrl(shop),
      };
      const subject = renderTemplate(templateSubject, testVars);
      const isHtml = isHtmlBody(templateBody);
      const body = renderTemplate(templateBody, testVars, isHtml);
      const settings = await getOrCreateSettings(shop);
      const result = await sendEmail(to, subject, body, settings.emailFrom || undefined, isHtml);
      return {
        ok: result.ok,
        message: result.ok
          ? `Template saved and test email sent to ${to}`
          : `Template saved, but the test email was not sent: ${result.error || "unknown error"}`,
      };
    }
    return { ok: false, message: "Unknown action" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error" };
  }
};

const EVENT_OPTIONS = [
  "received", "approved", "rejected", "payment_required", "refund_issued",
  "item_received", "replacement_sent", "store_credit_issued", "withdrawal",
];

/** Plain-text templates (like the built-in defaults) lose their line breaks in a contentEditable; convert them to HTML first. */
function bodyToEditorHtml(body?: string): string {
  if (!body) return "";
  if (/<\/?[a-z][\s\S]*>/i.test(body)) return body;
  return body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br>");
}

function RichTextEditor({ name, initial: rawInitial }: { name: string; initial?: string }) {
  const initial = bodyToEditorHtml(rawInitial);
  const editorRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const [htmlMode, setHtmlMode] = useState(false);
  const [htmlSource, setHtmlSource] = useState(initial);

  useEffect(() => {
    const value = initial;
    if (editorRef.current) editorRef.current.innerHTML = value;
    if (hiddenRef.current) hiddenRef.current.value = value;
    setHtmlSource(value);
  }, [initial]);

  const sync = () => {
    if (!editorRef.current) return;
    const value = editorRef.current.innerHTML;
    if (hiddenRef.current) hiddenRef.current.value = value;
    setHtmlSource(value);
  };

  const showHtmlSource = () => {
    const value = editorRef.current?.innerHTML ?? htmlSource;
    setHtmlSource(value);
    if (hiddenRef.current) hiddenRef.current.value = value;
    setHtmlMode(true);
  };

  const showVisualEditor = () => {
    if (editorRef.current) editorRef.current.innerHTML = htmlSource;
    if (hiddenRef.current) hiddenRef.current.value = htmlSource;
    setHtmlMode(false);
  };

  const exec = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    sync();
  };

  const toolBtnStyle: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #d1d5db",
    borderRadius: 5,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    color: "#374151",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1.3,
    transition: "all 0.15s ease",
  };

  return (
    <div style={{ border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden", background: "#ffffff" }}>
      <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", flexWrap: "wrap", alignItems: "center" }}>
        {htmlMode ? (
          <button type="button" onClick={showVisualEditor} style={toolBtnStyle}>Visual editor</button>
        ) : (
          <>
            <button type="button" onClick={() => exec("bold")} style={toolBtnStyle} title="Bold"><strong>B</strong></button>
            <button type="button" onClick={() => exec("italic")} style={toolBtnStyle} title="Italic"><em>I</em></button>
            <button type="button" onClick={() => exec("underline")} style={toolBtnStyle} title="Underline"><u>U</u></button>
            <button type="button" onClick={() => exec("insertUnorderedList")} style={toolBtnStyle} title="List">• List</button>
            <button type="button" onClick={() => {
              const url = window.prompt("Link URL");
              if (url) exec("createLink", url);
            }} style={toolBtnStyle} title="Link">Link</button>
            <button type="button" onClick={() => exec("undo")} style={toolBtnStyle} title="Undo">Undo</button>
            <button type="button" onClick={showHtmlSource} style={toolBtnStyle} title="HTML source">HTML source</button>
          </>
        )}
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={sync}
        style={{ minHeight: 180, padding: 14, outline: "none", fontSize: 13, lineHeight: 1.6, color: "#111827", display: htmlMode ? "none" : "block" }}
      />
      {htmlMode && (
        <textarea
          name={name}
          aria-label="Email HTML source"
          value={htmlSource}
          onChange={(event) => {
            setHtmlSource(event.currentTarget.value);
            if (hiddenRef.current) hiddenRef.current.value = event.currentTarget.value;
          }}
          style={{ display: "block", boxSizing: "border-box", width: "100%", minHeight: 180, padding: 14, border: 0, outline: "none", resize: "vertical", fontFamily: "monospace", fontSize: 13, background: "#fafafa" }}
        />
      )}
      <input ref={hiddenRef} type="hidden" name={htmlMode ? undefined : name} defaultValue={initial || ""} />
    </div>
  );
}

function toHexColor(color: string, fallback: string = "#000000"): string {
  if (!color) return fallback;
  const trimmed = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return fallback;
}

export default function EmailTemplatesPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const templateActionRef = useRef<HTMLInputElement>(null);
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const primaryColorInputRef = useRef<HTMLInputElement>(null);
  const primaryTextColorInputRef = useRef<HTMLInputElement>(null);
  const textColorInputRef = useRef<HTMLInputElement>(null);
  const secondaryBgColorInputRef = useRef<HTMLInputElement>(null);
  const policyEditorRef = useRef<HTMLDivElement>(null);
  const paletteFetcher = useFetcher<any>();
  const [isPaletteSaved, setIsPaletteSaved] = useState(false);

  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const section: "form" | "policy" | "emails" =
    tabParam === "policy" || tabParam === "emails" ? tabParam : "form";

  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingTemplate = data.templates.find((t: any) => t.id === editingId) ?? null;

  // The template editor belongs to the Customer emails tab; close it when switching tabs.
  useEffect(() => {
    if (section !== "emails") {
      setMode("list");
      setEditingId(null);
    }
  }, [section]);

  const initialCustomization = data.customization || data.DEFAULT_RETURN_FORM_CUSTOMIZATION;
  const [primaryColor, setPrimaryColor] = useState(initialCustomization.primaryColor || "#de4066");
  const [primaryTextColor, setPrimaryTextColor] = useState(initialCustomization.primaryTextColor || "#121212");
  const [textColor, setTextColor] = useState(initialCustomization.textColor || "#ffffff");
  const [secondaryBgColor, setSecondaryBgColor] = useState(initialCustomization.secondaryBgColor || "#fff7f8");
  const [showLogo, setShowLogo] = useState(initialCustomization.showLogo ?? true);
  const [showStoreName, setShowStoreName] = useState(initialCustomization.showStoreName ?? true);
  const [logoUrl, setLogoUrl] = useState(initialCustomization.logoUrl || "");
  const [logoFileName, setLogoFileName] = useState(initialCustomization.logoUrl ? "Uploaded logo" : "");
  const [storeName, setStoreName] = useState(initialCustomization.storeName || "Grand Le Mar");

  const policyFetcher = useFetcher<any>();
  const [showPolicyTip, setShowPolicyTip] = useState(true);
  const [isPolicyExpanded, setIsPolicyExpanded] = useState(false);
  const [isEditingPolicy, setIsEditingPolicy] = useState(false);
  const [policyText, setPolicyText] = useState(data.returnPolicy || DEFAULT_RETURN_POLICY_EN);
  const [policyDraft, setPolicyDraft] = useState(data.returnPolicy || DEFAULT_RETURN_POLICY_EN);

  useEffect(() => {
    if (data.returnPolicy) {
      setPolicyText(data.returnPolicy);
      setPolicyDraft(data.returnPolicy);
    }
  }, [data.returnPolicy]);

  useEffect(() => {
    if (isEditingPolicy && policyEditorRef.current) {
      policyEditorRef.current.innerHTML = policyDraft;
    }
  }, [isEditingPolicy]);

  useEffect(() => {
    if (policyFetcher.data?.ok) {
      setPolicyText(policyDraft);
      setIsEditingPolicy(false);
    }
  }, [policyFetcher.data, policyDraft]);

  const handlePolicyExec = (command: string, val?: string) => {
    document.execCommand(command, false, val);
    if (policyEditorRef.current) {
      setPolicyDraft(policyEditorRef.current.innerHTML);
    }
  };

  useEffect(() => {
    if (data.customization) {
      setPrimaryColor(data.customization.primaryColor || "#de4066");
      setPrimaryTextColor(data.customization.primaryTextColor || "#121212");
      setTextColor(data.customization.textColor || "#ffffff");
      setSecondaryBgColor(data.customization.secondaryBgColor || "#fff7f8");
      setShowLogo(data.customization.showLogo ?? true);
      setShowStoreName(data.customization.showStoreName ?? true);
      if (data.customization.logoUrl) {
        setLogoUrl(data.customization.logoUrl);
        setLogoFileName("Uploaded logo");
      }
      if (data.customization.storeName) {
        setStoreName(data.customization.storeName);
      }
    }
  }, [data.customization]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) {
          setLogoUrl(result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleResetToDefault = () => {
    setPrimaryColor(data.DEFAULT_RETURN_FORM_CUSTOMIZATION.primaryColor);
    setPrimaryTextColor(data.DEFAULT_RETURN_FORM_CUSTOMIZATION.primaryTextColor);
    setTextColor(data.DEFAULT_RETURN_FORM_CUSTOMIZATION.textColor);
    setSecondaryBgColor(data.DEFAULT_RETURN_FORM_CUSTOMIZATION.secondaryBgColor);
  };

  const handleSavePalette = () => {
    setIsPaletteSaved(false);
    paletteFetcher.submit(
      {
        _action: "save_form_customization",
        primaryColor,
        primaryTextColor,
        textColor,
        secondaryBgColor,
        showLogo: String(showLogo),
        showStoreName: String(showStoreName),
        logoUrl,
        storeName,
      },
      { method: "post" }
    );
  };

  const isSavingPalette = paletteFetcher.state !== "idle";

  useEffect(() => {
    if (
      paletteFetcher.state !== "idle" ||
      !paletteFetcher.data?.ok ||
      paletteFetcher.data.message !== "Palette saved successfully"
    ) return;

    setIsPaletteSaved(true);
    const timeout = window.setTimeout(() => setIsPaletteSaved(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [paletteFetcher.data, paletteFetcher.state]);

  return (
    <SettingsLayout activeTab={section}>
      {actionData?.message && <div className="returbo-banner">{actionData.message}</div>}

      {mode === "list" && (
        <div className="returbo-email-page">
          <section className="returbo-card returbo-email-section" style={{ background: "#ffffff", padding: "24px 28px", display: section === "form" ? undefined : "none" }}>
            <div className="returbo-card-header" style={{ marginBottom: 20 }}>
              <h2 className="returbo-card-title" style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: "0 0 6px 0" }}>
                Return form design
              </h2>
              <p className="returbo-card-subtitle" style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
                Set the logo, store name, and colors customers see on the storefront return form.
              </p>
            </div>

            <div className="returbo-return-form-preview" style={{ marginTop: 16 }}>
              {/* Left Column: Branding and Color Palette Cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Card 1: Branding */}
                <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 14, borderBottom: "1px solid #f1f5f9" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#111827" }}>Branding</h3>
                  </div>

                  <div style={{ paddingTop: 16 }}>
                    <h4 style={{ margin: "0 0 4px 0", fontSize: 13, fontWeight: 700, color: "#111827" }}>Your logo</h4>
                    <p style={{ margin: "0 0 14px 0", fontSize: 11, color: "#6b7280", lineHeight: 1.45 }}>
                      Recommended minimum resolution 512×512 px. The logo should be square shaped. Accepted file types: .jpg, .png.
                    </p>

                    {/* Logo Box */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: "8px 12px",
                        background: "#ffffff",
                        marginBottom: 16,
                      }}
                    >
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", flex: 1 }}
                        onClick={() => logoFileInputRef.current?.click()}
                        title="Click to choose a new logo"
                      >
                        <input
                          ref={logoFileInputRef}
                          type="file"
                          accept="image/png, image/jpeg, image/jpg"
                          style={{ display: "none" }}
                          onChange={handleLogoUpload}
                        />
                        {logoUrl ? (
                          <img
                            src={logoUrl}
                            alt="Store logo"
                            style={{ width: 40, height: 40, borderRadius: 6, objectFit: "contain", background: "#000000" }}
                          />
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#6b7280", fontSize: 12.5 }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <circle cx="8.5" cy="8.5" r="1.5" />
                              <path d="m21 15-5-5L5 21" />
                              <path d="M19 2v6M16 5h6" />
                            </svg>
                            Upload an image
                          </span>
                        )}
                        {logoUrl && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <strong style={{ fontSize: 12.5, fontWeight: 600, color: "#111827" }}>
                              {logoFileName}
                            </strong>
                            <span style={{ fontSize: 11, color: "#6b7280" }}>
                              512 × 512 • 24 KB
                            </span>
                          </div>
                        )}
                      </div>
                      {logoUrl && (
                        <button
                          type="button"
                          title="Remove logo"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLogoUrl("");
                            setLogoFileName("");
                          }}
                          style={{
                            background: "#ffffff",
                            border: "1px solid #e5e7eb",
                            borderRadius: 6,
                            padding: "6px 8px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#6b7280",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Checkboxes */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 500, color: "#1f2937", userSelect: "none" }}>
                        <input
                          type="checkbox"
                          checked={showLogo}
                          onChange={(e) => setShowLogo(e.target.checked)}
                          style={{ width: 16, height: 16, margin: 0, accentColor: primaryColor, cursor: "pointer", borderRadius: 4 }}
                        />
                        <span>Show the logo in the digital return form.</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 500, color: "#1f2937", userSelect: "none" }}>
                        <input
                          type="checkbox"
                          checked={showStoreName}
                          onChange={(e) => setShowStoreName(e.target.checked)}
                          style={{ width: 16, height: 16, margin: 0, accentColor: primaryColor, cursor: "pointer", borderRadius: 4 }}
                        />
                        <span>Show the name of the store in the digital return form.</span>
                      </label>
                    </div>
                    <p style={{ margin: "8px 0 0 26px", color: "#9ca3af", fontSize: 11, lineHeight: 1.4 }}>
                      You can choose to display the name of your company and your logo on the digital return form.
                    </p>
                  </div>
                </div>

                {/* Card 2: Digital Return Form color palette */}
                <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="13.5" cy="6.5" r=".5" fill="#111827" />
                      <circle cx="17.5" cy="10.5" r=".5" fill="#111827" />
                      <circle cx="8.5" cy="7.5" r=".5" fill="#111827" />
                      <circle cx="6.5" cy="12.5" r=".5" fill="#111827" />
                      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z" />
                    </svg>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#111827" }}>Digital Return Form color palette</h3>
                    <span style={{ background: "#eff6ff", color: "#2563eb", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 9999 }}>Plus</span>
                    <span style={{ background: "#eff6ff", color: "#2563eb", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 9999 }}>Premium</span>
                  </div>
                  <p style={{ margin: "4px 0 16px 0", color: "#6b7280", fontSize: 11.5, lineHeight: 1.45 }}>
                    Customize and adjust the colors to tailor the Digital Return Form to your brand.
                  </p>

                  {/* 4 Color Options */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* Main primary color */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                      <button
                        type="button"
                        title="Click to pick Main primary color"
                        onClick={() => {
                          try { primaryColorInputRef.current?.showPicker(); } catch { primaryColorInputRef.current?.click(); }
                        }}
                        style={{
                          width: 32,
                          height: 26,
                          borderRadius: 6,
                          backgroundColor: primaryColor,
                          border: `1px solid ${primaryColor.toLowerCase() === "#ffffff" ? "#cbd2da" : primaryColor}`,
                          cursor: "pointer",
                          flexShrink: 0,
                          position: "relative",
                          padding: 0,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                        }}
                      >
                        <input
                          ref={primaryColorInputRef}
                          type="color"
                          value={toHexColor(primaryColor, "#de4066")}
                          onInput={(e) => setPrimaryColor(e.currentTarget.value)}
                          onChange={(e) => setPrimaryColor(e.target.value)}
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                          aria-label="Pick main primary color"
                        />
                      </button>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        <strong style={{ fontSize: 12.5, fontWeight: 700, color: "#111827" }}>Main primary color</strong>
                        <span style={{ fontSize: 10.5, color: "#6b7280", lineHeight: 1.35 }}>
                          Used for as background for primary buttons and as an action color for links, icons, etc.
                        </span>
                      </div>
                      <input
                        type="text"
                        value={primaryColor}
                        onInput={(e) => setPrimaryColor(e.currentTarget.value)}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        style={{
                          width: 76,
                          height: 32,
                          fontSize: 12,
                          padding: "4px 8px",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                          fontFamily: "monospace",
                          color: "#374151",
                          background: "#ffffff",
                          textAlign: "center",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    {/* Primary text color */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                      <button
                        type="button"
                        title="Click to pick Primary text color"
                        onClick={() => {
                          try { primaryTextColorInputRef.current?.showPicker(); } catch { primaryTextColorInputRef.current?.click(); }
                        }}
                        style={{
                          width: 32,
                          height: 26,
                          borderRadius: 6,
                          backgroundColor: primaryTextColor,
                          border: `1px solid ${primaryTextColor.toLowerCase() === "#ffffff" ? "#cbd2da" : primaryTextColor}`,
                          cursor: "pointer",
                          flexShrink: 0,
                          position: "relative",
                          padding: 0,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                        }}
                      >
                        <input
                          ref={primaryTextColorInputRef}
                          type="color"
                          value={toHexColor(primaryTextColor, "#121212")}
                          onInput={(e) => setPrimaryTextColor(e.currentTarget.value)}
                          onChange={(e) => setPrimaryTextColor(e.target.value)}
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                          aria-label="Pick primary text color"
                        />
                      </button>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        <strong style={{ fontSize: 12.5, fontWeight: 700, color: "#111827" }}>Primary text color</strong>
                        <span style={{ fontSize: 10.5, color: "#6b7280", lineHeight: 1.35 }}>
                          Used for as the text color for headings and other primary elements.
                        </span>
                      </div>
                      <input
                        type="text"
                        value={primaryTextColor}
                        onInput={(e) => setPrimaryTextColor(e.currentTarget.value)}
                        onChange={(e) => setPrimaryTextColor(e.target.value)}
                        style={{
                          width: 76,
                          height: 32,
                          fontSize: 12,
                          padding: "4px 8px",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                          fontFamily: "monospace",
                          color: "#374151",
                          background: "#ffffff",
                          textAlign: "center",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    {/* Text color */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                      <button
                        type="button"
                        title="Click to pick Text color"
                        onClick={() => {
                          try { textColorInputRef.current?.showPicker(); } catch { textColorInputRef.current?.click(); }
                        }}
                        style={{
                          width: 32,
                          height: 26,
                          borderRadius: 6,
                          backgroundColor: textColor,
                          border: `1px solid ${textColor.toLowerCase() === "#ffffff" ? "#cbd2da" : textColor}`,
                          cursor: "pointer",
                          flexShrink: 0,
                          position: "relative",
                          padding: 0,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                        }}
                      >
                        <input
                          ref={textColorInputRef}
                          type="color"
                          value={toHexColor(textColor, "#ffffff")}
                          onInput={(e) => setTextColor(e.currentTarget.value)}
                          onChange={(e) => setTextColor(e.target.value)}
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                          aria-label="Pick text color"
                        />
                      </button>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        <strong style={{ fontSize: 12.5, fontWeight: 700, color: "#111827" }}>Text color</strong>
                        <span style={{ fontSize: 10.5, color: "#6b7280", lineHeight: 1.35 }}>
                          Used for the text for buttons and as a check icon color for when the item is selected.
                        </span>
                      </div>
                      <input
                        type="text"
                        value={textColor}
                        onInput={(e) => setTextColor(e.currentTarget.value)}
                        onChange={(e) => setTextColor(e.target.value)}
                        style={{
                          width: 76,
                          height: 32,
                          fontSize: 12,
                          padding: "4px 8px",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                          fontFamily: "monospace",
                          color: "#374151",
                          background: "#ffffff",
                          textAlign: "center",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    {/* Secondary background color */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                      <button
                        type="button"
                        title="Click to pick Secondary background color"
                        onClick={() => {
                          try { secondaryBgColorInputRef.current?.showPicker(); } catch { secondaryBgColorInputRef.current?.click(); }
                        }}
                        style={{
                          width: 32,
                          height: 26,
                          borderRadius: 6,
                          backgroundColor: secondaryBgColor,
                          border: `1px solid ${secondaryBgColor.toLowerCase() === "#ffffff" ? "#cbd2da" : secondaryBgColor}`,
                          cursor: "pointer",
                          flexShrink: 0,
                          position: "relative",
                          padding: 0,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                        }}
                      >
                        <input
                          ref={secondaryBgColorInputRef}
                          type="color"
                          value={toHexColor(secondaryBgColor, "#fff7f8")}
                          onInput={(e) => setSecondaryBgColor(e.currentTarget.value)}
                          onChange={(e) => setSecondaryBgColor(e.target.value)}
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                          aria-label="Pick secondary background color"
                        />
                      </button>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        <strong style={{ fontSize: 12.5, fontWeight: 700, color: "#111827" }}>Secondary background color</strong>
                        <span style={{ fontSize: 10.5, color: "#6b7280", lineHeight: 1.35 }}>
                          Used for as a background for secondary buttons and as a background color for badges.
                        </span>
                      </div>
                      <input
                        type="text"
                        value={secondaryBgColor}
                        onInput={(e) => setSecondaryBgColor(e.currentTarget.value)}
                        onChange={(e) => setSecondaryBgColor(e.target.value)}
                        style={{
                          width: 76,
                          height: 32,
                          fontSize: 12,
                          padding: "4px 8px",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                          fontFamily: "monospace",
                          color: "#374151",
                          background: "#ffffff",
                          textAlign: "center",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Bottom Action Bar */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button
                      type="button"
                      onClick={handleResetToDefault}
                      style={{
                        background: "#ffffff",
                        border: "1px solid #d1d5db",
                        borderRadius: 8,
                        padding: "8px 16px",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#374151",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      Back to default
                    </button>
                    <button
                      type="button"
                      onClick={handleSavePalette}
                      disabled={isSavingPalette}
                      style={{
                        backgroundColor: "#de4066",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: 8,
                        padding: "8px 20px",
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: isSavingPalette ? "wait" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                      </svg>
                      <span>{isSavingPalette ? "Saving..." : "Save palette"}</span>
                    </button>
                    {isPaletteSaved && (
                      <div role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#16a34a", fontSize: 13, fontWeight: 600 }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 12 4 7" />
                        </svg>
                        <span>Saved</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Live Return Form Preview */}
              <ReturnFormPreview
                primaryColor={primaryColor}
                primaryTextColor={primaryTextColor}
                textColor={textColor}
                secondaryBgColor={secondaryBgColor}
                showLogo={showLogo}
                showStoreName={showStoreName}
                logoUrl={logoUrl}
                storeName={storeName}
              />
            </div>
          </section>

          <section className="returbo-card returbo-email-section" style={{ display: section === "policy" ? undefined : "none" }}>
            <div className="returbo-card-header" style={{ marginBottom: 0 }}>
              <h2 className="returbo-card-title">Return policy</h2>
              <p className="returbo-card-subtitle">
                A return policy helps the customer to know the timeframe for returns, complaints, exchanges, and what products are allowed to be returned.
              </p>
            </div>

            {showPolicyTip && (
              <div className="returbo-policy-tip-banner">
                <div className="returbo-policy-tip-left">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1f2937" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <path d="M9 18h6" />
                    <path d="M10 22h4" />
                    <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
                  </svg>
                  <div>
                    <strong style={{ color: "#1e293b", fontWeight: 700 }}>Tip:</strong>{" "}
                    <span style={{ color: "#334155" }}>Please make sure you mention complaint and exchange policy inside this document, if you are using these functions.</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="returbo-policy-tip-close"
                  onClick={() => setShowPolicyTip(false)}
                  aria-label="Dismiss tip"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}

            <div className="returbo-policy-lang-box">
              <div className="returbo-policy-lang-header">
                <div className="returbo-policy-lang-title">
                  <svg width="20" height="14" viewBox="0 0 20 14" style={{ borderRadius: 2, flexShrink: 0, boxShadow: "0 0 0 1px rgba(0,0,0,0.08)" }} aria-label="US Flag">
                    <rect width="20" height="14" fill="#b22234" />
                    <path d="M0 2.15h20M0 4.31h20M0 6.46h20M0 8.62h20M0 10.77h20M0 12.92h20" stroke="#fff" strokeWidth="1.08" />
                    <rect width="8" height="7.54" fill="#3c3b6e" />
                    <circle cx="2" cy="1.9" r="0.6" fill="#fff" />
                    <circle cx="4" cy="1.9" r="0.6" fill="#fff" />
                    <circle cx="6" cy="1.9" r="0.6" fill="#fff" />
                    <circle cx="3" cy="3.8" r="0.6" fill="#fff" />
                    <circle cx="5" cy="3.8" r="0.6" fill="#fff" />
                    <circle cx="2" cy="5.7" r="0.6" fill="#fff" />
                    <circle cx="4" cy="5.7" r="0.6" fill="#fff" />
                    <circle cx="6" cy="5.7" r="0.6" fill="#fff" />
                  </svg>
                  <span>English</span>
                </div>
                {!isEditingPolicy && (
                  <button
                    type="button"
                    className="returbo-policy-edit-btn"
                    onClick={() => {
                      setPolicyDraft(policyText);
                      setIsEditingPolicy(true);
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    <span>Edit</span>
                  </button>
                )}
              </div>

              {isEditingPolicy ? (
                <div>
                  <div className="returbo-editor-box">
                    <div className="returbo-editor-toolbar">
                      {/* Undo / Redo */}
                      <div className="returbo-editor-toolbar-group">
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Undo"
                          onClick={() => handlePolicyExec("undo")}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Redo"
                          onClick={() => handlePolicyExec("redo")}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                          </svg>
                        </button>
                      </div>

                      {/* Formatting: B, I, U */}
                      <div className="returbo-editor-toolbar-group">
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Bold"
                          onClick={() => handlePolicyExec("bold")}
                        >
                          <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "sans-serif" }}>B</span>
                        </button>
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Italic"
                          onClick={() => handlePolicyExec("italic")}
                        >
                          <span style={{ fontStyle: "italic", fontSize: 13, fontFamily: "serif" }}>I</span>
                        </button>
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Underline"
                          onClick={() => handlePolicyExec("underline")}
                        >
                          <span style={{ textDecoration: "underline", fontSize: 13, fontWeight: 500 }}>U</span>
                        </button>
                      </div>

                      {/* Alignment */}
                      <div className="returbo-editor-toolbar-group">
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Align Left"
                          onClick={() => handlePolicyExec("justifyLeft")}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="21" y1="6" x2="3" y2="6" />
                            <line x1="15" y1="12" x2="3" y2="12" />
                            <line x1="17" y1="18" x2="3" y2="18" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Align Center"
                          onClick={() => handlePolicyExec("justifyCenter")}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="21" y1="6" x2="3" y2="6" />
                            <line x1="17" y1="12" x2="7" y2="12" />
                            <line x1="19" y1="18" x2="5" y2="18" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Align Right"
                          onClick={() => handlePolicyExec("justifyRight")}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="21" y1="6" x2="3" y2="6" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                            <line x1="21" y1="18" x2="7" y2="18" />
                          </svg>
                        </button>
                      </div>

                      {/* Lists */}
                      <div className="returbo-editor-toolbar-group">
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Bulleted List"
                          onClick={() => handlePolicyExec("insertUnorderedList")}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="8" y1="6" x2="21" y2="6" />
                            <line x1="8" y1="12" x2="21" y2="12" />
                            <line x1="8" y1="18" x2="21" y2="18" />
                            <circle cx="3.5" cy="6" r="1.5" fill="currentColor" />
                            <circle cx="3.5" cy="12" r="1.5" fill="currentColor" />
                            <circle cx="3.5" cy="18" r="1.5" fill="currentColor" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Numbered List"
                          onClick={() => handlePolicyExec("insertOrderedList")}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="10" y1="6" x2="21" y2="6" />
                            <line x1="10" y1="12" x2="21" y2="12" />
                            <line x1="10" y1="18" x2="21" y2="18" />
                            <path d="M4 6h1v4" />
                            <path d="M4 10h2" />
                            <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
                          </svg>
                        </button>
                      </div>

                      {/* Indentation */}
                      <div className="returbo-editor-toolbar-group">
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Decrease Indent"
                          onClick={() => handlePolicyExec("outdent")}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="7 8 3 12 7 16" />
                            <line x1="21" y1="12" x2="11" y2="12" />
                            <line x1="21" y1="6" x2="11" y2="6" />
                            <line x1="21" y1="18" x2="11" y2="18" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="returbo-editor-toolbar-btn"
                          title="Increase Indent"
                          onClick={() => handlePolicyExec("indent")}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="11 8 15 12 11 16" />
                            <line x1="21" y1="12" x2="15" y2="12" />
                            <line x1="21" y1="6" x2="3" y2="6" />
                            <line x1="21" y1="18" x2="3" y2="18" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div
                      ref={policyEditorRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={(e) => {
                        setPolicyDraft(e.currentTarget.innerHTML);
                      }}
                      className="returbo-editor-content"
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                    <button
                      type="button"
                      className="returbo-policy-save-btn"
                      disabled={policyFetcher.state === "submitting"}
                      onClick={() => {
                        const finalContent = policyEditorRef.current?.innerHTML || policyDraft;
                        setPolicyDraft(finalContent);
                        setPolicyText(finalContent);
                        policyFetcher.submit(
                          { _action: "save_return_policy", policy: finalContent },
                          { method: "post" }
                        );
                      }}
                    >
                      {policyFetcher.state === "submitting" ? "Saving..." : "Save changes"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="returbo-policy-text">
                    {isPolicyExpanded ? (
                      <span dangerouslySetInnerHTML={{ __html: policyText }} />
                    ) : (
                      policyText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length > 240
                        ? policyText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) + "..."
                        : policyText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
                    )}
                  </p>
                  <button
                    type="button"
                    className="returbo-policy-expand-btn"
                    onClick={() => setIsPolicyExpanded(!isPolicyExpanded)}
                  >
                    <span>{isPolicyExpanded ? "Collapse text" : "Expand text"}</span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {isPolicyExpanded ? (
                        <polyline points="18 15 12 9 6 15" />
                      ) : (
                        <polyline points="6 9 12 15 18 9" />
                      )}
                    </svg>
                  </button>
                </>
              )}
            </div>
          </section>

          <section className="returbo-card returbo-email-section" style={{ display: section === "emails" ? undefined : "none" }}>
            <div className="returbo-card-header returbo-email-section-header">
              <div>
                <h2 className="returbo-card-title">Customer emails</h2>
                <p className="returbo-card-subtitle">Manage transactional emails sent to customers throughout the return journey.</p>
                <p className="returbo-card-subtitle">
                  Use <code>{"{{returnsUrl}}"}</code> to link to your storefront returns page (<code>{data.returnsUrl}</code>).
                </p>
              </div>
              <button
                type="button"
                className="returbo-btn-primary"
                onClick={() => setMode("create")}
              >
                Add template
              </button>
            </div>

            <Form method="post" style={{ display: "flex", alignItems: "end", gap: 12, marginBottom: 20 }}>
              <input type="hidden" name="_action" value="save_sender_email" />
              <div style={{ flex: "1 1 320px", maxWidth: 480 }}>
                <label htmlFor="company-sender-email" style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
                  Company sender email <span aria-hidden="true">*</span>
                </label>
                <input
                  id="company-sender-email"
                  type="email"
                  name="emailFrom"
                  autoComplete="email"
                  required
                  defaultValue={data.emailFrom}
                  className="returbo-detail-input"
                  style={{ boxSizing: "border-box", width: "100%" }}
                />
              </div>
              <button type="submit" className="returbo-btn-primary">Save sender email</button>
              {actionData?.message === "Company sender email saved" && (
                <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#15803d", fontSize: 13, fontWeight: 600 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Saved
                </span>
              )}
            </Form>

            {data.templates.length === 0 ? (
              <p className="returbo-empty-state">No notification emails yet. Add a template to start communicating with customers.</p>
            ) : (
              <div className="returbo-email-template-list">
                {data.templates.map((t: any) => (
                  <article key={t.id} className="returbo-email-template-card">
                    <div className="returbo-email-template-heading">
                      <div>
                        <div className="returbo-email-template-meta">
                          <span className="returbo-badge returbo-badge-pink">{t.language.toUpperCase()}</span>
                          <span>{t.event.replaceAll("_", " ")}</span>
                        </div>
                        <h3>{t.subject}</h3>
                      </div>
                      <div className="returbo-template-actions">
                        <button
                          type="button"
                          className="returbo-btn-secondary"
                          onClick={() => { setEditingId(t.id); setMode("edit"); }}
                        >
                          Edit
                        </button>
                        <Form method="post">
                          <input type="hidden" name="_action" value="delete_template" />
                          <input type="hidden" name="id" value={t.id} />
                          <button type="submit" className="returbo-btn-danger">Delete</button>
                        </Form>
                      </div>
                    </div>
                    <p className="returbo-email-template-preview">{t.body.replace(/<[^>]*>/g, " ").trim() || "No email content added yet."}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {mode === "create" && (
        <div className="returbo-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">New Email Template</h2>
            <p className="returbo-card-subtitle">Create a localized email template for a return lifecycle event.</p>
          </div>
          <Form method="post">
            <input type="hidden" name="_action" value="save_template" />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
                  Event
                </label>
                <select
                  name="event"
                  className="returbo-detail-input"
                  style={{ width: "100%", height: 38, background: "#ffffff" }}
                >
                  {EVENT_OPTIONS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
                  Language
                </label>
                <select
                  name="language"
                  className="returbo-detail-input"
                  style={{ width: "100%", height: 38, background: "#ffffff" }}
                >
                  <option value="en">English</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
                  Subject
                </label>
                <input
                  type="text"
                  name="subject"
                  required
                  placeholder="e.g. We received your return request ({{orderNumber}})"
                  className="returbo-detail-input"
                  style={{ width: "100%", height: 38 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
                  Content
                </label>
                <RichTextEditor name="body" />
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 6, alignItems: "center" }}>
                <button type="submit" className="returbo-btn-primary">
                  Create template
                </button>
                <button
                  type="button"
                  className="returbo-btn-secondary"
                  onClick={() => setMode("list")}
                >
                  Cancel
                </button>
              </div>
            </div>
          </Form>
        </div>
      )}

      {mode === "edit" && editingTemplate && (
        <div className="returbo-card">
          <div className="returbo-card-header">
            <h2 className="returbo-card-title">Edit Template: {editingTemplate.event} ({editingTemplate.language})</h2>
            <p className="returbo-card-subtitle">Update email subject, content, and test email delivery.</p>
          </div>
          <Form method="post">
            <input ref={templateActionRef} type="hidden" name="_action" defaultValue="save_template" />
            <input type="hidden" name="id" value={editingTemplate.id} />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
                  Event
                </label>
                <select
                  name="event"
                  defaultValue={editingTemplate.event}
                  className="returbo-detail-input"
                  style={{ width: "100%", height: 38, background: "#ffffff" }}
                >
                  {EVENT_OPTIONS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
                  Language
                </label>
                <select
                  name="language"
                  defaultValue={editingTemplate.language}
                  className="returbo-detail-input"
                  style={{ width: "100%", height: 38, background: "#ffffff" }}
                >
                  <option value="en">English</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
                  Subject
                </label>
                <input
                  type="text"
                  name="subject"
                  required
                  defaultValue={editingTemplate.subject}
                  className="returbo-detail-input"
                  style={{ width: "100%", height: 38 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
                  Content
                </label>
                <RichTextEditor name="body" initial={editingTemplate.body} />
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 6, alignItems: "center" }}>
                <button
                  type="submit"
                  className="returbo-btn-primary"
                  onClick={() => {
                    if (templateActionRef.current) templateActionRef.current.value = "save_template";
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="returbo-btn-secondary"
                  onClick={() => {
                    setMode("list");
                    setEditingId(null);
                  }}
                >
                  Back to list
                </button>
              </div>
            </div>

          <div style={{ borderTop: "1px solid #f3f4f6", marginTop: 28, paddingTop: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px 0", color: "#111827" }}>
              Test Email Delivery
            </h3>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 14px 0" }}>
              Send a test email using sample order data to verify your template layout and delivery.
            </p>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 300px", maxWidth: 440 }}>
                  <label htmlFor="test-email-address" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
                    Test email address
                  </label>
                  <input
                    id="test-email-address"
                    type="email"
                    name="testEmail"
                    placeholder="e.g. yourname@example.com"
                    className="returbo-detail-input"
                    style={{ width: "100%", height: 38 }}
                  />
                </div>
                <button
                  type="submit"
                  className="returbo-btn-primary"
                  style={{ height: 38, padding: "8px 20px" }}
                  onClick={() => {
                    if (templateActionRef.current) templateActionRef.current.value = "test_send";
                  }}
                >
                  Test send
                </button>
              </div>
          </div>
          </Form>

          <div style={{ borderTop: "1px solid #f3f4f6", marginTop: 24, paddingTop: 20 }}>
            <Form
              method="post"
              onSubmit={(e) => {
                if (!window.confirm("Are you sure you want to delete this template?")) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="_action" value="delete_template" />
              <input type="hidden" name="id" value={editingTemplate.id} />
              <button
                type="submit"
                className="returbo-btn-danger-outline"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Delete template
              </button>
            </Form>
          </div>
        </div>
      )}
    </SettingsLayout>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
