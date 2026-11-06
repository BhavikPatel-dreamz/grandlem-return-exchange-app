-- CreateEnum
CREATE TYPE "ReturnOutcome" AS ENUM ('REFUND', 'EXCHANGE_VARIANT', 'STORE_CREDIT');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnReason" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelSv" TEXT NOT NULL DEFAULT '',
    "appliesTo" TEXT NOT NULL DEFAULT 'return,exchange,complaint',
    "autoRestock" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
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
    "clawBackFreeItems" BOOLEAN NOT NULL DEFAULT true,
    "claimRequiresPhoto" BOOLEAN NOT NULL DEFAULT true,
    "claimMinPhotos" INTEGER NOT NULL DEFAULT 1,
    "claimMinCommentLength" INTEGER NOT NULL DEFAULT 20,
    "labelTimingPerMarket" TEXT NOT NULL DEFAULT '{}',
    "defaultReturnMethodPerMarket" TEXT NOT NULL DEFAULT '{}',
    "warehouseAddressesPerMarket" TEXT NOT NULL DEFAULT '{}',
    "shopifyLocationIdPerMarket" TEXT NOT NULL DEFAULT '{}',
    "shippyproApiKeyEncrypted" TEXT,
    "shippyproApiKeyHint" TEXT,
    "shippyproApiUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadlineExtension" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "newDeadline" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadlineExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExclusionRule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "appliesToReturns" BOOLEAN NOT NULL DEFAULT true,
    "appliesToExchanges" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExclusionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Carrier" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shippyproCarrierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "service" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "market" TEXT,
    "meta" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "orderNumber" TEXT,
    "requestNumber" TEXT,
    "market" TEXT,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Submitted',
    "carrierId" TEXT,
    "reviewFlagged" BOOLEAN NOT NULL DEFAULT false,
    "countryCode" TEXT NOT NULL DEFAULT '',
    "outcome" "ReturnOutcome",
    "requestedResolution" TEXT,
    "isWithdrawal" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgementContent" TEXT,
    "finalResolution" TEXT,
    "replacementOrderId" TEXT,
    "itemReturnRequired" BOOLEAN NOT NULL DEFAULT true,
    "draftOrderId" TEXT,
    "reservedUntil" TIMESTAMP(3),
    "deflectionOffered" BOOLEAN NOT NULL DEFAULT false,
    "deflectionAccepted" BOOLEAN NOT NULL DEFAULT false,
    "storeCreditAmount" DOUBLE PRECISION,
    "storeCreditIssuedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" TEXT NOT NULL,
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
    "restockedAt" TIMESTAMP(3),
    "restockLocationId" TEXT,
    "itemResolution" TEXT,
    "replacementVariantId" TEXT,
    "priceDifferenceStr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnPhoto" (
    "id" TEXT NOT NULL,
    "returnItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionResult" (
    "id" TEXT NOT NULL,
    "returnItemId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "approvedQuantity" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnLabel" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "carrierId" TEXT,
    "connectionId" TEXT,
    "service" TEXT,
    "labelUrl" TEXT,
    "qrCodeUrl" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "customsData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRecord" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "shopifyRefundId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalNotice" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderNumber" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "content" TEXT NOT NULL,
    "withdrawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnRequestId" TEXT,

    CONSTRAINT "WithdrawalNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierService" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shippyproCarrierId" TEXT NOT NULL,
    "service" TEXT,
    "supportsReturns" BOOLEAN NOT NULL DEFAULT true,
    "supportsPickup" BOOLEAN NOT NULL DEFAULT false,
    "supportsQr" BOOLEAN NOT NULL DEFAULT false,
    "supportsDropoff" BOOLEAN NOT NULL DEFAULT true,
    "meta" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnPickup" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "carrierId" TEXT,
    "service" TEXT,
    "preferredDate" TIMESTAMP(3),
    "timeWindow" TEXT,
    "address" TEXT,
    "shippyproPickupId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnPickup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "returnLabelId" TEXT,
    "returnRequestId" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyOrderStat" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "marketCode" TEXT NOT NULL DEFAULT '',
    "fulfilledOrders" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyOrderStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

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
CREATE UNIQUE INDEX "InspectionResult_returnItemId_key" ON "InspectionResult"("returnItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnLabel_returnRequestId_key" ON "ReturnLabel"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnLabel_returnRequestId_idx" ON "ReturnLabel"("returnRequestId");

-- CreateIndex
CREATE INDEX "RefundRecord_returnRequestId_idx" ON "RefundRecord"("returnRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalNotice_returnRequestId_key" ON "WithdrawalNotice"("returnRequestId");

-- CreateIndex
CREATE INDEX "CourierService_shop_idx" ON "CourierService"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "CourierService_shop_shippyproCarrierId_service_key" ON "CourierService"("shop", "shippyproCarrierId", "service");

-- CreateIndex
CREATE INDEX "ReturnPickup_returnRequestId_idx" ON "ReturnPickup"("returnRequestId");

-- CreateIndex
CREATE INDEX "TrackingEvent_returnLabelId_idx" ON "TrackingEvent"("returnLabelId");

-- CreateIndex
CREATE INDEX "TrackingEvent_returnRequestId_idx" ON "TrackingEvent"("returnRequestId");

-- CreateIndex
CREATE INDEX "DailyOrderStat_shop_date_idx" ON "DailyOrderStat"("shop", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyOrderStat_shop_date_marketCode_key" ON "DailyOrderStat"("shop", "date", "marketCode");

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "ReturnReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPhoto" ADD CONSTRAINT "ReturnPhoto_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "ReturnItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionResult" ADD CONSTRAINT "InspectionResult_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "ReturnItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLabel" ADD CONSTRAINT "ReturnLabel_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRecord" ADD CONSTRAINT "RefundRecord_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalNotice" ADD CONSTRAINT "WithdrawalNotice_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_returnLabelId_fkey" FOREIGN KEY ("returnLabelId") REFERENCES "ReturnLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
