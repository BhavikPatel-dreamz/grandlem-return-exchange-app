/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { listEmailTemplates, upsertEmailTemplate, deleteEmailTemplate } from "../services/email-templates.server";
import { sendEmail } from "../services/email.server";
import { SettingsLayout } from "../components/admin/SettingsLayout";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const templates = await listEmailTemplates(session.shop);
  return { shop: session.shop, templates };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("_action") || "");
  try {
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
      const subject = String(formData.get("subject") || "Test");
      const body = String(formData.get("body") || "");
      await sendEmail(to, subject, body);
      return { ok: true, message: "Test email sent (logged)" };
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

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initial || "";
    if (hiddenRef.current) hiddenRef.current.value = initial || "";
  }, [initial]);

  const sync = () => {
    if (editorRef.current && hiddenRef.current) hiddenRef.current.value = editorRef.current.innerHTML;
  };

  const exec = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    sync();
  };

  return (
    <div style={{ border: "1px solid #ccc", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 8, padding: 8, borderBottom: "1px solid #ddd", background: "#f7f7f7", flexWrap: "wrap" }}>
        <button type="button" onClick={() => exec("bold")}><strong>B</strong></button>
        <button type="button" onClick={() => exec("italic")}><em>I</em></button>
        <button type="button" onClick={() => exec("underline")}><u>U</u></button>
        <button type="button" onClick={() => exec("insertUnorderedList")}>• List</button>
        <button type="button" onClick={() => {
          const url = window.prompt("Link URL");
          if (url) exec("createLink", url);
        }}>Link</button>
        <button type="button" onClick={() => exec("undo")}>Undo</button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={sync}
        style={{ minHeight: 180, padding: 12, outline: "none" }}
      />
      <input ref={hiddenRef} type="hidden" name={name} defaultValue={initial || ""} />
    </div>
  );
}

export default function EmailTemplatesPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

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
              </div>
              <button
                type="button"
                className="returbo-btn-primary"
                onClick={() => setMode("create")}
              >
                Add template
              </button>
            </div>

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
            <s-stack direction="block" gap="base">
              <s-select name="event" label="Event">
                {EVENT_OPTIONS.map((e) => <s-option key={e} value={e}>{e}</s-option>)}
              </s-select>
              <s-select name="language" label="Language">
                <s-option value="en">English</s-option>
                <s-option value="sv">Swedish</s-option>
              </s-select>
              <s-text-field name="subject" label="Subject" />
              <RichTextEditor name="body" />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <div>
                  <s-button type="submit" variant="primary">Create</s-button>
                </div>
                <div>
                  <s-button variant="tertiary" onClick={() => setMode("list")}>Cancel</s-button>
                </div>
              </div>
            </s-stack>
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
            <input type="hidden" name="_action" value="save_template" />
            <input type="hidden" name="id" value={editingTemplate.id} />
            <s-stack direction="block" gap="base">
              <s-select name="event" label="Event" value={editingTemplate.event}>
                {EVENT_OPTIONS.map((e) => <s-option key={e} value={e}>{e}</s-option>)}
              </s-select>
              <s-select name="language" label="Language" value={editingTemplate.language}>
                <s-option value="en">English</s-option>
                <s-option value="sv">Swedish</s-option>
              </s-select>
              <s-text-field name="subject" label="Subject" value={editingTemplate.subject} />
              <RichTextEditor name="body" initial={editingTemplate.body} />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <div>
                  <s-button type="submit" variant="primary">Save</s-button>
                </div>
                <div>
                  <s-button variant="tertiary" onClick={() => { setMode("list"); setEditingId(null); }}>Back to list</s-button>
                </div>
              </div>
            </s-stack>
          </Form>
          <div style={{ borderTop: "1px solid var(--returbo-border)", marginTop: 20, paddingTop: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px 0" }}>Test Email Delivery</h3>
            <Form method="post">
              <input type="hidden" name="_action" value="test_send" />
              <input type="hidden" name="subject" value={editingTemplate.subject} />
              <input type="hidden" name="body" value={editingTemplate.body} />
              <s-stack direction="inline" gap="base">
                <s-text-field name="testEmail" label="Test email address" />
                <div>
                  <s-button type="submit" variant="tertiary">Test send</s-button>
                </div>
              </s-stack>
            </Form>
          </div>
          <div style={{ borderTop: "1px solid var(--returbo-border)", marginTop: 16, paddingTop: 16 }}>
            <Form method="post">
              <input type="hidden" name="_action" value="delete_template" />
              <input type="hidden" name="id" value={editingTemplate.id} />
              <div>
                <s-button type="submit" variant="tertiary">Delete template</s-button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </SettingsLayout>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
