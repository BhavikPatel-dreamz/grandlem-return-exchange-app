-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReturnRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "orderNumber" TEXT,
    "market" TEXT,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Submitted',
    "carrierId" TEXT,
    "reviewFlagged" BOOLEAN NOT NULL DEFAULT false,
    "countryCode" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT,
    "requestedResolution" TEXT,
    "isWithdrawal" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgementContent" TEXT,
    "finalResolution" TEXT,
    "replacementOrderId" TEXT,
    "itemReturnRequired" BOOLEAN NOT NULL DEFAULT true,
    "deflectionOffered" BOOLEAN NOT NULL DEFAULT false,
    "deflectionAccepted" BOOLEAN NOT NULL DEFAULT false,
    "storeCreditAmount" REAL,
    "storeCreditIssuedAt" DATETIME,
    "rejectionReason" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "rejectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ReturnRequest" ("acknowledgementContent", "approvedAt", "carrierId", "countryCode", "createdAt", "customerEmail", "customerName", "deflectionAccepted", "deflectionOffered", "id", "isWithdrawal", "market", "orderNumber", "outcome", "rejectedAt", "rejectionReason", "requestedResolution", "reviewFlagged", "shop", "shopifyOrderId", "status", "storeCreditAmount", "storeCreditIssuedAt", "submittedAt", "type", "updatedAt") SELECT "acknowledgementContent", "approvedAt", "carrierId", "countryCode", "createdAt", "customerEmail", "customerName", "deflectionAccepted", "deflectionOffered", "id", "isWithdrawal", "market", "orderNumber", "outcome", "rejectedAt", "rejectionReason", "requestedResolution", "reviewFlagged", "shop", "shopifyOrderId", "status", "storeCreditAmount", "storeCreditIssuedAt", "submittedAt", "type", "updatedAt" FROM "ReturnRequest";
DROP TABLE "ReturnRequest";
ALTER TABLE "new_ReturnRequest" RENAME TO "ReturnRequest";
CREATE INDEX "ReturnRequest_shop_idx" ON "ReturnRequest"("shop");
CREATE INDEX "ReturnRequest_shop_status_idx" ON "ReturnRequest"("shop", "status");
CREATE INDEX "ReturnRequest_shop_shopifyOrderId_idx" ON "ReturnRequest"("shop", "shopifyOrderId");
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
INSERT INTO "new_Settings" ("autoRefundOnInspection", "claimMinCommentLength", "claimMinPhotos", "claimRequiresPhoto", "complaintDeadlineDays", "createdAt", "defaultReturnMethodPerMarket", "deflectionEnabled", "exchangeDeadlineDays", "id", "labelTimingPerMarket", "refundShippingCost", "returnDeadlineDays", "shop", "shopifyLocationIdPerMarket", "storeCreditBonusPercent", "storeCreditEnabled", "storeCreditIssueTiming", "storeCreditMethod", "updatedAt", "warehouseAddressesPerMarket") SELECT "autoRefundOnInspection", "claimMinCommentLength", "claimMinPhotos", "claimRequiresPhoto", "complaintDeadlineDays", "createdAt", "defaultReturnMethodPerMarket", "deflectionEnabled", "exchangeDeadlineDays", "id", "labelTimingPerMarket", "refundShippingCost", "returnDeadlineDays", "shop", "shopifyLocationIdPerMarket", "storeCreditBonusPercent", "storeCreditEnabled", "storeCreditIssueTiming", "storeCreditMethod", "updatedAt", "warehouseAddressesPerMarket" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE UNIQUE INDEX "Settings_shop_key" ON "Settings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
