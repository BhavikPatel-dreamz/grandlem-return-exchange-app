/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { listEmailTemplates, upsertEmailTemplate, deleteEmailTemplate } from "../services/email-templates.server";
import { sendEmail } from "../services/email.server";

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
    <s-page heading="Email templates">
      {actionData?.message && <s-banner>{actionData.message}</s-banner>}

      {mode === "list" && (
        <>
          <div style={{ marginBottom: 12 }}>
            <s-button onClick={() => setMode("create")}>Add template</s-button>
          </div>
          <s-section heading={`Templates (${data.templates.length})`}>
            {data.templates.length === 0 && <s-paragraph>No templates yet. Create one.</s-paragraph>}
            <s-stack direction="block" gap="base">
              {data.templates.map((t: any) => (
                <s-box key={t.id} padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="base">
                    <s-paragraph><strong>{t.event}</strong> ({t.language})</s-paragraph>
                    <s-paragraph>{t.subject}</s-paragraph>
                    <s-stack direction="inline" gap="base">
                      <s-button onClick={() => { setEditingId(t.id); setMode("edit"); }}>Edit</s-button>
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="_action" value="delete_template" />
                        <input type="hidden" name="id" value={t.id} />
                        <s-button type="submit" variant="tertiary">Delete</s-button>
                      </Form>
                    </s-stack>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          </s-section>
        </>
      )}

      {mode === "create" && (
        <s-section heading="New template">
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
              <s-stack direction="inline" gap="base">
                <s-button type="submit">Create</s-button>
                <s-button variant="tertiary" onClick={() => setMode("list")}>Cancel</s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-section>
      )}

      {mode === "edit" && editingTemplate && (
        <s-section heading={`Edit template: ${editingTemplate.event} (${editingTemplate.language})`}>
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
              <s-stack direction="inline" gap="base">
                <s-button type="submit">Save</s-button>
                <s-button variant="tertiary" onClick={() => { setMode("list"); setEditingId(null); }}>Back to list</s-button>
              </s-stack>
            </s-stack>
          </Form>
          <Form method="post" style={{ marginTop: 8 }}>
            <input type="hidden" name="_action" value="test_send" />
            <input type="hidden" name="subject" value={editingTemplate.subject} />
            <input type="hidden" name="body" value={editingTemplate.body} />
            <s-text-field name="testEmail" label="Test email address" />
            <s-button type="submit" variant="tertiary">Test send</s-button>
          </Form>
          <Form method="post" style={{ marginTop: 8 }}>
            <input type="hidden" name="_action" value="delete_template" />
            <input type="hidden" name="id" value={editingTemplate.id} />
            <s-button type="submit" variant="tertiary">Delete</s-button>
          </Form>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
