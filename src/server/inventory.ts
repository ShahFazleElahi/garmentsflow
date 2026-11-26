import { db } from "@/lib/db";
import { D, N, Tx, postJournal, ACC } from "./core";
import { Prisma } from "@prisma/client";

export type MaterialMovementInput = {
  materialId: string;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  qty: number | Prisma.Decimal;
  unitCost?: number | Prisma.Decimal | null; // for inward moves; when null uses current avg
  type: string; // RECEIPT | ISSUE_VENDOR | VENDOR_CONSUME | RETURN_STOCK | TRANSFER | ADJUSTMENT | WASTAGE | WRITE_OFF
  refType?: string;
  refId?: string;
  refNo?: string;
  userId?: string;
  userName?: string;
  note?: string;
  date?: Date;
};

/**
 * Post an immutable material inventory movement.
 * - Maintains MaterialStock per warehouse with weighted-average cost.
 * - Prevents negative inventory (throws).
 * - Every movement records source, destination, qty, cost, reference, user.
 */
export async function postMaterialMovement(tx: Tx, input: MaterialMovementInput) {
  const qty = D(input.qty);
  if (!qty.isFinite() || qty.lte(0) || (!input.fromWarehouseId && !input.toWarehouseId) && !["VENDOR_CONSUME", "WASTAGE", "WRITE_OFF"].includes(input.type)) throw new Error("Movement quantity must be positive");
  const material = await tx.material.findUnique({ where: { id: input.materialId } });
  if (!material) throw new Error("Material not found");

  // ── Outward leg ──
  let unitCost: Prisma.Decimal = D(input.unitCost ?? 0);
  if (input.fromWarehouseId) {
    const from = await tx.materialStock.findUnique({
      where: { materialId_warehouseId: { materialId: input.materialId, warehouseId: input.fromWarehouseId } },
    });
    const available = from ? D(from.qty).minus(from.reservedQty) : D(0);
    if (qty.gt(available)) {
      throw new Error(
        `Insufficient stock for ${material.name}: available ${N(available)} ${material.baseUnit}, requested ${N(qty)}`
      );
    }
    if (from) {
      unitCost = D(from.avgCost);
      const updated = await tx.materialStock.updateMany({ where: { id: from.id, qty: from.qty, reservedQty: from.reservedQty, avgCost: from.avgCost }, data: { qty: { decrement: qty } } });
      if (updated.count !== 1) throw new Error("Stock changed; retry transaction");
    }
  }

  // ── Inward leg (weighted average) ──
  if (input.toWarehouseId) {
    let dest = await tx.materialStock.findUnique({
      where: { materialId_warehouseId: { materialId: input.materialId, warehouseId: input.toWarehouseId } },
    });
    if (input.type === "RECEIPT" || input.unitCost != null) unitCost = D(input.unitCost ?? unitCost);
    if (!dest) {
      dest = await tx.materialStock.create({
        data: { materialId: input.materialId, warehouseId: input.toWarehouseId, qty: 0, avgCost: 0 },
      });
    }
    const oldQty = D(dest.qty);
    const oldVal = oldQty.mul(D(dest.avgCost));
    const newVal = oldVal.add(qty.mul(unitCost));
    const newQty = oldQty.add(qty);
    const newAvg = newQty.gt(0) ? newVal.div(newQty) : unitCost;
    const updated = await tx.materialStock.updateMany({ where: { id: dest.id, qty: dest.qty, avgCost: dest.avgCost }, data: { qty: newQty, avgCost: newAvg.toDecimalPlaces(4) } });
    if (updated.count !== 1) throw new Error("Stock changed; retry transaction");
    // keep material master avg cost in sync (simple global weighted average)
    await tx.material.update({
      where: { id: input.materialId },
      data: { avgCost: newAvg.toDecimalPlaces(4) },
    });
  }

  return tx.inventoryMovement.create({
    data: {
      movementDate: input.date ?? new Date(),
      materialId: input.materialId,
      fromWarehouseId: input.fromWarehouseId ?? null,
      toWarehouseId: input.toWarehouseId ?? null,
      qty, unitCost, value: qty.mul(unitCost),
      type: input.type, refType: input.refType, refId: input.refId, refNo: input.refNo,
      userId: input.userId, userName: input.userName, note: input.note,
    },
  });
}

