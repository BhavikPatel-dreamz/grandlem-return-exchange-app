-- AlterTable
ALTER TABLE "ReturnItem" ADD COLUMN "itemResolution" TEXT;

-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN "draftOrderId" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN "reservedUntil" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "returnDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "exchangeDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "complaintDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "autoRefundOnInspection" BOOLEAN NOT NULL DEFAULT false,
    "refundShippingCost" BOOLEAN NOT NULL DEFAULT false,
    "deflectionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "storeCreditEnabled" BOOLEAN NOT NULL DEFAULT true,
    "storeCreditMethod" TEXT NOT NULL DEFAULT 'gift_card',
    "storeCreditBonusPercent" INTEGER NOT NULL DEFAULT 10,
    "storeCreditIssueTiming" TEXT NOT NULL DEFAULT 'on_inspection',
    "complaintResolutionMode" TEXT NOT NULL DEFAULT 'customer_chooses',
    "complaintRequireItemReturn" BOOLEAN NOT NULL DEFAULT true,
    "exchangeShipTiming" TEXT NOT NULL DEFAULT 'SHIP_IMMEDIATELY',
    "exchangeReserveDays" INTEGER NOT NULL DEFAULT 7,
    "offerCreditWhenUnavailable" BOOLEAN NOT NULL DEFAULT true,
    "claimRequiresPhoto" BOOLEAN NOT NULL DEFAULT true,
    "claimMinPhotos" INTEGER NOT NULL DEFAULT 1,
    "claimMinCommentLength" INTEGER NOT NULL DEFAULT 20,
    "labelTimingPerMarket" TEXT NOT NULL DEFAULT '{}',
    "defaultReturnMethodPerMarket" TEXT NOT NULL DEFAULT '{}',
    "warehouseAddressesPerMarket" TEXT NOT NULL DEFAULT '{}',
    "shopifyLocationIdPerMarket" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("autoRefundOnInspection", "claimMinCommentLength", "claimMinPhotos", "claimRequiresPhoto", "complaintDeadlineDays", "complaintRequireItemReturn", "complaintResolutionMode", "createdAt", "defaultReturnMethodPerMarket", "deflectionEnabled", "exchangeDeadlineDays", "id", "labelTimingPerMarket", "refundShippingCost", "returnDeadlineDays", "shop", "shopifyLocationIdPerMarket", "storeCreditBonusPercent", "storeCreditEnabled", "storeCreditIssueTiming", "storeCreditMethod", "updatedAt", "warehouseAddressesPerMarket") SELECT "autoRefundOnInspection", "claimMinCommentLength", "claimMinPhotos", "claimRequiresPhoto", "complaintDeadlineDays", "complaintRequireItemReturn", "complaintResolutionMode", "createdAt", "defaultReturnMethodPerMarket", "deflectionEnabled", "exchangeDeadlineDays", "id", "labelTimingPerMarket", "refundShippingCost", "returnDeadlineDays", "shop", "shopifyLocationIdPerMarket", "storeCreditBonusPercent", "storeCreditEnabled", "storeCreditIssueTiming", "storeCreditMethod", "updatedAt", "warehouseAddressesPerMarket" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE UNIQUE INDEX "Settings_shop_key" ON "Settings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
