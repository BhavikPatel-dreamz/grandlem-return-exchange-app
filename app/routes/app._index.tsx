import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function DashboardPage() {
  return (
    <s-page heading="Dashboard">
      <s-section heading="Quick links">
        <s-stack direction="block" gap="base">
          <s-link href="/app/returns">Returns</s-link>
          <s-link href="/app/email-templates">Email templates</s-link>
          <s-link href="/app/settings">Settings</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};