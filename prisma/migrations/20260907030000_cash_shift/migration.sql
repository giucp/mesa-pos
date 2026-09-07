-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "shiftId" TEXT;

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "drawerKey" TEXT NOT NULL DEFAULT 'CAJA-1',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT NOT NULL,
    "openedByName" TEXT NOT NULL,
    "openingUsd" INTEGER NOT NULL,
    "openingVes" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedByName" TEXT,
    "countedUsd" INTEGER,
    "countedVes" INTEGER,
    "expectedUsd" INTEGER,
    "expectedVes" INTEGER,
    "differenceUsd" INTEGER,
    "differenceVes" INTEGER,
    "closeReason" TEXT,
    "summaryJson" TEXT,
    "transferredJson" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'MESA_INTERNO',
    "notes" TEXT,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "concept" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashShift_drawerKey_status_idx" ON "CashShift"("drawerKey", "status");

-- CreateIndex
CREATE INDEX "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
