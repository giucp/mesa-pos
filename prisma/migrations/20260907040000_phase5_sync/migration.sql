-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN "clientOpId" TEXT;

-- AlterTable
ALTER TABLE "CashShift" ADD COLUMN "openLock" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OrderLine_clientOpId_key" ON "OrderLine"("clientOpId");

-- CreateIndex
CREATE UNIQUE INDEX "CashShift_openLock_key" ON "CashShift"("openLock");

-- Backfill: at most one OPEN shift per drawer.
UPDATE "CashShift" SET "openLock" = "drawerKey" WHERE status = 'OPEN' AND "openLock" IS NULL;
