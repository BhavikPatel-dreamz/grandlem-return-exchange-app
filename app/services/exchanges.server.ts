/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getOrCreateSettings } from "./settings.server";

export type PriceComparison = {
  originalPrice: number;
  replacementPrice: number;
  difference: number; // replacement - original (per unit)
};

type VariantDetails = {
  price: number;
  title: string;
  productStatus: string;
  availableByLocation: Map<string, number>;
};

async function fetchVariantDetails(shop: string, variantIds: string[]) {
  const { admin } = await unauthenticated.admin(shop);
  const ids = variantIds.map((id) =>
    id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`,
  );
  const query = `#graphql
    query variants($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          price
          title
          product { status }
          inventoryItem {
            inventoryLevels(first: 250) {
              edges {
                node {
                  location { id }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  `;
  const res = await admin.graphql(query, { variables: { ids } });
  const json = await res.json();
  const map = new Map<string, VariantDetails>();
  for (const node of json?.data?.nodes || []) {
    if (!node?.id) continue;
    const availableByLocation = new Map<string, number>();
    for (const edge of node.inventoryItem?.inventoryLevels?.edges || []) {
      const locationId = edge?.node?.location?.id;
      const available = edge?.node?.quantities?.find(
        (quantity: any) => quantity.name === "available",
      )?.quantity;
      if (locationId)
        availableByLocation.set(locationId, Number(available || 0));
    }
    map.set(node.id, {
      price: Number(node.price),
      title: node.title,
      productStatus: node.product?.status || "",
      availableByLocation,
    });
  }
  return map;
}

async function fetchOriginalUnitPrices(shop: string, orderId: string) {
  if (!orderId)
    throw new Error(
      "Original order is unavailable; exchange pricing cannot be validated.",
    );
  const { admin } = await unauthenticated.admin(shop);
  const gid = orderId.startsWith("gid://")
    ? orderId
    : `gid://shopify/Order/${orderId}`;
  const response = await admin.graphql(
    `#graphql
    query ExchangeOriginalLinePrices($id: ID!) {
      order(id: $id) {
        lineItems(first: 250) {
          nodes {
            id
            currentQuantity
            priceAfterAllDiscountsBeforeTaxesSet { shopMoney { amount } }
          }
        }
      }
    }
  `,
    { variables: { id: gid } },
  );
  const json = await response.json();
  const prices = new Map<string, number>();
  for (const line of json?.data?.order?.lineItems?.nodes || []) {
    const quantity = Number(line.currentQuantity);
    const total = Number(
      line.priceAfterAllDiscountsBeforeTaxesSet?.shopMoney?.amount,
    );
    if (line.id && quantity > 0 && Number.isFinite(total))
      prices.set(line.id, total / quantity);
  }
  return prices;
}

async function resolveFulfillmentLocationId(
  shop: string,
  returnRequestId: string,
  orderId: string | null,
  savedLocationId: string | null,
) {
  if (savedLocationId) return savedLocationId;
  if (!orderId)
    throw new Error("Original order is unavailable; replacement stock cannot be validated.");

  const { admin } = await unauthenticated.admin(shop);
  const gid = orderId.startsWith("gid://") ? orderId : `gid://shopify/Order/${orderId}`;
  const response = await admin.graphql(`#graphql
    query ExchangeFulfillmentLocation($id: ID!) {
      order(id: $id) {
        fulfillmentOrders(first: 50) {
          nodes { assignedLocation { location { id } } }
        }
      }
    }
  `, { variables: { id: gid } });
  const json = await response.json();
  const locationId = json?.data?.order?.fulfillmentOrders?.nodes
    ?.map((node: any) => node?.assignedLocation?.location?.id)
    .find(Boolean);
  if (!locationId)
    throw new Error("Shopify has not assigned this order to a fulfillment location yet; assign the original order before validating replacement stock.");

  await prisma.returnRequest.update({
    where: { id: returnRequestId },
    data: { fulfillmentLocationId: locationId },
  });
  return locationId as string;
}

export async function calculateExchangeDifference(
  shop: string,
  originalVariantId: string,
  replacementVariantId: string,
  quantity: number,
  fulfillmentLocationId: string,
  originalUnitPrice?: number,
) {
  if (!fulfillmentLocationId)
    throw new Error(
      "Original fulfillment location is unavailable; replacement stock cannot be validated.",
    );
  const map = await fetchVariantDetails(shop, [
    originalVariantId,
    replacementVariantId,
  ]);
  const originalId = originalVariantId.startsWith("gid://")
    ? originalVariantId
    : `gid://shopify/ProductVariant/${originalVariantId}`;
  const replacementId = replacementVariantId.startsWith("gid://")
    ? replacementVariantId
    : `gid://shopify/ProductVariant/${replacementVariantId}`;
  const original = map.get(originalId);
  const replacement = map.get(replacementId);
  if (!original)
    throw new Error("Original product variant could not be found.");
  if (!replacement)
    throw new Error("Replacement product variant could not be found.");
  if (replacement.productStatus !== "ACTIVE")
    throw new Error("Replacement product is not active.");
  const available =
    replacement.availableByLocation.get(fulfillmentLocationId) || 0;
  if (available < quantity)
    throw new Error(
      `Replacement product has only ${available} available at the original fulfillment location; ${quantity} required.`,
    );
  const originalPrice = originalUnitPrice ?? original.price;
  const replacementPrice = replacement.price;
  const diffPerUnit = replacementPrice - originalPrice;
  return {
    originalPrice,
    replacementPrice,
    difference: diffPerUnit * quantity,
  } as { originalPrice: number; replacementPrice: number; difference: number };
}

export async function applyReplacementVariants(
  returnRequestId: string,
  replacements: { returnItemId: string; replacementVariantId: string }[],
) {
  let totalDifference = 0;
  const rr = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    include: { items: true },
  });
  if (!rr) throw new Error("Return request not found");
  if (rr.type !== "exchange")
    throw new Error(
      "Replacement variants can only be set for exchange requests.",
    );
  const fulfillmentLocationId = await resolveFulfillmentLocationId(
    rr.shop,
    rr.id,
    rr.shopifyOrderId,
    rr.fulfillmentLocationId,
  );
  const originalUnitPrices = await fetchOriginalUnitPrices(
    rr.shop,
    rr.shopifyOrderId || "",
  );

  for (const r of replacements) {
    const item = rr.items.find((it: any) => it.id === r.returnItemId);
    if (!item) continue;
    const quantity = item.returnedQuantity || item.quantity;
    const originalUnitPrice = originalUnitPrices.get(
      item.shopifyLineItemId || "",
    );
    if (originalUnitPrice === undefined)
      throw new Error(
        `Original price for ${item.title || "replacement item"} could not be found.`,
      );
    const comp = await calculateExchangeDifference(
      rr.shop,
      item.variantId || "",
      r.replacementVariantId,
      quantity,
      fulfillmentLocationId,
      originalUnitPrice,
    );
    totalDifference += comp.difference;
    await prisma.returnItem.update({
      where: { id: item.id },
      data: {
        replacementVariantId: r.replacementVariantId,
        priceDifferenceStr: comp.difference.toFixed(2),
      },
    });
  }

  return totalDifference;
}

export async function createExchangePaymentLink(
  shop: string,
  returnRequestId: string,
  email: string | null,
) {
  const rr = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, shop },
    include: { items: true },
  });
  if (!rr) throw new Error("Return request not found");
  if (rr.type !== "exchange")
    throw new Error("This request is not an exchange.");
  if (
    rr.items.length === 0 ||
    rr.items.some((item) => !item.replacementVariantId)
  ) {
    throw new Error(
      "Select a replacement product for every exchanged item first.",
    );
  }
  const fulfillmentLocationId = await resolveFulfillmentLocationId(
    shop,
    rr.id,
    rr.shopifyOrderId,
    rr.fulfillmentLocationId,
  );

  const originalUnitPrices = await fetchOriginalUnitPrices(
    shop,
    rr.shopifyOrderId || "",
  );
  const comparisons = await Promise.all(
    rr.items.map(async (item) => {
      const quantity = item.returnedQuantity || item.quantity;
      const originalUnitPrice = originalUnitPrices.get(
        item.shopifyLineItemId || "",
      );
      if (originalUnitPrice === undefined) {
        throw new Error(
          `Original price for ${item.title || "replacement item"} could not be found.`,
        );
      }
      const comparison = await calculateExchangeDifference(
        shop,
        item.variantId || "",
        item.replacementVariantId!,
        quantity,
        fulfillmentLocationId,
        originalUnitPrice,
      );
      return { item, quantity, comparison };
    }),
  );
  const originalTotal = comparisons.reduce(
    (sum, row) => sum + row.comparison.originalPrice * row.quantity,
    0,
  );
  const replacementTotal = comparisons.reduce(
    (sum, row) => sum + row.comparison.replacementPrice * row.quantity,
    0,
  );
  const total = Math.max(0, replacementTotal - originalTotal);

  const { admin } = await unauthenticated.admin(shop);
  const orderId = rr.shopifyOrderId?.startsWith("gid://")
    ? rr.shopifyOrderId
    : `gid://shopify/Order/${rr.shopifyOrderId}`;
  const orderResponse = await admin.graphql(
    `#graphql
    query ExchangeShippingAddress($id: ID!) {
      order(id: $id) {
        shippingAddress {
          address1
          address2
          city
          company
          countryCodeV2
          firstName
          lastName
          phone
          province
          zip
        }
      }
    }
  `,
    { variables: { id: orderId } },
  );
  const shippingAddress = (await orderResponse.json())?.data?.order
    ?.shippingAddress;
  if (!shippingAddress?.address1 || !shippingAddress?.countryCodeV2) {
    throw new Error(
      "The original order has no complete shipping address for the replacement order.",
    );
  }

  const settings = await getOrCreateSettings(shop);
  const reserveUntil = new Date(
    Date.now() + settings.exchangeReserveDays * 24 * 60 * 60 * 1000,
  );
  const exchangeTag = `return-exchange:${rr.id}`;
  const lineItems = comparisons.map(({ item, quantity }) => ({
    variantId: item.replacementVariantId!.startsWith("gid://")
      ? item.replacementVariantId!
      : `gid://shopify/ProductVariant/${item.replacementVariantId}`,
    quantity,
  }));
  const discountAmount = Math.min(originalTotal, replacementTotal);
  const createRes = await admin.graphql(
    `#graphql
    mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id invoiceUrl }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          email: email || undefined,
          shippingAddress: {
            address1: shippingAddress.address1,
            address2: shippingAddress.address2,
            city: shippingAddress.city,
            company: shippingAddress.company,
            countryCode: shippingAddress.countryCodeV2,
            firstName: shippingAddress.firstName,
            lastName: shippingAddress.lastName,
            phone: shippingAddress.phone,
            province: shippingAddress.province,
            zip: shippingAddress.zip,
          },
          lineItems,
          appliedDiscount:
            discountAmount > 0
              ? {
                  title: "Exchange credit",
                  valueType: "FIXED_AMOUNT",
                  value: Number(discountAmount.toFixed(2)),
                }
              : undefined,
          reserveInventoryUntil: reserveUntil.toISOString(),
          tags: [exchangeTag],
          customAttributes: [{ key: "return_request_id", value: rr.id }],
          note: `Exchange for return ${rr.id}`,
        },
      },
    },
  );
  const json = await createRes.json();
  const errors = json?.data?.draftOrderCreate?.userErrors;
  if (errors && errors.length)
    throw new Error(errors.map((e: any) => e.message).join(", "));
  const draft = json?.data?.draftOrderCreate?.draftOrder;
  const invoiceUrl = draft?.invoiceUrl;
  if (!draft?.id) throw new Error("Exchange draft order id missing");

  if (total <= 0) {
    const completeResponse = await admin.graphql(
      `#graphql
      mutation CompleteFreeExchange($id: ID!) {
        draftOrderComplete(id: $id) {
          draftOrder { order { id } }
          userErrors { field message }
        }
      }
    `,
      { variables: { id: draft.id } },
    );
    const completeJson = await completeResponse.json();
    const completeErrors = completeJson?.data?.draftOrderComplete?.userErrors;
    if (completeErrors?.length)
      throw new Error(
        completeErrors.map((error: any) => error.message).join(", "),
      );
    const replacementOrderId =
      completeJson?.data?.draftOrderComplete?.draftOrder?.order?.id;
    if (!replacementOrderId)
      throw new Error("Completed exchange order id missing");

    await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: {
        status: "Paid",
        draftOrderId: draft.id,
        replacementOrderId,
        finalResolution: "EXCHANGE",
        reservedUntil: reserveUntil,
      },
    });
    return {
      required: false,
      total,
      draftOrderId: draft.id,
      orderId: replacementOrderId,
    };
  }
  if (!invoiceUrl)
    throw new Error("Shopify invoice URL missing for the exchange draft order");

  await prisma.returnRequest.update({
    where: { id: returnRequestId },
    data: {
      status: "Awaiting Payment",
      draftOrderId: draft.id,
      reservedUntil: reserveUntil,
    },
  });

  return { required: true, total, invoiceUrl, draftOrderId: draft.id };
}
