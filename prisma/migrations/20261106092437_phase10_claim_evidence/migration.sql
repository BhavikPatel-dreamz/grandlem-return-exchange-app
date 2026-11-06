-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "returnDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "exchangeDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "complaintDeadlineDays" INTEGER NOT NULL DEFAULT 14,
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
INSERT INTO "new_Settings" ("complaintDeadlineDays", "createdAt", "defaultReturnMethodPerMarket", "exchangeDeadlineDays", "id", "labelTimingPerMarket", "returnDeadlineDays", "shop", "shopifyLocationIdPerMarket", "updatedAt", "warehouseAddressesPerMarket") SELECT "complaintDeadlineDays", "createdAt", "defaultReturnMethodPerMarket", "exchangeDeadlineDays", "id", "labelTimingPerMarket", "returnDeadlineDays", "shop", "shopifyLocationIdPerMarket", "updatedAt", "warehouseAddressesPerMarket" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE UNIQUE INDEX "Settings_shop_key" ON "Settings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
