-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Restaurant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rif" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "ivaRate" DOUBLE PRECISION NOT NULL DEFAULT 16,
    "igtfBancarizadoRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igtfForexRate" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "tipInTaxableBase" BOOLEAN NOT NULL DEFAULT false,
    "bcvRate" DOUBLE PRECISION NOT NULL,
    "bcvUpdatedAt" TIMESTAMP(3) NOT NULL,
    "bcvSource" TEXT NOT NULL DEFAULT 'seed',
    "folioSeq" INTEGER NOT NULL DEFAULT 1,
    "controlSeq" INTEGER NOT NULL DEFAULT 1,
    "invoiceSeq" INTEGER NOT NULL DEFAULT 1,
    "fiscalAdapterMf" TEXT NOT NULL DEFAULT 'DESCONECTADO',
    "fiscalAdapterDigital" TEXT NOT NULL DEFAULT 'DESCONECTADO',

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hint" TEXT,
    "igtfProfile" TEXT NOT NULL DEFAULT 'BANCARIZADO',

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceUsd" INTEGER NOT NULL,
    "categoryId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "channels" TEXT NOT NULL DEFAULT 'LOCAL,DELIVERY,ONLINE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "taxCode" TEXT NOT NULL DEFAULT 'IVA16',
    "ivaRate" DOUBLE PRECISION NOT NULL DEFAULT 16,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modifier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceUsd" INTEGER NOT NULL DEFAULT 0,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "Modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiningTable" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "zone" TEXT NOT NULL,
    "posX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'FREE',

    CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Check" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "tableId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "channel" TEXT NOT NULL DEFAULT 'LOCAL',
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "waiterId" TEXT,
    "notes" TEXT,
    "tipUsd" INTEGER NOT NULL DEFAULT 0,
    "payerProfile" TEXT NOT NULL DEFAULT 'AUTO',
    "igtfCustomRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bcvRateUsed" DOUBLE PRECISION,
    "bcvSource" TEXT,
    "bcvFetchedAt" TIMESTAMP(3),
    "buyerName" TEXT,
    "buyerRif" TEXT,
    "buyerCi" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "Check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "itemId" TEXT,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "priceUsd" INTEGER NOT NULL,
    "notes" TEXT,
    "modifiers" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "stationId" TEXT NOT NULL,
    "course" INTEGER NOT NULL DEFAULT 1,
    "sentAt" TIMESTAMP(3),
    "bumpedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taxCode" TEXT NOT NULL DEFAULT 'IVA16',
    "ivaRate" DOUBLE PRECISION NOT NULL DEFAULT 16,
    "discountUsd" INTEGER NOT NULL DEFAULT 0,
    "courtesy" BOOLEAN NOT NULL DEFAULT false,
    "courtesyReason" TEXT,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "methodKey" TEXT NOT NULL,
    "methodLabel" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "amountUsd" INTEGER NOT NULL,
    "reference" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bcvRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bcvSource" TEXT NOT NULL DEFAULT 'other',
    "bcvFetchedAt" TIMESTAMP(3),
    "amountVes" INTEGER NOT NULL DEFAULT 0,
    "igtfRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igtfUsd" INTEGER NOT NULL DEFAULT 0,
    "igtfVes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalDraft" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL DEFAULT 'BORRADOR_FISCAL',
    "ticketType" TEXT NOT NULL DEFAULT 'TICKET_INTERNO',
    "emitterRif" TEXT NOT NULL DEFAULT '',
    "controlNumber" TEXT NOT NULL DEFAULT '',
    "invoiceNumber" TEXT NOT NULL DEFAULT '',
    "customerName" TEXT,
    "customerRif" TEXT,
    "customerCi" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'LOCAL',
    "ivaRate" DOUBLE PRECISION NOT NULL,
    "ivaBreakdown" TEXT NOT NULL DEFAULT '[]',
    "subtotalUsd" INTEGER NOT NULL,
    "ivaUsd" INTEGER NOT NULL,
    "tipUsd" INTEGER NOT NULL,
    "igtfUsd" INTEGER NOT NULL DEFAULT 0,
    "igtfRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalUsd" INTEGER NOT NULL,
    "subtotalVes" INTEGER NOT NULL DEFAULT 0,
    "ivaVes" INTEGER NOT NULL DEFAULT 0,
    "tipVes" INTEGER NOT NULL DEFAULT 0,
    "igtfVes" INTEGER NOT NULL DEFAULT 0,
    "totalVes" INTEGER NOT NULL DEFAULT 0,
    "usdRef" TEXT,
    "bcvRate" DOUBLE PRECISION NOT NULL,
    "bcvSource" TEXT NOT NULL DEFAULT 'seed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "homologation" TEXT NOT NULL DEFAULT 'EMITIDO',
    "adapterMf" TEXT NOT NULL DEFAULT 'DESCONECTADO',
    "adapterDigital" TEXT NOT NULL DEFAULT 'DESCONECTADO',
    "withholdingNote" TEXT NOT NULL DEFAULT 'RETENCION_IVA_STUB',

    CONSTRAINT "FiscalDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoidLog" (
    "id" TEXT NOT NULL,
    "checkId" TEXT,
    "userId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoidLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLog" (
    "id" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT,
    "checkId" TEXT,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseStub" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierName" TEXT NOT NULL,
    "supplierRif" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "baseVes" INTEGER NOT NULL,
    "ivaVes" INTEGER NOT NULL,
    "totalVes" INTEGER NOT NULL,
    "ivaRate" DOUBLE PRECISION NOT NULL DEFAULT 16,

    CONSTRAINT "PurchaseStub_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_key_key" ON "PaymentMethod"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Station_slug_key" ON "Station"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Check_folio_key" ON "Check"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDraft_checkId_key" ON "FiscalDraft"("checkId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDraft" ADD CONSTRAINT "FiscalDraft_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

