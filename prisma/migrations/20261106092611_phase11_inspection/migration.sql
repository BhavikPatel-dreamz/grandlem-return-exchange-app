-- CreateTable
CREATE TABLE "InspectionResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnItemId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "approvedQuantity" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InspectionResult_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "ReturnItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InspectionResult_returnItemId_key" ON "InspectionResult"("returnItemId");
