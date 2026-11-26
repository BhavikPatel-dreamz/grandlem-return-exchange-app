import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import {
  renderEmailDocument,
  renderTemplate,
  renderTemplateHtml,
  SAMPLE_EMAIL_VARS,
  type EmailLayout,
} from "../../services/email-layout";
import { EmailPreview } from "./EmailPreview";

type PreviewTemplate = { id: string; event: string; language: string; subject: string; body: string };

interface EmailLayoutEditorProps {
  initialLayout: EmailLayout;
  /** Logo from the Return form design tab, offered as a one-click option. */
  formLogoUrl: string;
  templates: PreviewTemplate[];
  returnsUrl: string;
  emailFrom: string;
}

const MAX_LOGO_BYTES = 300 * 1024;
const LOGO_TYPES = "image/png,image/jpeg,image/gif,image/webp";

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 6 };
const hintStyle: React.CSSProperties = { fontSize: 12, color: "#6b7280", margin: "6px 0 0" };
const cardStyle: React.CSSProperties = { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "18px 20px" };
const cardTitleStyle: React.CSSProperties = { margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "#111827" };

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          style={{ width: 38, height: 34, padding: 2, border: "1px solid #d1d5db", borderRadius: 6, background: "#ffffff", cursor: "pointer" }}
        />
        <code style={{ fontSize: 12, color: "#374151" }}>{value}</code>
      </div>
    </div>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label htmlFor={id} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" }}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      {label}
    </label>
  );
}

/**
 * One header + footer shared by every customer email, with a live preview.
 * Rendered in the browser only: it is fully interactive (file upload, color
 * pickers, iframe preview), and skipping server rendering avoids hydration
 * mismatches and keeps the uploaded logo out of the server HTML.
 */
export function EmailLayoutEditor(props: EmailLayoutEditorProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <section className="returbo-card returbo-email-section" aria-busy="true">
        <div className="returbo-card-header" style={{ marginBottom: 16 }}>
          <h2 className="returbo-card-title">Email header &amp; footer</h2>
          <p className="returbo-card-subtitle">Loading email design…</p>
        </div>
      </section>
    );
  }
  return <EmailLayoutEditorContent {...props} />;
}

