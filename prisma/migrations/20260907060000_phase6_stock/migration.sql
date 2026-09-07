-- Finished-goods inventory (optional per product). Additive; uncontrolled items stay as today.
ALTER TABLE "Item" ADD COLUMN "stockControlled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Item" ADD COLUMN "stockQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Item" ADD COLUMN "stockUnit" TEXT NOT NULL DEFAULT 'un';
ALTER TABLE "Item" ADD COLUMN "stockMinAlert" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OrderLine" ADD COLUMN "stockReserved" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderLine" ADD COLUMN "stockCommitted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'un',
    "motivo" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "checkId" TEXT,
    "lineId" TEXT,
    "clientOpId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockMovement_clientOpId_key" ON "StockMovement"("clientOpId");
CREATE INDEX "StockMovement_itemId_createdAt_idx" ON "StockMovement"("itemId", "createdAt");

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
