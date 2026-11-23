/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { storefrontReturnsUrl } from "../services/storefront-links.server";
import { listEmailTemplates, upsertEmailTemplate, deleteEmailTemplate } from "../services/email-templates.server";
import { sendEmail, renderTemplate } from "../services/email.server";
import { getOrCreateSettings, updateSettings } from "../services/settings.server";
import { SettingsLayout } from "../components/admin/SettingsLayout";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const templates = await listEmailTemplates(session.shop);
  const settings = await getOrCreateSettings(session.shop);
  return { shop: session.shop, templates, emailFrom: settings.emailFrom || "", returnsUrl: storefrontReturnsUrl(session.shop) };
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
        labelLink: "",
        trackingLink: "",
        returnsUrl: "/returns",
      };
      const subject = renderTemplate(
        templateSubject,
        testVars
      );
      const body = renderTemplate(
        templateBody,
        testVars
      );
      const settings = await getOrCreateSettings(shop);
      const result = await sendEmail(to, subject, body, settings.emailFrom || undefined);
      return { ok: result.ok, message: result.ok ? "Template saved and test email sent" : "Template saved, but test email could not be sent" };
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

function RichTextEditor({ name, initial }: { name: string; initial?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const [htmlMode, setHtmlMode] = useState(false);
  const [htmlSource, setHtmlSource] = useState(initial || "");

  useEffect(() => {
    const value = initial || "";
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

export default function EmailTemplatesPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const templateActionRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingTemplate = data.templates.find((t: any) => t.id === editingId) ?? null;

  return (
    <SettingsLayout activeTab="emails">
      {actionData?.message && <div className="returbo-banner">{actionData.message}</div>}

      {mode === "list" && (
        <div className="returbo-email-page">
          <section className="returbo-card returbo-email-section">
            <div className="returbo-card-header">
              <h2 className="returbo-card-title">Customer return form customization</h2>
              <p className="returbo-card-subtitle">Manage your return form, logo, and email notifications to create a custom return experience that suits your brand.</p>
            </div>

            <div className="returbo-logo-settings">
              <h3>Your logo</h3>
              <p>Recommended minimum resolution 512×512 px. The logo should be square shaped. Please check how the logo is displayed in your digital return form after uploading. Accepted file types: .jpg, .png.</p>
              <div className="returbo-upload-preview"><span className="returbo-upload-file-icon" /> <span className="returbo-upload-button">Choose file</span><span>No file chosen</span></div>
              <div className="returbo-static-check"><span />Show the logo in the digital return form.</div>
              <div className="returbo-static-check"><span />Show the name of the store in the digital return form.</div>
              <p className="returbo-static-check-help">You can choose to display the name of your company and your logo on the digital return form.</p>
            </div>

            <div className="returbo-return-form-preview">
              <div className="returbo-preview-options">
                <div className="returbo-palette-heading"><h3>Digital Return Form color palette</h3><span>Plus</span><span>Premium</span><span>Enterprise plan</span><p>Customize and adjust the colors to tailor the Digital Return Form to your brand.</p></div>
                <div className="returbo-preview-option">
                  <span className="returbo-preview-swatch returbo-preview-swatch-primary" />
                  <div><strong>Main primary color</strong><span>Used for as background for primary buttons and as an action color for links, icons, etc.</span></div>
                </div>
                <div className="returbo-preview-option">
                  <span className="returbo-preview-swatch returbo-preview-swatch-dark" />
                  <div><strong>Primary text color</strong><span>Used for as the text color for headings and other primary elements.</span></div>
                </div>
                <div className="returbo-preview-option">
                  <span className="returbo-preview-swatch" />
                  <div><strong>Text color</strong><span>Used for the text for buttons and as a check icon color for when the item is selected.</span></div>
                </div>
                <div className="returbo-preview-option">
                  <span className="returbo-preview-swatch returbo-preview-swatch-soft" />
                  <div><strong>Secondary background color</strong><span>Used for as a background for secondary buttons and as a background color for badges.</span></div>
                </div>
                <div className="returbo-palette-actions"><button type="button">Back to default</button><button type="button" disabled>Save palette</button></div>
              </div>

              <div className="returbo-return-preview" aria-label="Customer return form preview">
                <span className="returbo-preview-eyebrow">Preview</span>
                <h3>Pick what you&apos;d like to return.</h3>
                <p>Order <strong>#1234</strong> · Placed Mar 2, 2026 · Shipped Mar 4, 2026</p>
                <div className="returbo-preview-deadline"><b>●</b> You have until <strong>Mar 14, 2026</strong> to return items from this order (12 days).</div>
                <div className="returbo-preview-item"><span className="returbo-preview-product" /><span><strong>Organic Woollen Pullover</strong><small>L / Ivory<br />2 199.00 SEK</small></span><span className="returbo-preview-price">✓</span></div>
                <div className="returbo-preview-links">⌕ &nbsp; Edit item &nbsp;&nbsp; ♜ &nbsp; Delete from request</div>
                <button type="button" className="returbo-preview-submit">➤ &nbsp; Send in request</button>
                <div className="returbo-preview-colors"><strong>Color *</strong><div><span>Ivory</span><span>White</span><span>Peach</span><span>Navy blue</span><span className="active">Calm pink ✓</span></div></div>
                <button type="button" className="returbo-preview-confirm">⌄ &nbsp; Confirm</button>
              </div>
            </div>
          </section>

          <section className="returbo-card returbo-email-section">
            <div className="returbo-card-header">
              <h2 className="returbo-card-title">Return policy form</h2>
              <p className="returbo-card-subtitle">The policy content customers see before they submit a return request.</p>
            </div>
            <div className="returbo-policy-note">Please ensure your return and exchange policy includes the information customers need before submitting a request.</div>
            <article className="returbo-policy-preview">
              <div className="returbo-policy-preview-header"><span className="returbo-badge returbo-badge-pink">English (US)</span><span>Policy preview</span></div>
              <h3>Return policy</h3>
              <p>Items can be returned within the return window configured in your settings. The item must be unused and returned in its original condition and packaging.</p>
              <a href="#return-policy" onClick={(event) => event.preventDefault()}>Collapse text</a>
            </article>
          </section>

          <section className="returbo-card returbo-email-section">
            <div className="returbo-card-header returbo-email-section-header">
              <div>
                <h2 className="returbo-card-title">Customer notification emails</h2>
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
                  <option value="sv">Swedish</option>
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
                  <option value="sv">Swedish</option>
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
