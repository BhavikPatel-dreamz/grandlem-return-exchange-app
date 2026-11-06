-- CreateTable
CREATE TABLE "DailyOrderStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "marketCode" TEXT NOT NULL DEFAULT '',
    "fulfilledOrders" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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
    "rejectionReason" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "rejectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ReturnRequest" ("approvedAt", "carrierId", "createdAt", "customerEmail", "customerName", "id", "market", "orderNumber", "rejectedAt", "rejectionReason", "reviewFlagged", "shop", "shopifyOrderId", "status", "submittedAt", "type", "updatedAt") SELECT "approvedAt", "carrierId", "createdAt", "customerEmail", "customerName", "id", "market", "orderNumber", "rejectedAt", "rejectionReason", "reviewFlagged", "shop", "shopifyOrderId", "status", "submittedAt", "type", "updatedAt" FROM "ReturnRequest";
DROP TABLE "ReturnRequest";
ALTER TABLE "new_ReturnRequest" RENAME TO "ReturnRequest";
CREATE INDEX "ReturnRequest_shop_idx" ON "ReturnRequest"("shop");
CREATE INDEX "ReturnRequest_shop_status_idx" ON "ReturnRequest"("shop", "status");
CREATE INDEX "ReturnRequest_shop_shopifyOrderId_idx" ON "ReturnRequest"("shop", "shopifyOrderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DailyOrderStat_shop_date_idx" ON "DailyOrderStat"("shop", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyOrderStat_shop_date_marketCode_key" ON "DailyOrderStat"("shop", "date", "marketCode");
