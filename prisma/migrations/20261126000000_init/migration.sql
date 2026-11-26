-- Initial PostgreSQL migration converted from the supplied SQLite DDL and checked against the Prisma scalar fields.

CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "roleKey" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recoveryCodes" TEXT,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastTotpStep" BIGINT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissionsJson" TEXT NOT NULL DEFAULT '[]',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "UserLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "refNo" TEXT,
    "prevJson" TEXT,
    "newJson" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "userName" TEXT,
    "planId" TEXT,
    "batchId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "refNo" TEXT,
    "amount" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "valueJson" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "NumberSequence" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "division" TEXT,
    "district" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "type" TEXT NOT NULL DEFAULT 'BUSINESS',
    "partnerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MAIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "BusinessPartner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerName" TEXT,
    "contactPerson" TEXT,
    "type" TEXT NOT NULL,
    "servicesJson" TEXT NOT NULL DEFAULT '[]',
    "phone" TEXT,
    "altPhone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "website" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "division" TEXT,
    "district" TEXT,
    "area" TEXT,
    "marketName" TEXT,
    "shopNo" TEXT,
    "address" TEXT,
    "mapsUrl" TEXT,
    "taxId" TEXT,
    "paymentTerms" TEXT,
    "openingBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "bankInfo" TEXT,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "season" TEXT,
    "launchDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "ProductPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "collectionId" TEXT,
    "season" TEXT,
    "targetMarket" TEXT,
    "targetCustomer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "unit" TEXT NOT NULL DEFAULT 'Piece',
    "plannedQty" INTEGER NOT NULL DEFAULT 0,
    "planningDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedStartDate" TIMESTAMP(3),
    "targetCompletionDate" TIMESTAMP(3),
    "estimatedBudget" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "targetMfgCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "targetLandedCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "targetWholesalePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "targetRetailPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assignedTo" TEXT,
    "instructions" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "PlanVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "reason" TEXT,
    "revisedById" TEXT,
    "revisedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PlanColor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL DEFAULT '#334155',
    "fabricShade" TEXT,
    "dyeLot" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "PlanSize" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "measurementsJson" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "MatrixCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "colorId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "colorId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "sizeName" TEXT NOT NULL,
    "barcode" TEXT,
    "qrPayload" TEXT,
    "plannedQty" INTEGER NOT NULL DEFAULT 0,
    "producedQty" INTEGER NOT NULL DEFAULT 0,
    "soldQty" INTEGER NOT NULL DEFAULT 0,
    "estMaterialCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "estServiceCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "targetPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MeasurementChart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT,
    "name" TEXT NOT NULL,
    "categoryKey" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'inch',
    "version" INTEGER NOT NULL DEFAULT 1,
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Design" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designer" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sketchUrl" TEXT,
    "filesJson" TEXT NOT NULL DEFAULT '[]',
    "instructions" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Sample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "designId" TEXT NOT NULL,
    "planId" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'CONCEPT',
    "materialsCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "factoryCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tailorCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "transportCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "photosJson" TEXT NOT NULL DEFAULT '[]',
    "corrections" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "BOM" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "BOMItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bomId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "component" TEXT NOT NULL DEFAULT 'MAIN',
    "qtyPerPiece" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "wastagePct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "estUnitCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "substituteNote" TEXT,
    "sizeOverridesJson" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'MATERIAL_PREPARATION'
);

CREATE TABLE "MaterialRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "netQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "wastageQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "grossQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "stockQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "incomingQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "shortageQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "suggestedQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "estCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MaterialCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "Material" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "description" TEXT,
    "composition" TEXT,
    "width" TEXT,
    "gsm" TEXT,
    "colorName" TEXT,
    "shade" TEXT,
    "dyeLot" TEXT,
    "preferredSupplierId" TEXT,
    "purchaseUnit" TEXT NOT NULL DEFAULT 'Yard',
    "baseUnit" TEXT NOT NULL DEFAULT 'Yard',
    "conversionNote" TEXT,
    "purchasePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "minStock" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "planId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'PO',
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "locationId" TEXT,
    "warehouseId" TEXT,
    "supplierInvoiceNo" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "transportCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "loadingCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unloadingCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "advanceAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "colorName" TEXT,
    "shade" TEXT,
    "qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'Yard',
    "unitPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(65,30) NOT NULL DEFAULT 0
);

