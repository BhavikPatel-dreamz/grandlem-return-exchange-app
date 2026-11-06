-- CreateTable
CREATE TABLE "WithdrawalNotice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderNumber" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "content" TEXT NOT NULL,
    "withdrawnAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnRequestId" TEXT,
    CONSTRAINT "WithdrawalNotice_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "requestedResolution" TEXT,
    "isWithdrawal" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgementContent" TEXT,
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
INSERT INTO "new_ReturnRequest" ("approvedAt", "carrierId", "countryCode", "createdAt", "customerEmail", "customerName", "deflectionAccepted", "deflectionOffered", "id", "market", "orderNumber", "outcome", "rejectedAt", "rejectionReason", "requestedResolution", "reviewFlagged", "shop", "shopifyOrderId", "status", "storeCreditAmount", "storeCreditIssuedAt", "submittedAt", "type", "updatedAt") SELECT "approvedAt", "carrierId", "countryCode", "createdAt", "customerEmail", "customerName", "deflectionAccepted", "deflectionOffered", "id", "market", "orderNumber", "outcome", "rejectedAt", "rejectionReason", "requestedResolution", "reviewFlagged", "shop", "shopifyOrderId", "status", "storeCreditAmount", "storeCreditIssuedAt", "submittedAt", "type", "updatedAt" FROM "ReturnRequest";
DROP TABLE "ReturnRequest";
ALTER TABLE "new_ReturnRequest" RENAME TO "ReturnRequest";
CREATE INDEX "ReturnRequest_shop_idx" ON "ReturnRequest"("shop");
CREATE INDEX "ReturnRequest_shop_status_idx" ON "ReturnRequest"("shop", "status");
CREATE INDEX "ReturnRequest_shop_shopifyOrderId_idx" ON "ReturnRequest"("shop", "shopifyOrderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalNotice_returnRequestId_key" ON "WithdrawalNotice"("returnRequestId");