/** Post receipt: stock + weighted average + journal (Inventory debit, AP credit). */
export async function postReceiptAccounting(
  tx: Tx,
  data: {
    materialValue: number | Prisma.Decimal; // stock value excl. transport (already per-line incl freight allocation)
    transportCost: number | Prisma.Decimal;
    loadingCost: number | Prisma.Decimal;
    unloadingCost: number | Prisma.Decimal;
    otherCost: number | Prisma.Decimal;
    taxAmount: number | Prisma.Decimal;
    totalPayable: number | Prisma.Decimal; // full invoice payable to supplier
    refId: string; refNo: string; userId?: string; date?: Date;
  }
) {
  const stockValue = D(data.materialValue).add(data.transportCost).add(data.loadingCost).add(data.unloadingCost).add(data.otherCost);
  await postJournal(tx, {
    date: data.date, memo: `Material receipt ${data.refNo}`,
    refType: "MATERIAL_RECEIPT", refId: data.refId, refNo: data.refNo, userId: data.userId,
    lines: [
      { accountCode: ACC.RM_INV, debit: stockValue },
      ...(D(data.taxAmount).gt(0) ? [{ accountCode: ACC.INPUT_TAX, debit: D(data.taxAmount) }] : []),
      { accountCode: ACC.AP_SUPPLIER, credit: D(data.totalPayable) },
    ],
  });
}

/** Finished goods movement — per variant. Enforces negative-stock prevention. */
export type FinishedMovementInput = {
  variantId: string;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  qty: number;
  unitCost?: number | Prisma.Decimal | null;
  type: string; // PRODUCTION_IN | PACK | UNPACK | DISPATCH_OUT | RECEIVE_IN | SALE_OUT | RETURN_IN | ADJUST | WRITE_OFF
  refType?: string;
  refId?: string;
  refNo?: string;
  userId?: string;
  userName?: string;
  note?: string;
  date?: Date;
};

export async function postFinishedMovement(tx: Tx, input: FinishedMovementInput) {
  if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new Error("Finished movement quantity must be positive");
  if (!input.fromWarehouseId && !input.toWarehouseId) throw new Error("Finished movement requires a warehouse");
  const variant = await tx.productVariant.findUnique({ where: { id: input.variantId } });
  if (!variant) throw new Error("Product variant not found");
  let unitCost = D(input.unitCost ?? 0);
  if (input.fromWarehouseId) {
    const from = await tx.finishedStock.findUnique({
      where: { variantId_warehouseId: { variantId: input.variantId, warehouseId: input.fromWarehouseId } },
    });
    const requiresPassed = ["PACK", "SALE_OUT", "TRANSFER"].includes(input.type);
    if (requiresPassed && from?.qualityStatus !== "PASSED") throw new Error("Only QC-passed stock is available for this movement");
    const available = from ? from.qty - from.reservedQty : 0;
    if (input.qty > available) {
      throw new Error(
        `Insufficient finished stock for ${variant.sku}: available ${available}, requested ${input.qty}`
      );
    }
    if (from) {
      unitCost = D(from.unitCost);
      const updated = await tx.finishedStock.updateMany({ where: {
        id: from.id,
        qty: from.qty,
        reservedQty: from.reservedQty,
        unitCost: from.unitCost,
        ...(requiresPassed ? { qualityStatus: "PASSED" } : {}),
      }, data: { qty: { decrement: input.qty } } });
      if (updated.count !== 1) throw new Error("Stock changed; retry transaction");
    }
  }
  if (input.toWarehouseId) {
    if (input.unitCost != null) unitCost = D(input.unitCost);
    let dest = await tx.finishedStock.findUnique({
      where: { variantId_warehouseId: { variantId: input.variantId, warehouseId: input.toWarehouseId } },
    });
    if (!dest) {
      dest = await tx.finishedStock.create({
        data: { variantId: input.variantId, warehouseId: input.toWarehouseId, qty: 0, unitCost: 0 },
      });
    }
    const oldQty = dest.qty;
    const oldVal = D(oldQty).mul(D(dest.unitCost));
    const newQty = oldQty + input.qty;
    const newVal = oldVal.add(D(input.qty).mul(unitCost));
    const newAvg = newQty > 0 ? newVal.div(newQty) : unitCost;
    const updated = await tx.finishedStock.updateMany({ where: { id: dest.id, qty: dest.qty, unitCost: dest.unitCost }, data: { qty: newQty, unitCost: newAvg.toDecimalPlaces(4) } });
    if (updated.count !== 1) throw new Error("Stock changed; retry transaction");
  }
  return tx.finishedMovement.create({
    data: {
      movementDate: input.date ?? new Date(),
      variantId: input.variantId,
      fromWarehouseId: input.fromWarehouseId ?? null,
      toWarehouseId: input.toWarehouseId ?? null,
      qty: input.qty, unitCost, value: D(input.qty).mul(unitCost),
      type: input.type, refType: input.refType, refId: input.refId, refNo: input.refNo,
      userId: input.userId, userName: input.userName, note: input.note,
    },
  });
}