CREATE TABLE "MaterialReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "poId" TEXT,
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "transportCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "loadingCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unloadingCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MaterialReceiptItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receiptId" TEXT NOT NULL,
    "poItemId" TEXT,
    "materialId" TEXT NOT NULL,
    "colorName" TEXT,
    "shade" TEXT,
    "qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'Yard',
    "unitCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(65,30) NOT NULL DEFAULT 0
);

CREATE TABLE "PurchaseReturn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "poId" TEXT,
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "returnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "refundStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemsJson" TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE "MaterialStock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(65,30) NOT NULL DEFAULT 0
);

CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "movementDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "materialId" TEXT NOT NULL,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "value" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "refNo" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "InventoryReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "planId" TEXT,
    "batchId" TEXT,
    "workOrderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "userId" TEXT,
    "notes" TEXT
);

CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ProductionStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "plannedQty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "startDate" TIMESTAMP(3),
    "expectedCompletionDate" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "managerName" TEXT,
    "estBudget" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "BatchVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "plannedQty" INTEGER NOT NULL DEFAULT 0,
    "completedQty" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stageKey" TEXT,
    "partnerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dispatchDate" TIMESTAMP(3),
    "expectedDate" TIMESTAMP(3),
    "issuedQty" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'Piece',
    "pricingJson" TEXT NOT NULL DEFAULT '{}',
    "estServiceCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "transportCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "advanceAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "instructions" TEXT,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "acceptedQty" INTEGER NOT NULL DEFAULT 0,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "missingQty" INTEGER NOT NULL DEFAULT 0,
    "actualServiceCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "vendorInvoiceNo" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "WorkOrderMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "issuedQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "consumedQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "returnedQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "wastedQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "remainingQty" DECIMAL(65,30) NOT NULL DEFAULT 0
);

CREATE TABLE "WorkOrderReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "acceptedQty" INTEGER NOT NULL DEFAULT 0,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "missingQty" INTEGER NOT NULL DEFAULT 0,
    "consumedJson" TEXT NOT NULL DEFAULT '{}',
    "returnedJson" TEXT NOT NULL DEFAULT '{}',
    "wastedJson" TEXT NOT NULL DEFAULT '{}',
    "remainingJson" TEXT NOT NULL DEFAULT '{}',
    "serviceCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "additionalCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reworkCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "transportCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "invoiceNo" TEXT,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "receivedById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "QualityInspection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "inspectionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectorName" TEXT,
    "type" TEXT NOT NULL,
    "batchId" TEXT,
    "workOrderId" TEXT,
    "planId" TEXT,
    "inspectedQty" INTEGER NOT NULL DEFAULT 0,
    "passedQty" INTEGER NOT NULL DEFAULT 0,
    "reworkQty" INTEGER NOT NULL DEFAULT 0,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "defectsJson" TEXT NOT NULL DEFAULT '[]',
    "severity" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "correctiveAction" TEXT,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ReworkOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "partnerId" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "FinishedStock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "packedQty" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "qualityStatus" TEXT NOT NULL DEFAULT 'PASSED'
);

CREATE TABLE "FinishedMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "movementDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "variantId" TEXT NOT NULL,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "value" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "refNo" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Package" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "boxNo" TEXT NOT NULL,
    "barcode" TEXT,
    "qrPayload" TEXT,
    "sourceWarehouseId" TEXT NOT NULL,
    "destLocationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PACKED',
    "packingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "netWeight" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "grossWeight" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lengthCm" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "widthCm" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "heightCm" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "packagingCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "packedByName" TEXT,
    "shipmentId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PackageItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "batchId" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(65,30) NOT NULL DEFAULT 0
);

CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'LOCAL',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "originLocationId" TEXT,
    "originWarehouseId" TEXT,
    "destLocationId" TEXT,
    "destWarehouseId" TEXT,
    "dispatchDate" TIMESTAMP(3),
    "expectedArrival" TIMESTAMP(3),
    "actualArrival" TIMESTAMP(3),
    "transportCompanyId" TEXT,
    "courierCompanyId" TEXT,
    "freightForwarderId" TEXT,
    "transportMethod" TEXT,
    "trackingId" TEXT,
    "awbNo" TEXT,
    "blRef" TEXT,
    "customsRef" TEXT,
    "hsCode" TEXT,
    "countryOfOrigin" TEXT,
    "incoterms" TEXT,
    "vehicleType" TEXT,
    "vehicleReg" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "senderInfo" TEXT,
    "receiverInfo" TEXT,
    "pickupAddress" TEXT,
    "deliveryAddress" TEXT,
    "freightCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "insuranceCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "customsCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "importDuties" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxesCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "docCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "handlingCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastMileCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "otherCharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "totalCostBdt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "customsStatus" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ShipmentPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL
);

CREATE TABLE "ShipmentReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "warehouseId" TEXT NOT NULL,
    "receivedByName" TEXT,
    "boxesExpected" INTEGER NOT NULL DEFAULT 0,
    "boxesReceived" INTEGER NOT NULL DEFAULT 0,
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "receivingCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ShipmentDiscrepancy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL DEFAULT 0,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "missingQty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "LandedCostEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "TransportationExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origin" TEXT,
    "destination" TEXT,
    "purpose" TEXT,
    "partnerId" TEXT,
    "vehicleType" TEXT,
    "vehicleInfo" TEXT,
    "driverInfo" TEXT,
    "planId" TEXT,
    "batchId" TEXT,
    "poId" TEXT,
    "workOrderId" TEXT,
    "shipmentId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "paymentMethod" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memo" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "refNo" TEXT,
    "postedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "credit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "memo" TEXT
);

CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "partnerId" TEXT,
    "planId" TEXT,
    "batchId" TEXT,
    "locationId" TEXT,
    "shipmentId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "accountId" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'PAID',
    "approvedById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "VendorInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNo" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "poId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" TEXT NOT NULL,
    "partnerId" TEXT,
    "vendorInvoiceId" TEXT,
    "salesInvoiceId" TEXT,
    "expenseId" TEXT,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL
);

CREATE TABLE "VariantCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variantId" TEXT NOT NULL,
    "materialCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "serviceCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "transportCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "mfgCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "landedCostBdt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "landedCostSylhet" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "landedCostUk" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "finalizedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variantId" TEXT NOT NULL,
    "batchId" TEXT,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "refType" TEXT,
    "refId" TEXT,
    "refNo" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "SalesInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'WHOLESALE',
    "locationId" TEXT,
    "warehouseId" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cogs" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "SalesInvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(65,30) NOT NULL DEFAULT 0
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT,
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "storagePath" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" BYTEA
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

CREATE INDEX "Session_userId_idx" ON "Session"("userId");

CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

CREATE UNIQUE INDEX "UserLocation_userId_locationId_key" ON "UserLocation"("userId", "locationId");

CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

CREATE INDEX "ActivityEvent_date_idx" ON "ActivityEvent"("date");

CREATE INDEX "ActivityEvent_planId_idx" ON "ActivityEvent"("planId");

CREATE INDEX "ActivityEvent_batchId_idx" ON "ActivityEvent"("batchId");

CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

CREATE UNIQUE INDEX "Location_partnerId_key" ON "Location"("partnerId");

CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

