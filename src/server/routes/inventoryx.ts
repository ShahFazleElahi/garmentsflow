import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, qInt, q, canAccessWarehouses } from "./helpers";
import { NextRequest } from "next/server";
import { D, N, nextDocNo, logAudit, logActivity, postJournal, ACC, type Tx } from "../core";
import { postMaterialMovement } from "../inventory";
import { can, scopedLocations } from "../auth";
import type { Prisma } from "@prisma/client";

async function activeMainWarehouse(tx: Tx, id: string) {
  if (!await tx.warehouse.count({ where: { id, type: "MAIN", isActive: true, location: { isActive: true } } })) {
    throw new Error("An active main warehouse is required");
  }
}

async function postInventoryVariance(tx: Tx, movement: { value: Prisma.Decimal; refId: string | null; refNo: string | null }, userId: string, increase: boolean) {
  const value = movement.value.toDecimalPlaces(2);
  if (value.isZero()) return;
  await postJournal(tx, {
    memo: `Inventory variance ${movement.refNo ?? ""}`, refType: "INVENTORY_VARIANCE",
    refId: movement.refId ?? undefined, refNo: movement.refNo ?? undefined, userId,
    lines: increase
      ? [{ accountCode: ACC.RM_INV, debit: value }, { accountCode: ACC.ABNORMAL, credit: value }]
      : [{ accountCode: ACC.ABNORMAL, debit: value }, { accountCode: ACC.RM_INV, credit: value }],
  });
}

export async function handleGet(segments: string[], req: NextRequest) {
  const [resource] = segments;
  const auth = await requirePerm(req, "view");
  if ("error" in auth) return auth.error;
  const locationIds = scopedLocations(auth.user);
  const warehouse = locationIds ? { locationId: { in: locationIds } } : undefined;
  const financial = can(auth.user, "view_financial");
  const materialFields = { omit: { purchasePrice: !financial, avgCost: !financial } };

  if (resource === "stocks") {
    const rows = await db.materialStock.findMany({
      where: { warehouse },
      omit: { avgCost: !financial },
      include: { material: { ...materialFields, include: { category: true } }, warehouse: { include: { location: true } } },
    });
    return ok(ser(rows));
  }
  if (resource === "ledger") {
    const materialId = q(req, "materialId");
    const take = Math.max(1, Math.min(1000, qInt(req, "take") ?? 300));
    const rows = await db.inventoryMovement.findMany({
      where: { materialId, ...(warehouse ? { OR: [{ from: warehouse }, { to: warehouse }] } : {}) },
      omit: { unitCost: !financial, value: !financial },
      include: { material: materialFields, from: { include: { location: true } }, to: { include: { location: true } } },
      orderBy: { movementDate: "desc" },
      take,
    });
    return ok(ser(rows));
  }
  if (resource === "custody") {
    // materials held by vendors (virtual custody warehouses)
    const rows = await db.materialStock.findMany({
      where: { warehouse: { type: "VENDOR_CUSTODY", ...warehouse } },
      omit: { avgCost: !financial },
      include: { material: materialFields, warehouse: { include: { location: { include: { partner: { omit: { bankInfo: !financial, openingBalance: !financial } } } } } } },
    });
    return ok(ser(rows));
  }
  const visibleWarehouseIds = warehouse
    ? (await db.warehouse.findMany({ where: warehouse, select: { id: true } })).map(row => row.id)
    : undefined;
  const warehouseId = visibleWarehouseIds ? { in: visibleWarehouseIds } : undefined;
  if (resource === "reservations") {
    const rows = await db.inventoryReservation.findMany({
      where: { status: "ACTIVE", warehouseId },
      include: { material: materialFields },
    });
    return ok(ser(rows));
  }
  if (resource === "counts") {
    const rows = await db.stockCount.findMany({ where: { warehouseId }, orderBy: { date: "desc" } });
    return ok(ser(rows));
  }
  if (resource === "adjustments") {
    const rows = await db.stockAdjustment.findMany({ where: { warehouseId }, orderBy: { date: "desc" } });
    return ok(ser(rows));
  }
  if (resource === "valuation") {
    if (!financial) return bad("Permission denied: view_financial", 403);
    const stocks = await db.materialStock.findMany({ where: { warehouse }, include: { material: { include: { category: true } }, warehouse: true } });
    const byCategory = new Map<string, { qty: number; value: number }>();
    let totalValue = 0, totalQty = 0;
    for (const s of stocks) {
      const v = Number(s.qty) * Number(s.avgCost);
      totalValue += v; totalQty += Number(s.qty);
      const cat = s.material.category?.name ?? "Uncategorized";
      const cur = byCategory.get(cat) ?? { qty: 0, value: 0 };
      cur.qty += Number(s.qty); cur.value += v;
      byCategory.set(cat, cur);
    }
    return ok({ totalValue, totalQty, byCategory: [...byCategory.entries()].map(([name, v]) => ({ name, ...v })) });
  }
  return bad(`Unknown inventory resource: ${resource}`, 404);
}

