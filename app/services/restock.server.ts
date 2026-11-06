/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getOrCreateSettings, parseJson } from "./settings.server";

export async function resolveRestockLocation(shop: string, market: string | null): Promise<string | null> {
  const settings = await getOrCreateSettings(shop);
  const map = parseJson<Record<string, string>>(settings.shopifyLocationIdPerMarket, {});
  const key = (market || "DEFAULT").toUpperCase();
  const locationId = map[key] || map["DEFAULT"] || Object.values(map)[0];
  if (locationId) return locationId;

  // Fall back to first available Shopify location.
  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(`#graphql
      query locations { locations(first: 1) { edges { node { id } } } }
    `);
    const json = await res.json();
    return json?.data?.locations?.edges?.[0]?.node?.id ?? null;
  } catch {
    return null;
  }
}

async function fetchInventoryItemId(shop: string, variantId: string): Promise<string | null> {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const id = variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;
    const res = await admin.graphql(
      `#graphql
      query variantInv($id: ID!) { node(id: $id) { ... on ProductVariant { inventoryItem { id } } } }`,
      { variables: { id } },
    );
    const json = await res.json();
    return json?.data?.node?.inventoryItem?.id ?? null;
  } catch {
    return null;
  }
}

export async function performRestock(
  shop: string,
  returnItemId: string,
  locationId?: string | null,
  quantityOverride?: number,
): Promise<{ ok: boolean; error?: string }> {
  const item = await prisma.returnItem.findUnique({
    where: { id: returnItemId },
    include: { returnRequest: true },
  });
  if (!item || !item.variantId) return { ok: false, error: "Item or variant missing" };

  const market = item.returnRequest.market;
  const loc = locationId ?? await resolveRestockLocation(shop, market);
  if (!loc) return { ok: false, error: "No restock location configured" };

  const inventoryItemId = await fetchInventoryItemId(shop, item.variantId);
  if (!inventoryItemId) return { ok: false, error: "Inventory item not found" };

  const qty = quantityOverride ?? item.returnedQuantity ?? item.quantity ?? 1;

  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(
      `#graphql
      mutation adjustInventory($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            reason: "correction",
            name: "available",
            changes: [{ inventoryItemId, locationId: loc, delta: qty }],
          },
        },
      },
    );
    const json = await res.json();
    const errors = json?.data?.inventoryAdjustQuantities?.userErrors;
    if (errors && errors.length) return { ok: false, error: errors.map((e: any) => e.message).join(", ") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Inventory adjustment failed" };
  }

  await prisma.returnItem.update({
    where: { id: returnItemId },
    data: { restocked: true, restockedAt: new Date(), restockDecision: item.restockDecision || "manual", restockLocationId: loc },
  });
  return { ok: true };
}

export async function autoRestockForRequest(returnRequestId: string): Promise<void> {
  const rr = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    include: { items: { include: { reason: true } } },
  });
  if (!rr) return;
  if (rr.type === "complaint") return; // complaints never auto-restocked

  for (const item of rr.items) {
    if (item.reason?.autoRestock) {
      await prisma.returnItem.update({ where: { id: item.id }, data: { restockDecision: "auto" } });
      await performRestock(rr.shop, item.id).catch(() => null);
    }
  }
}