/** MRP engine: compute requirements from approved BOM × variant quantities. */
export async function generateMRP(tx: Tx, planId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ProductPlan" WHERE "id" = ${planId} FOR UPDATE`;
  const plan = await tx.productPlan.findUnique({
    where: { id: planId },
    include: { variants: true, boms: { where: { status: "APPROVED" }, include: { items: true }, orderBy: { version: "desc" } } },
  });
  if (!plan) throw new Error("Plan not found");
  const bom = plan.boms[0];
  if (!bom) throw new Error("No approved BOM for this plan");

  // aggregate per material, honoring size overrides
  const need = new Map<string, Prisma.Decimal>();
  const netNeed = new Map<string, Prisma.Decimal>();
  for (const variant of plan.variants) {
    if (variant.plannedQty <= 0) continue;
    for (const item of bom.items) {
      if (item.colorId && item.colorId !== variant.colorId) continue;
      let per = D(item.qtyPerPiece);
      const overrides = item.sizeOverridesJson ? JSON.parse(item.sizeOverridesJson) as Record<string, number> : null;
      if (overrides && overrides[variant.sizeName] != null) per = D(overrides[variant.sizeName]);
      const net = per.mul(D(variant.plannedQty));
      const gross = net.mul(D(1).add(D(item.wastagePct).div(100)));

      netNeed.set(
        item.materialId,
        (netNeed.get(item.materialId) ?? new Prisma.Decimal(0)).add(net)
      );
      need.set(item.materialId, (need.get(item.materialId) ?? new Prisma.Decimal(0)).add(gross));
    }
  }

  // incoming = approved/received POs still open for this plan
  const openPos = await tx.purchaseOrder.findMany({
    where: { planId, status: { in: ["ORDERED", "PARTIAL"] } },
    include: { items: true },
  });
  const incoming = new Map<string, Prisma.Decimal>();
  for (const po of openPos) {
    for (const item of po.items) {
      const remaining = Prisma.Decimal.max(D(item.qty).minus(item.receivedQty), 0);
      incoming.set(item.materialId, (incoming.get(item.materialId) ?? new Prisma.Decimal(0)).add(remaining));
    }
  }

  const materialIds = [...need.keys()];
  const stocks = await tx.materialStock.findMany({
    where: { materialId: { in: materialIds }, warehouse: { type: "MAIN", isActive: true, location: { isActive: true } } },
  });
  const reservations = await tx.inventoryReservation.findMany({
    where: { planId, materialId: { in: materialIds }, status: "ACTIVE" },
  });
  const materials = await tx.material.findMany({ where: { id: { in: materialIds } } });
  const matById = new Map(materials.map((m) => [m.id, m]));

  await tx.materialRequirement.deleteMany({
    where: { planId, materialId: { notIn: materialIds } },
  });

  const rows: unknown[] = [];
  for (const [materialId, gross] of need) {
    const materialStocks = stocks.filter(s => s.materialId === materialId);
    const warehouseIds = new Set(materialStocks.map(s => s.warehouseId));
    const stockQty = materialStocks.reduce((a, s) => a.add(s.qty), D(0));
    const reservedQty = materialStocks.reduce((a, s) => a.add(s.reservedQty), D(0));
    const reservedForPlan = reservations.filter(r => r.materialId === materialId && warehouseIds.has(r.warehouseId))
      .reduce((a, r) => a.add(r.qty), D(0));
    const inc = incoming.get(materialId) ?? new Prisma.Decimal(0);
    const mat = matById.get(materialId)!;
    const available = Prisma.Decimal.max(stockQty.minus(reservedQty).add(Prisma.Decimal.min(reservedQty, reservedForPlan)), 0);
    const shortage = gross.minus(available).minus(inc);
    const suggested = shortage.gt(0) ? shortage : new Prisma.Decimal(0);
    const estCost = suggested.mul(D(mat.avgCost));
    const calculated = {
        netQty: (netNeed.get(materialId) ?? new Prisma.Decimal(0)).toDecimalPlaces(3),
        wastageQty: gross.minus(
          netNeed.get(materialId) ?? new Prisma.Decimal(0)
        ).toDecimalPlaces(3),
        grossQty: gross.toDecimalPlaces(3),
        stockQty: stockQty.toDecimalPlaces(3), reservedQty: reservedQty.toDecimalPlaces(3),
        incomingQty: inc.toDecimalPlaces(3),
        shortageQty: shortage.gt(0) ? shortage.toDecimalPlaces(3) : 0,
        suggestedQty: suggested.toDecimalPlaces(3), estCost,
    };
    const row = await tx.materialRequirement.upsert({
      where: { planId_materialId: { planId, materialId } },
      create: { planId, materialId, ...calculated },
      update: { ...calculated, generatedAt: new Date() },
    });
    rows.push(row);
  }
  return rows;
}
