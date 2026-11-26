import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, qInt, q } from "./helpers";
import { NextRequest } from "next/server";
import { D, N, nextDocNo, logAudit, logActivity, postJournal, ACC } from "../core";
import { postMaterialMovement } from "../inventory";

export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, "view");
  if ("error" in auth) return auth.error;

  if (resource === "stocks") {
    const rows = await db.materialStock.findMany({
      include: { material: { include: { category: true } }, warehouse: { include: { location: true } } },
    });
    return ok(ser(rows));
  }
  if (resource === "ledger") {
    const materialId = q(req, "materialId");
    const take = qInt(req, "take", 300);
    const rows = await db.inventoryMovement.findMany({
      where: materialId ? { materialId } : undefined,
      include: { material: true, from: { include: { location: true } }, to: { include: { location: true } } },
      orderBy: { movementDate: "desc" },
      take,
    });
    return ok(ser(rows));
  }
  if (resource === "custody") {
    // materials held by vendors (virtual custody warehouses)
    const rows = await db.materialStock.findMany({
      where: { warehouse: { type: "VENDOR_CUSTODY" } },
      include: { material: true, warehouse: { include: { location: { include: { partner: true } } } } },
    });
    return ok(ser(rows));
  }
  if (resource === "reservations") {
    const rows = await db.inventoryReservation.findMany({
      where: { status: "ACTIVE" },
      include: { material: true },
    });
    return ok(ser(rows));
  }
  if (resource === "counts") {
    const rows = await db.stockCount.findMany({ orderBy: { date: "desc" } });
    return ok(ser(rows));
  }
  if (resource === "adjustments") {
    const rows = await db.stockAdjustment.findMany({ orderBy: { date: "desc" } });
    return ok(ser(rows));
  }
  if (resource === "valuation") {
    const stocks = await db.materialStock.findMany({ include: { material: { include: { category: true } }, warehouse: true } });
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

  if (resource === "transfer") {
    try {
      const result = await db.$transaction(async (tx) => {
        const from = String(body.fromWarehouseId), to = String(body.toWarehouseId);
        if (from === to) throw new Error("Source and destination warehouses must differ");
        const items = (body.items ?? []) as { materialId: string; qty: number }[];
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
        const reason = String(body.reason);
        if (qty.lte(0)) throw new Error("Adjustment quantity must be positive");
        await tx.stockAdjustment.create({
          data: { code, materialId, warehouseId, qty, type, reason, userId: user.id, approvedById: user.id, notes: body.notes as string | undefined },
        });
        if (type === "INCREASE") {
          const stock = await tx.materialStock.findUnique({ where: { materialId_warehouseId: { materialId, warehouseId } } });
          await postMaterialMovement(tx, {
            materialId, toWarehouseId: warehouseId, qty, type: "ADJUSTMENT",
            unitCost: stock ? D(stock.avgCost) : undefined, refType: "ADJUSTMENT", refNo: code,
            userId: user.id, userName: user.name, note: `Stock increase: ${reason}`,
          });
        } else {
          await postMaterialMovement(tx, {
            materialId, fromWarehouseId: warehouseId, qty, type: "ADJUSTMENT",
            refType: "ADJUSTMENT", refNo: code, userId: user.id, userName: user.name,
            note: `Stock decrease: ${reason}`,
          });
        }
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
        const stock = await tx.materialStock.findUnique({ where: { materialId_warehouseId: { materialId, warehouseId } } });
        if (!stock) throw new Error("Stock record not found");
        const free = D(stock.qty).minus(D(stock.reservedQty));
        if (qty.gt(free)) throw new Error(`Cannot reserve: free quantity ${N(free)} < requested ${N(qty)}`);
        await tx.materialStock.update({ where: { id: stock.id }, data: { reservedQty: { increment: qty } } });
        const res = await tx.inventoryReservation.create({
          data: { materialId, warehouseId, qty, planId: (body.planId as string) || null, batchId: (body.batchId as string) || null },
        });
        return res;
      });
      return ok(ser(result));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if (resource === "release") {
    const res = await db.inventoryReservation.update({ where: { id: String(body.id) }, data: { status: "RELEASED" } });
    await db.$transaction(async (tx) => {
      await tx.materialStock.update({
        where: { materialId_warehouseId: { materialId: res.materialId, warehouseId: res.warehouseId } },
        data: { reservedQty: { decrement: res.qty } },
      });
    });
    return ok(ser(res));
  }

  if (resource === "count") {
    try {
      const result = await db.$transaction(async (tx) => {
        const code = await nextDocNo(tx, "CNT");
        const warehouseId = String(body.warehouseId);
        const items = (body.items ?? []) as { materialId: string; countedQty: number }[];
        const stocks = await tx.materialStock.findMany({ where: { warehouseId } });
        const detailed = items.map((i) => {
          const sys = stocks.find((s) => s.materialId === i.materialId);
          return { materialId: i.materialId, systemQty: N(sys?.qty ?? 0), countedQty: i.countedQty, diffQty: i.countedQty - N(sys?.qty ?? 0) };
        });
        const count = await tx.stockCount.create({
          data: { code, warehouseId, itemsJson: JSON.stringify(detailed), status: "COMPLETED", userId: user.id, notes: body.notes as string | undefined },
        });
        // post reconciliation movements for differences
        let adjustments = 0;
        for (const d of detailed) {
          if (d.diffQty === 0) continue;
          const stock = stocks.find((s) => s.materialId === d.materialId);
          if (d.diffQty > 0) {
            await postMaterialMovement(tx, {
              materialId: d.materialId, toWarehouseId: warehouseId, qty: Math.abs(d.diffQty),
              unitCost: stock ? D(stock.avgCost) : undefined, type: "ADJUSTMENT",
              refType: "STOCK_COUNT", refId: count.id, refNo: code, userId: user.id, userName: user.name,
              note: "Physical count surplus",
            });
          } else {
            await postMaterialMovement(tx, {
              materialId: d.materialId, fromWarehouseId: warehouseId, qty: Math.abs(d.diffQty),
              type: "ADJUSTMENT", refType: "STOCK_COUNT", refId: count.id, refNo: code,
              userId: user.id, userName: user.name, note: "Physical count shortage",
            });
          }
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