CREATE UNIQUE INDEX "BusinessPartner_code_key" ON "BusinessPartner"("code");

CREATE INDEX "BusinessPartner_type_idx" ON "BusinessPartner"("type");

CREATE INDEX "BusinessPartner_name_idx" ON "BusinessPartner"("name");

CREATE UNIQUE INDEX "ProductCategory_name_key" ON "ProductCategory"("name");

CREATE UNIQUE INDEX "ProductPlan_code_key" ON "ProductPlan"("code");

CREATE INDEX "PlanVersion_planId_idx" ON "PlanVersion"("planId");

CREATE INDEX "PlanColor_planId_idx" ON "PlanColor"("planId");

CREATE INDEX "PlanSize_planId_idx" ON "PlanSize"("planId");

CREATE UNIQUE INDEX "MatrixCell_planId_colorId_sizeId_key" ON "MatrixCell"("planId", "colorId", "sizeId");

CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

CREATE INDEX "ProductVariant_planId_idx" ON "ProductVariant"("planId");

CREATE INDEX "Design_planId_idx" ON "Design"("planId");

CREATE INDEX "BOM_planId_idx" ON "BOM"("planId");

CREATE INDEX "BOMItem_bomId_idx" ON "BOMItem"("bomId");

CREATE UNIQUE INDEX "MaterialRequirement_planId_materialId_key" ON "MaterialRequirement"("planId", "materialId");

CREATE UNIQUE INDEX "MaterialCategory_name_key" ON "MaterialCategory"("name");

CREATE UNIQUE INDEX "Material_sku_key" ON "Material"("sku");

CREATE INDEX "Material_name_idx" ON "Material"("name");

CREATE UNIQUE INDEX "PurchaseOrder_code_key" ON "PurchaseOrder"("code");

CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

CREATE INDEX "PurchaseOrderItem_poId_idx" ON "PurchaseOrderItem"("poId");

CREATE UNIQUE INDEX "MaterialReceipt_code_key" ON "MaterialReceipt"("code");

CREATE UNIQUE INDEX "MaterialReceipt_idempotencyKey_key" ON "MaterialReceipt"("idempotencyKey");

CREATE INDEX "MaterialReceipt_poId_idx" ON "MaterialReceipt"("poId");

CREATE INDEX "MaterialReceiptItem_receiptId_idx" ON "MaterialReceiptItem"("receiptId");

CREATE UNIQUE INDEX "PurchaseReturn_code_key" ON "PurchaseReturn"("code");

CREATE UNIQUE INDEX "MaterialStock_materialId_warehouseId_key" ON "MaterialStock"("materialId", "warehouseId");

CREATE INDEX "InventoryMovement_materialId_idx" ON "InventoryMovement"("materialId");

CREATE INDEX "InventoryMovement_movementDate_idx" ON "InventoryMovement"("movementDate");

CREATE UNIQUE INDEX "StockAdjustment_code_key" ON "StockAdjustment"("code");

CREATE UNIQUE INDEX "StockCount_code_key" ON "StockCount"("code");

CREATE UNIQUE INDEX "ProductionStage_key_key" ON "ProductionStage"("key");

CREATE UNIQUE INDEX "ProductionBatch_code_key" ON "ProductionBatch"("code");

CREATE INDEX "ProductionBatch_planId_idx" ON "ProductionBatch"("planId");

CREATE UNIQUE INDEX "BatchVariant_batchId_variantId_key" ON "BatchVariant"("batchId", "variantId");

CREATE UNIQUE INDEX "WorkOrder_code_key" ON "WorkOrder"("code");

CREATE INDEX "WorkOrder_batchId_idx" ON "WorkOrder"("batchId");

CREATE INDEX "WorkOrder_partnerId_idx" ON "WorkOrder"("partnerId");

CREATE INDEX "WorkOrder_type_idx" ON "WorkOrder"("type");

