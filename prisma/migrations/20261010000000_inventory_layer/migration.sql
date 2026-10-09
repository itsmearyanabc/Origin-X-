-- AlterTable
ALTER TABLE "ProductBatch" ADD COLUMN     "holdStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "passportProductId" TEXT,
ADD COLUMN     "plannedQuantity" DECIMAL(18,4),
ADD COLUMN     "qualityStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "skuId" TEXT,
ADD COLUMN     "unitOfMeasure" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "passportType" TEXT NOT NULL DEFAULT 'UNIT',
ADD COLUMN     "skuId" TEXT;

-- AlterTable
ALTER TABLE "CustodyTransfer" ADD COLUMN     "shipmentId" TEXT;

-- CreateTable
CREATE TABLE "ProductSku" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "manufacturerOrganizationId" TEXT,
    "unitOfMeasure" TEXT NOT NULL DEFAULT 'PCS',
    "allowsFractional" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT,
    "aisle" TEXT,
    "shelf" TEXT,
    "bin" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "batchId" TEXT,
    "batchKey" TEXT NOT NULL DEFAULT '',
    "unitOfMeasure" TEXT NOT NULL,
    "onHand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quarantined" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damaged" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "skuId" TEXT NOT NULL,
    "batchId" TEXT,
    "unitOfMeasure" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "fromWarehouseId" TEXT,
    "fromLocationId" TEXT,
    "toWarehouseId" TEXT,
    "toLocationId" TEXT,
    "shipmentId" TEXT,
    "shipmentItemId" TEXT,
    "reservationId" TEXT,
    "incidentId" TEXT,
    "recallId" TEXT,
    "productEventId" TEXT,
    "correlationId" TEXT,
    "reason" TEXT,
    "actorUserId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "delta" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "batchId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "shipmentId" TEXT,
    "shipmentItemId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "senderOrganizationId" TEXT NOT NULL,
    "receiverOrganizationId" TEXT NOT NULL,
    "originWarehouseId" TEXT NOT NULL,
    "destinationWarehouseId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'STANDARD',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "transferCustody" BOOLEAN NOT NULL DEFAULT false,
    "hasDiscrepancy" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "recallId" TEXT,
    "createdById" TEXT,
    "dispatchedById" TEXT,
    "receivedById" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "batchId" TEXT,
    "fromLocationId" TEXT NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "requestedQty" DECIMAL(18,4) NOT NULL,
    "dispatchedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damagedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "missingQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorderRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "threshold" DECIMAL(18,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReorderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryDiscrepancy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "message" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "skuId" TEXT,
    "batchId" TEXT,
    "balanceId" TEXT,
    "shipmentId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSku_organizationId_idx" ON "ProductSku"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSku_organizationId_sku_key" ON "ProductSku"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "Warehouse_organizationId_idx" ON "Warehouse"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_organizationId_code_key" ON "Warehouse"("organizationId", "code");

-- CreateIndex
CREATE INDEX "StorageLocation_organizationId_idx" ON "StorageLocation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StorageLocation_warehouseId_code_key" ON "StorageLocation"("warehouseId", "code");

-- CreateIndex
CREATE INDEX "InventoryBalance_organizationId_skuId_idx" ON "InventoryBalance"("organizationId", "skuId");

-- CreateIndex
CREATE INDEX "InventoryBalance_batchId_idx" ON "InventoryBalance"("batchId");

-- CreateIndex
CREATE INDEX "InventoryBalance_warehouseId_idx" ON "InventoryBalance"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_organizationId_locationId_skuId_batchKey_key" ON "InventoryBalance"("organizationId", "locationId", "skuId", "batchKey");

-- CreateIndex
CREATE INDEX "InventoryTransaction_organizationId_createdAt_idx" ON "InventoryTransaction"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_skuId_idx" ON "InventoryTransaction"("skuId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_batchId_idx" ON "InventoryTransaction"("batchId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_shipmentId_idx" ON "InventoryTransaction"("shipmentId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_type_idx" ON "InventoryTransaction"("type");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_organizationId_idempotencyKey_key" ON "InventoryTransaction"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryLedgerEntry_balanceId_bucket_idx" ON "InventoryLedgerEntry"("balanceId", "bucket");

-- CreateIndex
CREATE INDEX "InventoryLedgerEntry_organizationId_idx" ON "InventoryLedgerEntry"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservation_shipmentItemId_key" ON "InventoryReservation"("shipmentItemId");

-- CreateIndex
CREATE INDEX "InventoryReservation_organizationId_status_idx" ON "InventoryReservation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservation_shipmentId_idx" ON "InventoryReservation"("shipmentId");

-- CreateIndex
CREATE INDEX "InventoryReservation_batchId_idx" ON "InventoryReservation"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_reference_key" ON "Shipment"("reference");

-- CreateIndex
CREATE INDEX "Shipment_senderOrganizationId_status_idx" ON "Shipment"("senderOrganizationId", "status");

-- CreateIndex
CREATE INDEX "Shipment_receiverOrganizationId_status_idx" ON "Shipment"("receiverOrganizationId", "status");

-- CreateIndex
CREATE INDEX "ShipmentItem_shipmentId_idx" ON "ShipmentItem"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReorderRule_organizationId_skuId_key" ON "ReorderRule"("organizationId", "skuId");

-- CreateIndex
CREATE INDEX "InventoryDiscrepancy_organizationId_status_idx" ON "InventoryDiscrepancy"("organizationId", "status");

-- CreateIndex
CREATE INDEX "InventoryDiscrepancy_fingerprint_idx" ON "InventoryDiscrepancy"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_key_key" ON "IdempotencyRecord"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBatch_passportProductId_key" ON "ProductBatch"("passportProductId");

-- CreateIndex
CREATE INDEX "Product_skuId_idx" ON "Product"("skuId");

-- CreateIndex
CREATE INDEX "CustodyTransfer_shipmentId_idx" ON "CustodyTransfer"("shipmentId");

-- AddForeignKey
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_passportProductId_fkey" FOREIGN KEY ("passportProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyTransfer" ADD CONSTRAINT "CustodyTransfer_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StorageLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "InventoryTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderRule" ADD CONSTRAINT "ReorderRule_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Inventory integrity guards
-- The ledger is the source of truth: transactions and entries are append-only.
-- Corrections are compensating transactions, never edits.
-- ---------------------------------------------------------------------------
CREATE TRIGGER "InventoryTransaction_append_only" BEFORE UPDATE OR DELETE ON "InventoryTransaction"
    FOR EACH ROW EXECUTE FUNCTION originx_append_only();
CREATE TRIGGER "InventoryTransaction_no_truncate" BEFORE TRUNCATE ON "InventoryTransaction"
    FOR EACH STATEMENT EXECUTE FUNCTION originx_append_only();
CREATE TRIGGER "InventoryLedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "InventoryLedgerEntry"
    FOR EACH ROW EXECUTE FUNCTION originx_append_only();
CREATE TRIGGER "InventoryLedgerEntry_no_truncate" BEFORE TRUNCATE ON "InventoryLedgerEntry"
    FOR EACH STATEMENT EXECUTE FUNCTION originx_append_only();

-- Balances and reservations are mutable caches/state but must never be deleted.
CREATE OR REPLACE FUNCTION originx_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ORIGINX_IMMUTABLE: % rows cannot be deleted', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "InventoryBalance_no_delete" BEFORE DELETE ON "InventoryBalance" FOR EACH ROW EXECUTE FUNCTION originx_no_delete();
CREATE TRIGGER "InventoryReservation_no_delete" BEFORE DELETE ON "InventoryReservation" FOR EACH ROW EXECUTE FUNCTION originx_no_delete();

-- No bucket may ever go negative, whatever code path writes the balance.
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_non_negative"
    CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "quarantined" >= 0 AND "damaged" >= 0 AND "reserved" <= "onHand");
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_quantities_valid"
    CHECK ("requestedQty" > 0 AND "dispatchedQty" >= 0 AND "receivedQty" >= 0 AND "damagedQty" >= 0 AND "missingQty" >= 0
           AND "receivedQty" + "damagedQty" + "missingQty" <= "dispatchedQty");

-- Supabase hardening for the new tables (same policy as integrity_guards).
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['ProductSku','Warehouse','StorageLocation','InventoryBalance','InventoryTransaction','InventoryLedgerEntry',
                             'InventoryReservation','Shipment','ShipmentItem','ReorderRule','InventoryDiscrepancy','IdempotencyRecord'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
        END IF;
    END LOOP;
END;
$$;
