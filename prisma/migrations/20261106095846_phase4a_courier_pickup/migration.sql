-- CreateTable
CREATE TABLE "CourierService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shippyproCarrierId" TEXT NOT NULL,
    "service" TEXT,
    "supportsReturns" BOOLEAN NOT NULL DEFAULT true,
    "supportsPickup" BOOLEAN NOT NULL DEFAULT false,
    "supportsQr" BOOLEAN NOT NULL DEFAULT false,
    "supportsDropoff" BOOLEAN NOT NULL DEFAULT true,
    "meta" TEXT,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReturnPickup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnRequestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "carrierId" TEXT,
    "service" TEXT,
    "preferredDate" DATETIME,
    "timeWindow" TEXT,
    "address" TEXT,
    "shippyproPickupId" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "CourierService_shop_idx" ON "CourierService"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "CourierService_shop_shippyproCarrierId_service_key" ON "CourierService"("shop", "shippyproCarrierId", "service");

-- CreateIndex
CREATE INDEX "ReturnPickup_returnRequestId_idx" ON "ReturnPickup"("returnRequestId");