export async function handlePost(segments: string[], body: Record<string, unknown>, req: NextRequest) {
  const [resource, action] = segments;
  const auth = await requirePerm(req, "post");
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const ids = resource === "transfer" ? [String(body.fromWarehouseId ?? ""), String(body.toWarehouseId ?? "")]
    : ["adjust", "reserve", "count"].includes(resource) ? [String(body.warehouseId ?? "")]
      : [];
  if (ids.length && !await canAccessWarehouses(user, ids)) return bad("Warehouse access denied", 403);

  if (resource === "transfer") {
    try {
      const result = await db.$transaction(async (tx) => {
        const from = String(body.fromWarehouseId), to = String(body.toWarehouseId);
        if (from === to) throw new Error("Source and destination warehouses must differ");
        await activeMainWarehouse(tx, from);
        await activeMainWarehouse(tx, to);
        const items = (body.items ?? []) as { materialId: string; qty: number }[];
        if (!Array.isArray(items) || !items.length || items.some(item => !item || !item.materialId || !Number.isFinite(item.qty) || item.qty <= 0)) {
          throw new Error("Positive material transfer quantities are required");
        }
        for (const i of items) {
          await postMaterialMovement(tx, {
            materialId: i.materialId, fromWarehouseId: from, toWarehouseId: to, qty: i.qty,
            type: "TRANSFER", refType: "TRANSFER", userId: user.id, userName: user.name,
            note: body.notes as string | undefined,
          });
        }
        await logActivity(tx, { module: "INVENTORY", action: "transfer", description: `Material transfer: ${items.length} line(s) between warehouses`, userName: user.name });
        return { transferred: items.length };
      });
      return ok(result);
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if (resource === "adjust") {
    try {
      const result = await db.$transaction(async (tx) => {
        const code = await nextDocNo(tx, "ADJ");
        const type = String(body.type ?? "INCREASE");
        const qty = D(body.qty as number);
        const materialId = String(body.materialId);
        const warehouseId = String(body.warehouseId);
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!qty.isFinite() || qty.lte(0) || !["INCREASE", "DECREASE"].includes(type) || !reason) {
          throw new Error("Adjustment requires a positive quantity, direction and reason");
        }
        await activeMainWarehouse(tx, warehouseId);
        const adjustment = await tx.stockAdjustment.create({
          data: { code, materialId, warehouseId, qty, type, reason, userId: user.id, approvedById: user.id, notes: body.notes as string | undefined },
        });
        const increase = type === "INCREASE";
        const stock = increase ? await tx.materialStock.findUnique({ where: { materialId_warehouseId: { materialId, warehouseId } } }) : null;
        const movement = await postMaterialMovement(tx, {
          materialId, toWarehouseId: increase ? warehouseId : undefined, fromWarehouseId: increase ? undefined : warehouseId,
          qty, type: "ADJUSTMENT", unitCost: increase ? stock?.avgCost ?? (await tx.material.findUniqueOrThrow({ where: { id: materialId } })).avgCost : undefined,
          refType: "ADJUSTMENT", refId: adjustment.id, refNo: code, userId: user.id, userName: user.name, note: reason,
        });
        await postInventoryVariance(tx, movement, user.id, increase);
        await logAudit(tx, { userId: user.id, userName: user.name, action: "POST", entity: "StockAdjustment", refNo: code, newJson: body });
        await logActivity(tx, { module: "INVENTORY", action: "stock_adjustment", description: `Stock ${type.toLowerCase()} ${N(qty)} — ${reason}`, userName: user.name, refNo: code });
        return { code };
      });
      return ok(result);
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if (resource === "reserve") {
    try {
      const result = await db.$transaction(async (tx) => {
        const materialId = String(body.materialId);
        const warehouseId = String(body.warehouseId);
        const qty = D(body.qty as number);
        if (!qty.isFinite() || qty.lte(0)) throw new Error("Reservation quantity must be positive");
        const batchId = typeof body.batchId === "string" && body.batchId ? body.batchId : null;
        let planId = typeof body.planId === "string" && body.planId ? body.planId : null;
        if (batchId) {
          await tx.$queryRaw`SELECT "id" FROM "ProductionBatch" WHERE "id" = ${batchId} FOR UPDATE`;
          const batch = await tx.productionBatch.findUnique({ where: { id: batchId } });
          if (!batch || (planId && batch.planId !== planId) || !["PLANNED", "MATERIAL_RESERVED"].includes(batch.status)) {
            throw new Error("An open production batch matching the plan is required");
          }
          planId = batch.planId;
        } else if (planId && !await tx.productPlan.count({ where: { id: planId } })) {
          throw new Error("Product plan not found");
        }
        const stock = await tx.materialStock.findUnique({ where: { materialId_warehouseId: { materialId, warehouseId } }, include: { warehouse: true } });
        if (!stock || !stock.warehouse.isActive || stock.warehouse.type !== "MAIN") throw new Error("An active main warehouse stock record is required");
        const free = D(stock.qty).minus(D(stock.reservedQty));
        if (qty.gt(free)) throw new Error(`Cannot reserve: free quantity ${N(free)} < requested ${N(qty)}`);
        const changed = await tx.materialStock.updateMany({
          where: { id: stock.id, qty: stock.qty, reservedQty: stock.reservedQty },
          data: { reservedQty: { increment: qty } },
        });
        if (changed.count !== 1) throw new Error("Available stock changed; retry material reservation");
        const res = await tx.inventoryReservation.create({
          data: { materialId, warehouseId, qty, planId, batchId },
        });
        return res;
      });
      return ok(ser(result));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if (resource === "release") {
    try {
      const target = await db.inventoryReservation.findUnique({ where: { id: String(body.id) }, select: { warehouseId: true } });
      if (!target || !await canAccessWarehouses(user, [target.warehouseId])) return bad("Reservation not found", 404);
      const res = await db.$transaction(async tx => {
        const id = String(body.id);
        const reservation = await tx.inventoryReservation.findUniqueOrThrow({ where: { id } });
        if (reservation.batchId) {
          await tx.$queryRaw`SELECT "id" FROM "ProductionBatch" WHERE "id" = ${reservation.batchId} FOR UPDATE`;
        }
        // Read the remaining quantity after a concurrent issue has committed.
        const current = await tx.inventoryReservation.findUniqueOrThrow({ where: { id } });
        if (current.status === "RELEASED") return current;
        const changed = await tx.inventoryReservation.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "RELEASED" } });
        if (changed.count !== 1) throw new Error("Only active reservations can be released");
        const stock = await tx.materialStock.updateMany({
          where: { materialId: current.materialId, warehouseId: current.warehouseId, reservedQty: { gte: current.qty } },
          data: { reservedQty: { decrement: current.qty } },
        });
        if (stock.count !== 1) throw new Error("Reservation balance requires reconciliation");
        await logAudit(tx, { userId: user.id, userName: user.name, action: "UPDATE", entity: "InventoryReservation", entityId: id, newJson: { status: "RELEASED" } });
        return { ...current, status: "RELEASED" };
      });
      return ok(ser(res));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if (resource === "count") {
    try {
      const result = await db.$transaction(async (tx) => {
        const code = await nextDocNo(tx, "CNT");
        const warehouseId = String(body.warehouseId);
        await activeMainWarehouse(tx, warehouseId);
        const items = (body.items ?? []) as { materialId: string; countedQty: number }[];
        if (!Array.isArray(items) || !items.length || items.some(item => !item || typeof item.materialId !== "string" || !item.materialId ||
            !Number.isFinite(item.countedQty) || item.countedQty < 0) || new Set(items.map(item => item.materialId)).size !== items.length) {
          throw new Error("Stock count requires distinct materials and non-negative quantities");
        }
        await tx.$queryRaw`SELECT "id" FROM "MaterialStock" WHERE "warehouseId" = ${warehouseId} ORDER BY "materialId" FOR UPDATE`;
        const stocks = await tx.materialStock.findMany({ where: { warehouseId } });
        const byMaterial = new Map(stocks.map(stock => [stock.materialId, stock]));
        const detailed = items.map(item => {
          const systemQty = D(byMaterial.get(item.materialId)?.qty);
          return { materialId: item.materialId, systemQty, countedQty: item.countedQty, diffQty: D(item.countedQty).sub(systemQty) };
        });
        const count = await tx.stockCount.create({
          data: { code, warehouseId, itemsJson: JSON.stringify(ser(detailed)), status: "COMPLETED", userId: user.id, notes: body.notes as string | undefined },
        });
        let adjustments = 0;
        for (const detail of detailed) {
          if (detail.diffQty.isZero()) continue;
          const stock = byMaterial.get(detail.materialId);
          const increase = detail.diffQty.gt(0);
          const movement = await postMaterialMovement(tx, {
            materialId: detail.materialId, toWarehouseId: increase ? warehouseId : undefined,
            fromWarehouseId: increase ? undefined : warehouseId, qty: detail.diffQty.abs(),
            unitCost: increase ? stock?.avgCost ?? (await tx.material.findUniqueOrThrow({ where: { id: detail.materialId } })).avgCost : undefined,
            type: "ADJUSTMENT", refType: "STOCK_COUNT", refId: count.id, refNo: code, userId: user.id, userName: user.name,
            note: increase ? "Physical count surplus" : "Physical count shortage",
          });
          await postInventoryVariance(tx, movement, user.id, increase);
          adjustments++;
        }
        await logActivity(tx, { module: "INVENTORY", action: "stock_count", description: `Physical stock count ${code}: ${adjustments} line(s) reconciled`, userName: user.name, refNo: code });
        return { code, adjustments };
      });
      return ok(result);
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  return bad(`Unknown inventory action: ${resource}/${action ?? ""}`, 404);
}