CREATE UNIQUE INDEX "WorkOrderMaterial_workOrderId_materialId_key" ON "WorkOrderMaterial"("workOrderId", "materialId");

CREATE INDEX "WorkOrderReceipt_workOrderId_idx" ON "WorkOrderReceipt"("workOrderId");

CREATE UNIQUE INDEX "QualityInspection_code_key" ON "QualityInspection"("code");

CREATE INDEX "QualityInspection_batchId_idx" ON "QualityInspection"("batchId");

CREATE UNIQUE INDEX "ReworkOrder_code_key" ON "ReworkOrder"("code");

CREATE UNIQUE INDEX "FinishedStock_variantId_warehouseId_key" ON "FinishedStock"("variantId", "warehouseId");

CREATE INDEX "FinishedMovement_variantId_idx" ON "FinishedMovement"("variantId");

CREATE INDEX "FinishedMovement_movementDate_idx" ON "FinishedMovement"("movementDate");

CREATE UNIQUE INDEX "Package_code_key" ON "Package"("code");

CREATE INDEX "Package_status_idx" ON "Package"("status");

CREATE INDEX "PackageItem_packageId_idx" ON "PackageItem"("packageId");

CREATE UNIQUE INDEX "Shipment_code_key" ON "Shipment"("code");

CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");

CREATE INDEX "Shipment_type_idx" ON "Shipment"("type");

CREATE UNIQUE INDEX "ShipmentPackage_shipmentId_packageId_key" ON "ShipmentPackage"("shipmentId", "packageId");

CREATE UNIQUE INDEX "ShipmentReceipt_code_key" ON "ShipmentReceipt"("code");

CREATE UNIQUE INDEX "ShipmentReceipt_idempotencyKey_key" ON "ShipmentReceipt"("idempotencyKey");

CREATE INDEX "ShipmentReceipt_shipmentId_idx" ON "ShipmentReceipt"("shipmentId");

CREATE INDEX "ShipmentDiscrepancy_shipmentId_idx" ON "ShipmentDiscrepancy"("shipmentId");

CREATE INDEX "LandedCostEntry_shipmentId_idx" ON "LandedCostEntry"("shipmentId");

CREATE INDEX "LandedCostEntry_variantId_idx" ON "LandedCostEntry"("variantId");

CREATE UNIQUE INDEX "TransportationExpense_code_key" ON "TransportationExpense"("code");

CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

CREATE INDEX "Account_type_idx" ON "Account"("type");

CREATE UNIQUE INDEX "JournalEntry_entryNo_key" ON "JournalEntry"("entryNo");

CREATE INDEX "JournalEntry_date_idx" ON "JournalEntry"("date");

CREATE INDEX "JournalEntry_refType_refId_idx" ON "JournalEntry"("refType", "refId");

CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

CREATE UNIQUE INDEX "Expense_code_key" ON "Expense"("code");

CREATE INDEX "Expense_date_idx" ON "Expense"("date");

CREATE INDEX "Expense_category_idx" ON "Expense"("category");

CREATE INDEX "VendorInvoice_partnerId_idx" ON "VendorInvoice"("partnerId");

CREATE INDEX "VendorInvoice_status_idx" ON "VendorInvoice"("status");

CREATE UNIQUE INDEX "Payment_code_key" ON "Payment"("code");

CREATE INDEX "Payment_date_idx" ON "Payment"("date");

CREATE UNIQUE INDEX "ExchangeRate_date_base_quote_key" ON "ExchangeRate"("date", "base", "quote");

CREATE UNIQUE INDEX "VariantCost_variantId_key" ON "VariantCost"("variantId");

CREATE INDEX "CostEntry_variantId_idx" ON "CostEntry"("variantId");

CREATE UNIQUE INDEX "SalesInvoice_code_key" ON "SalesInvoice"("code");

CREATE INDEX "SalesInvoice_customerId_idx" ON "SalesInvoice"("customerId");

