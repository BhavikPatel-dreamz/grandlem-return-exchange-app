/* eslint-disable @typescript-eslint/no-explicit-any */
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

export default function EmailTemplatesPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Email templates">
      {actionData?.message && <s-banner>{actionData.message}</s-banner>}

      <s-section heading="Templates">
        {data.templates.map((t: any) => (
          <s-box key={t.id} padding="base" borderWidth="base" borderRadius="base">
            <Form method="post">
              <input type="hidden" name="_action" value="save_template" />
              <input type="hidden" name="id" value={t.id} />
              <s-stack direction="block" gap="base">
                <s-select name="event" label="Event" value={t.event}>
                  <s-option value="received">received</s-option>
                  <s-option value="approved">approved</s-option>
                  <s-option value="rejected">rejected</s-option>
                  <s-option value="payment_required">payment_required</s-option>
                  <s-option value="refund_issued">refund_issued</s-option>
                  <s-option value="item_received">item_received</s-option>
                  <s-option value="replacement_sent">replacement_sent</s-option>
                  <s-option value="store_credit_issued">store_credit_issued</s-option>
                  <s-option value="withdrawal">withdrawal</s-option>
                </s-select>
                <s-select name="language" label="Language" value={t.language}>
                  <s-option value="en">English</s-option>
                  <s-option value="sv">Swedish</s-option>
                </s-select>
                <s-text-field name="subject" label="Subject" value={t.subject} />
                <s-text-area name="body" label="Body" value={t.body} />
                <s-button type="submit">Save</s-button>
              </s-stack>
            </Form>
            <Form method="post">
              <input type="hidden" name="_action" value="test_send" />
              <input type="hidden" name="subject" value={t.subject} />
              <input type="hidden" name="body" value={t.body} />
              <s-text-field name="testEmail" label="Test email address" />
              <s-button type="submit" variant="tertiary">Test send</s-button>
            </Form>
            <Form method="post" style={{ marginTop: 8 }}>
              <input type="hidden" name="_action" value="delete_template" />
              <input type="hidden" name="id" value={t.id} />
              <s-button type="submit" variant="tertiary">Delete</s-button>
            </Form>
          </s-box>
        ))}
      </s-section>

      <s-section heading="New template">
        <Form method="post">
          <input type="hidden" name="_action" value="save_template" />
          <s-stack direction="block" gap="base">
            <s-select name="event" label="Event">
              <s-option value="received">received</s-option>
              <s-option value="approved">approved</s-option>
              <s-option value="rejected">rejected</s-option>
              <s-option value="payment_required">payment_required</s-option>
              <s-option value="refund_issued">refund_issued</s-option>
              <s-option value="item_received">item_received</s-option>
              <s-option value="replacement_sent">replacement_sent</s-option>
              <s-option value="store_credit_issued">store_credit_issued</s-option>
              <s-option value="withdrawal">withdrawal</s-option>
            </s-select>
            <s-select name="language" label="Language">
              <s-option value="en">English</s-option>
              <s-option value="sv">Swedish</s-option>
            </s-select>
            <s-text-field name="subject" label="Subject" />
            <s-text-area name="body" label="Body" />
            <s-button type="submit">Create</s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