function EmailLayoutEditorContent({ initialLayout, formLogoUrl, templates, returnsUrl, emailFrom }: EmailLayoutEditorProps) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [layout, setLayout] = useState<EmailLayout>(initialLayout);
  const [logoError, setLogoError] = useState("");
  const [previewId, setPreviewId] = useState(templates[0]?.id ?? "");

  useEffect(() => setLayout(initialLayout), [initialLayout]);

  const set = <K extends keyof EmailLayout>(key: K, value: EmailLayout[K]) =>
    setLayout((current) => ({ ...current, [key]: value }));

  const handleLogoFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!LOGO_TYPES.split(",").includes(file.type)) {
      setLogoError("Use a PNG, JPG, GIF or WebP image (SVG doesn't show in most email apps).");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("Logo must be 300 KB or smaller.");
      return;
    }
    setLogoError("");
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") set("logoUrl", reader.result);
    };
    reader.readAsDataURL(file);
  };

  const previewTemplates = templates.filter((template) => !(template.event === "received" && template.language === "sv"));
  const previewTemplate = previewTemplates.find((template) => template.id === previewId) ?? previewTemplates[0];
  const vars = useMemo(
    () => ({ ...SAMPLE_EMAIL_VARS, storeName: layout.storeName, returnsUrl }),
    [layout.storeName, returnsUrl],
  );
  const previewHtml = useMemo(
    () =>
      renderEmailDocument({
        layout,
        bodyHtml: renderTemplateHtml(
          previewTemplate?.body || "Hi {{customerName}},\n\nThis is how your emails will look.",
          vars,
        ),
        vars,
      }),
    [layout, previewTemplate, vars],
  );

  const saving = fetcher.state !== "idle";
  const saved = fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.message === "Email header and footer saved";

  return (
    <section className="returbo-card returbo-email-section">
      <div className="returbo-card-header" style={{ marginBottom: 16 }}>
        <h2 className="returbo-card-title">Email header &amp; footer</h2>
        <p className="returbo-card-subtitle">
          One header and footer is used for every customer email. Each email below only changes the message in between.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>Header</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <span style={labelStyle}>Logo</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ width: 120, height: 48, border: "1px dashed #d1d5db", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: "#f9fafb", overflow: "hidden" }}>
                    {layout.logoUrl ? (
                      <img src={layout.logoUrl} alt="Email logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
                    ) : (
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>No logo</span>
                    )}
                  </div>
                  <button type="button" className="returbo-btn-secondary" onClick={() => fileInputRef.current?.click()}>
                    Upload logo
                  </button>
                  {formLogoUrl && formLogoUrl !== layout.logoUrl && (
                    <button type="button" className="returbo-btn-secondary" onClick={() => set("logoUrl", formLogoUrl)}>
                      Use return form logo
                    </button>
                  )}
                  {layout.logoUrl && (
                    <button type="button" className="returbo-btn-secondary" onClick={() => set("logoUrl", "")}>
                      Remove
                    </button>
                  )}
                  <input ref={fileInputRef} type="file" accept={LOGO_TYPES} onChange={handleLogoFile} style={{ display: "none" }} aria-label="Upload email logo" />
                </div>
                {logoError && <p role="alert" style={{ ...hintStyle, color: "#b91c1c" }}>{logoError}</p>}
                <p style={hintStyle}>PNG, JPG, GIF or WebP, up to 300 KB. Shown at 48px high.</p>
                <div style={{ marginTop: 8 }}>
                  <Toggle id="email-show-logo" label="Show logo" checked={layout.showLogo} onChange={(v) => set("showLogo", v)} />
                </div>
              </div>

              <div>
                <label htmlFor="email-store-name" style={labelStyle}>Store name</label>
                <input
                  id="email-store-name"
                  type="text"
                  value={layout.storeName}
                  onChange={(e) => set("storeName", e.currentTarget.value)}
                  className="returbo-detail-input"
                  style={{ width: "100%", boxSizing: "border-box", height: 38 }}
                />
                <div style={{ marginTop: 8 }}>
                  <Toggle id="email-show-store-name" label="Show store name in header" checked={layout.showStoreName} onChange={(v) => set("showStoreName", v)} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                <ColorField id="email-header-bg" label="Background" value={layout.headerBgColor} onChange={(v) => set("headerBgColor", v)} />
                <ColorField id="email-header-text" label="Text" value={layout.headerTextColor} onChange={(v) => set("headerTextColor", v)} />
                <ColorField id="email-accent" label="Accent & links" value={layout.accentColor} onChange={(v) => set("accentColor", v)} />
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>Footer</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label htmlFor="email-footer-text" style={labelStyle}>Footer text</label>
                <textarea
                  id="email-footer-text"
                  value={layout.footerText}
                  onChange={(e) => set("footerText", e.currentTarget.value)}
                  rows={4}
                  className="returbo-detail-input"
                  style={{ width: "100%", boxSizing: "border-box", padding: 10, fontFamily: "inherit", resize: "vertical" }}
                />
                <p style={hintStyle}>
                  Line breaks are kept. You can use <code>{"{{storeName}}"}</code>, <code>{"{{current_year}}"}</code> and <code>{"{{returnsUrl}}"}</code>, or write HTML for links.
                </p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                <ColorField id="email-footer-bg" label="Background" value={layout.footerBgColor} onChange={(v) => set("footerBgColor", v)} />
                <ColorField id="email-footer-text-color" label="Text" value={layout.footerTextColor} onChange={(v) => set("footerTextColor", v)} />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="returbo-btn-primary"
              disabled={saving}
              onClick={() =>
                fetcher.submit({ _action: "save_email_layout", layout: JSON.stringify(layout) }, { method: "post" })
              }
            >
              {saving ? "Saving…" : "Save header & footer"}
            </button>
            <button type="button" className="returbo-btn-secondary" disabled={saving} onClick={() => setLayout(initialLayout)}>
              Discard changes
            </button>
            {saved && <span role="status" style={{ color: "#15803d", fontSize: 13, fontWeight: 600 }}>Saved</span>}
            {fetcher.state === "idle" && fetcher.data && !fetcher.data.ok && (
              <span role="alert" style={{ color: "#b91c1c", fontSize: 13 }}>{fetcher.data.message}</span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          {previewTemplates.length > 0 && (
            <div>
              <label htmlFor="email-preview-template" style={labelStyle}>Preview with</label>
              <select
                id="email-preview-template"
                value={previewTemplate?.id ?? ""}
                onChange={(e) => setPreviewId(e.currentTarget.value)}
                className="returbo-detail-input"
                style={{ width: "100%", height: 38, background: "#ffffff" }}
              >
                {previewTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.event.replaceAll("_", " ")} ({t.language.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
          )}
          <EmailPreview
            subject={renderTemplate(previewTemplate?.subject || "Your return update", vars)}
            html={previewHtml}
            from={emailFrom || undefined}
          />
        </div>
      </div>
    </section>
  );
}

export default EmailLayoutEditor;