CREATE INDEX "SalesInvoice_invoiceDate_idx" ON "SalesInvoice"("invoiceDate");

CREATE INDEX "SalesInvoiceItem_invoiceId_idx" ON "SalesInvoiceItem"("invoiceId");

CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

CREATE UNIQUE INDEX "Document_code_key" ON "Document"("code");

CREATE INDEX "Document_refType_refId_idx" ON "Document"("refType", "refId");

CREATE INDEX "Document_category_idx" ON "Document"("category");

CREATE UNIQUE INDEX "ProductVariant_barcode_key" ON "ProductVariant"("barcode");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Location" ADD CONSTRAINT "Location_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductPlan" ADD CONSTRAINT "ProductPlan_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductPlan" ADD CONSTRAINT "ProductPlan_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlanVersion" ADD CONSTRAINT "PlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanColor" ADD CONSTRAINT "PlanColor_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanSize" ADD CONSTRAINT "PlanSize_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MatrixCell" ADD CONSTRAINT "MatrixCell_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MeasurementChart" ADD CONSTRAINT "MeasurementChart_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Design" ADD CONSTRAINT "Design_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Sample" ADD CONSTRAINT "Sample_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BOM" ADD CONSTRAINT "BOM_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BOMItem" ADD CONSTRAINT "BOMItem_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BOM" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BOMItem" ADD CONSTRAINT "BOMItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialRequirement" ADD CONSTRAINT "MaterialRequirement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialRequirement" ADD CONSTRAINT "MaterialRequirement_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Material" ADD CONSTRAINT "Material_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MaterialCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BusinessPartner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialReceipt" ADD CONSTRAINT "MaterialReceipt_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaterialReceiptItem" ADD CONSTRAINT "MaterialReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "MaterialReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialReceiptItem" ADD CONSTRAINT "MaterialReceiptItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialStock" ADD CONSTRAINT "MaterialStock_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialStock" ADD CONSTRAINT "MaterialStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BatchVariant" ADD CONSTRAINT "BatchVariant_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BatchVariant" ADD CONSTRAINT "BatchVariant_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkOrderMaterial" ADD CONSTRAINT "WorkOrderMaterial_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkOrderMaterial" ADD CONSTRAINT "WorkOrderMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkOrderReceipt" ADD CONSTRAINT "WorkOrderReceipt_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReworkOrder" ADD CONSTRAINT "ReworkOrder_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "QualityInspection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinishedStock" ADD CONSTRAINT "FinishedStock_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinishedStock" ADD CONSTRAINT "FinishedStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinishedMovement" ADD CONSTRAINT "FinishedMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinishedMovement" ADD CONSTRAINT "FinishedMovement_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinishedMovement" ADD CONSTRAINT "FinishedMovement_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PackageItem" ADD CONSTRAINT "PackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PackageItem" ADD CONSTRAINT "PackageItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_originWarehouseId_fkey" FOREIGN KEY ("originWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_destWarehouseId_fkey" FOREIGN KEY ("destWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShipmentPackage" ADD CONSTRAINT "ShipmentPackage_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShipmentPackage" ADD CONSTRAINT "ShipmentPackage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShipmentReceipt" ADD CONSTRAINT "ShipmentReceipt_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShipmentDiscrepancy" ADD CONSTRAINT "ShipmentDiscrepancy_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShipmentDiscrepancy" ADD CONSTRAINT "ShipmentDiscrepancy_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LandedCostEntry" ADD CONSTRAINT "LandedCostEntry_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LandedCostEntry" ADD CONSTRAINT "LandedCostEntry_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VariantCost" ADD CONSTRAINT "VariantCost_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesInvoiceItem" ADD CONSTRAINT "SalesInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SalesInvoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesInvoiceItem" ADD CONSTRAINT "SalesInvoiceItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AuthRateLimit" ("key" TEXT NOT NULL PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 0, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");
