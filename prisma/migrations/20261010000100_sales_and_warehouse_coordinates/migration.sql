ALTER TABLE "Warehouse"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION;

CREATE TABLE "Sale" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleItem" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "skuId" TEXT NOT NULL,
  "batchId" TEXT,
  "warehouseId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "inventoryTransactionId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "unitOfMeasure" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "unitPrice" DECIMAL(18,2) NOT NULL,
  "lineTotal" DECIMAL(20,2) NOT NULL,
  CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Sale_organizationId_reference_key" ON "Sale"("organizationId", "reference");
CREATE INDEX "Sale_organizationId_soldAt_idx" ON "Sale"("organizationId", "soldAt");
CREATE UNIQUE INDEX "SaleItem_inventoryTransactionId_key" ON "SaleItem"("inventoryTransactionId");
CREATE INDEX "SaleItem_skuId_idx" ON "SaleItem"("skuId");
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_inventoryTransactionId_fkey" FOREIGN KEY ("inventoryTransactionId") REFERENCES "InventoryTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
