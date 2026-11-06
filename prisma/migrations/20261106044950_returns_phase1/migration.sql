-- CreateTable
CREATE TABLE "ReturnReason" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelSv" TEXT NOT NULL DEFAULT '',
    "appliesTo" TEXT NOT NULL DEFAULT 'return,exchange,complaint',
    "autoRestock" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "returnDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "exchangeDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "complaintDeadlineDays" INTEGER NOT NULL DEFAULT 14,
    "labelTimingPerMarket" TEXT NOT NULL DEFAULT '{}',
    "defaultReturnMethodPerMarket" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DeadlineExtension" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "newDeadline" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ExclusionRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "appliesToReturns" BOOLEAN NOT NULL DEFAULT true,
    "appliesToExchanges" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Carrier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shippyproCarrierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "service" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "market" TEXT,
    "meta" TEXT,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
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
    "rejectionReason" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "rejectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnRequestId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "title" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reasonId" TEXT,
    "comment" TEXT,
    "restockDecision" TEXT,
    "restocked" BOOLEAN NOT NULL DEFAULT false,
    "restockedAt" DATETIME,
    "restockLocationId" TEXT,
    "replacementVariantId" TEXT,
    "priceDifferenceStr" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReturnItem_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReturnItem_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "ReturnReason" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReturnPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReturnPhoto_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "ReturnItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReturnLabel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnRequestId" TEXT NOT NULL,
    "carrierId" TEXT,
    "connectionId" TEXT,
    "service" TEXT,
    "labelUrl" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "customsData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReturnLabel_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnLabelId" TEXT,
    "returnRequestId" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackingEvent_returnLabelId_fkey" FOREIGN KEY ("returnLabelId") REFERENCES "ReturnLabel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReturnReason_shop_idx" ON "ReturnReason"("shop");

-- CreateIndex
CREATE INDEX "ReturnReason_shop_active_idx" ON "ReturnReason"("shop", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_shop_key" ON "Settings"("shop");

-- CreateIndex
CREATE INDEX "DeadlineExtension_shop_shopifyOrderId_idx" ON "DeadlineExtension"("shop", "shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "DeadlineExtension_shop_shopifyOrderId_type_key" ON "DeadlineExtension"("shop", "shopifyOrderId", "type");

-- CreateIndex
CREATE INDEX "ExclusionRule_shop_idx" ON "ExclusionRule"("shop");

-- CreateIndex
CREATE INDEX "ExclusionRule_shop_targetType_targetId_idx" ON "ExclusionRule"("shop", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ExclusionRule_shop_targetType_targetId_key" ON "ExclusionRule"("shop", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "Carrier_shop_idx" ON "Carrier"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Carrier_shop_shippyproCarrierId_key" ON "Carrier"("shop", "shippyproCarrierId");

-- CreateIndex
CREATE INDEX "EmailTemplate_shop_idx" ON "EmailTemplate"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_shop_event_language_key" ON "EmailTemplate"("shop", "event", "language");

-- CreateIndex
CREATE INDEX "ReturnRequest_shop_idx" ON "ReturnRequest"("shop");

-- CreateIndex
CREATE INDEX "ReturnRequest_shop_status_idx" ON "ReturnRequest"("shop", "status");

-- CreateIndex
CREATE INDEX "ReturnRequest_shop_shopifyOrderId_idx" ON "ReturnRequest"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "ReturnItem_returnRequestId_idx" ON "ReturnItem"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnPhoto_returnItemId_idx" ON "ReturnPhoto"("returnItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnLabel_returnRequestId_key" ON "ReturnLabel"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnLabel_returnRequestId_idx" ON "ReturnLabel"("returnRequestId");

-- CreateIndex
CREATE INDEX "TrackingEvent_returnLabelId_idx" ON "TrackingEvent"("returnLabelId");

-- CreateIndex
CREATE INDEX "TrackingEvent_returnRequestId_idx" ON "TrackingEvent"("returnRequestId");

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");
