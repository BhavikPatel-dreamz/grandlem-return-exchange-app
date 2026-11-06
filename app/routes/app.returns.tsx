/* eslint-disable @typescript-eslint/no-explicit-any */
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const status = url.searchParams.get("status")?.trim() || "";
  const carrier = url.searchParams.get("carrier")?.trim() || "";

  const where: any = { shop };
  if (status) where.status = status;
  if (carrier) where.carrierId = carrier;
  if (q) {
    where.OR = [
      { orderNumber: { contains: q } },
      { customerEmail: { contains: q } },
      { customerName: { contains: q } },
    ];
  }

  const requests = await prisma.returnRequest.findMany({
    where,
    include: { label: true, items: true },
    orderBy: { submittedAt: "desc" },
    take: 100,
  });

  const carriers = await prisma.carrier.findMany({ where: { shop } });

  return { shop, requests, carriers, filters: { q, status, carrier } };
};

export default function ReturnsListPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Return requests">
      <Form method="get" style={{ marginBottom: 16 }}>
        <s-stack direction="inline" gap="base">
          <s-text-field name="q" label="Search (order/customer)" value={data.filters.q} />
          <s-select name="status" label="Status" value={data.filters.status}>
            <s-option value="">All</s-option>
            <s-option value="Submitted">Submitted</s-option>
            <s-option value="Pending Approval">Pending Approval</s-option>
            <s-option value="Approved">Approved</s-option>
            <s-option value="Label Created">Label Created</s-option>
            <s-option value="Rejected">Rejected</s-option>
            <s-option value="Received">Received</s-option>
            <s-option value="Completed">Completed</s-option>
          </s-select>
          <s-button type="submit">Filter</s-button>
        </s-stack>
      </Form>

      <s-section heading="Requests">
        <s-unordered-list>
          {data.requests.map((r: any) => (
            <s-list-item key={r.id}>
              {r.reviewFlagged ? "⚠ " : ""}
              <s-link href={`/app/returns/${r.id}`}>
                {r.orderNumber || r.shopifyOrderId}
              </s-link>{" "}
              – {r.type} – {r.status} – {r.customerEmail || ""}{" "}
              {r.label?.trackingNumber ? `(Tracking: ${r.label.trackingNumber})` : ""}
            </s-list-item>
          ))}
          {data.requests.length === 0 && <s-paragraph>No return requests found.</s-paragraph>}
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (a) => boundary.headers(a);
