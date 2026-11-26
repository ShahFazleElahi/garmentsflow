import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, q, canAccessWarehouses } from "./helpers";
import { NextRequest } from "next/server";
import { D, N, nextDocNo, logAudit, logActivity, postJournal, ACC, payableAccountFor, claimTransactionRequest } from "../core";
import { postMaterialMovement } from "../inventory";
import { addCostEntries } from "../costing";
import { Prisma } from "@prisma/client";
import { can, scopedLocations } from "../auth";

// ───────────────────────── GET ─────────────────────────
export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, "view");
  if ("error" in auth) return auth.error;
  const financial = can(auth.user, "view_financial");
  const planCost = { estimatedBudget: !financial, targetMfgCost: !financial, targetLandedCost: !financial, targetWholesalePrice: !financial, targetRetailPrice: !financial };
  const variantCost = { estMaterialCost: !financial, estServiceCost: !financial, targetPrice: !financial };
  const batchCost = { estBudget: !financial };
  const workOrderCost = { pricingJson: !financial, estServiceCost: !financial, transportCost: !financial, advanceAmount: !financial,
    actualServiceCost: !financial, paidAmount: !financial, vendorInvoiceNo: !financial };
  const receiptCost = { serviceCharge: !financial, additionalCharge: !financial, reworkCharge: !financial,
    transportCost: !financial, invoiceNo: !financial, paidAmount: !financial };
  const partner = { omit: { bankInfo: !financial, openingBalance: !financial } };
  const material = { omit: { purchasePrice: !financial, avgCost: !financial } };

  if (resource === "batches" && !id) {
    const rows = await db.productionBatch.findMany({
      omit: batchCost,
      include: {
        plan: { omit: planCost, include: { category: true, collection: true } },
        variants: { include: { variant: { omit: variantCost } } },
        workOrders: { omit: workOrderCost, include: { partner } },
        inspections: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "batches" && id) {
    const row = await db.productionBatch.findUnique({
      where: { id },
      omit: batchCost,
      include: {
        plan: { omit: planCost, include: { colors: true, sizes: true, variants: { omit: variantCost } } },
        variants: { include: { variant: { omit: variantCost } } },
        workOrders: { omit: workOrderCost, include: { partner, materials: { include: { material } }, receipts: { omit: receiptCost } } },
        inspections: true,
      },
    });
    if (!row) return bad("Batch not found", 404);
    return ok(ser(row));
  }
  if (resource === "workorders" && !id) {
    const type = q(req, "type");
    const rows = await db.workOrder.findMany({
      where: type ? { type } : undefined,
      omit: workOrderCost,
      include: {
        partner, batch: { omit: batchCost, include: { plan: { omit: planCost } } },
        materials: { include: { material } },
        receipts: { omit: receiptCost, orderBy: { receiptDate: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "workorders" && id) {
    const row = await db.workOrder.findUnique({
      where: { id },
      omit: workOrderCost,
      include: {
        partner, batch: { omit: batchCost, include: { plan: { omit: planCost, include: { colors: true, sizes: true } }, variants: { include: { variant: { omit: variantCost } } } } },
        materials: { include: { material } },
        receipts: { omit: receiptCost, orderBy: { receiptDate: "desc" } },
        inspections: true,
      },
    });
    if (!row) return bad("Work order not found", 404);
    return ok(ser(row));
  }
  if (resource === "progress") {
    const rows = await db.batchVariant.findMany({ include: { variant: { omit: variantCost, include: { plan: { omit: planCost } } }, batch: { omit: batchCost } } });
    return ok(ser(rows));
  }
  return bad(`Unknown production resource: ${resource}`, 404);
}

// ───────────────────────── POST ─────────────────────────
export async function handlePost(segments: string[], body: Record<string, unknown>, req: NextRequest) {
  const [resource, action] = segments;
  const auth = await requirePerm(req, "post");
  if ("error" in auth) return auth.error;
  const { user } = auth;

  // ── Production batches ──
  if (resource === "batches") {
    switch (action) {
      case "create": {
        try {
          const result = await db.$transaction(async (tx) => {
            const planId = String(body.planId);
            await tx.$queryRaw`SELECT "id" FROM "ProductPlan" WHERE "id" = ${planId} FOR UPDATE`;
            const plan = await tx.productPlan.findUnique({ where: { id: planId }, include: { variants: { orderBy: { id: "asc" } }, batches: { include: { variants: true } } } });
            if (!plan) throw new Error("Plan not found");
            if (!["APPROVED", "PROCUREMENT_IN_PROGRESS", "READY_FOR_PRODUCTION", "IN_PRODUCTION", "PARTIALLY_COMPLETED"].includes(plan.status)) {
              throw new Error("Plan must be approved before creating production batches");
            }
            const qty = Number(body.plannedQty ?? 0);
            if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error("Batch quantity must be a positive integer");
            // cannot exceed remaining approved quantity
            const alreadyBatched = plan.batches.filter((b) => b.status !== "CANCELLED").reduce((a, b) => a + b.plannedQty, 0);
            if (alreadyBatched + qty > plan.plannedQty) {
              throw new Error(`Batch quantity exceeds approved plan: approved ${plan.plannedQty}, already batched ${alreadyBatched}, requested ${qty}`);
            }
            const allocated = new Map<string, number>();
            for (const batch of plan.batches.filter(b => b.status !== "CANCELLED")) {
              for (const variant of batch.variants) {
                allocated.set(variant.variantId, (allocated.get(variant.variantId) ?? 0) + variant.plannedQty);
              }
            }
            const weights = plan.variants.map(v => v.plannedQty - (allocated.get(v.id) ?? 0));
            if (weights.some(weight => weight < 0) || weights.reduce((a, b) => a + b, 0) < qty) {
              throw new Error("Batch quantity exceeds remaining variant allocations");
            }
            const code = await nextDocNo(tx, "BATCH");
            const batch = await tx.productionBatch.create({
              data: {
                code, planId: plan.id, plannedQty: qty, status: "PLANNED",
                startDate: body.startDate ? new Date(String(body.startDate)) : new Date(),
                expectedCompletionDate: body.expectedCompletionDate ? new Date(String(body.expectedCompletionDate)) : undefined,
                priority: String(body.priority ?? "MEDIUM"), managerName: body.managerName as string | undefined,
                estBudget: D(Number(body.estBudget ?? 0)), notes: body.notes as string | undefined, createdById: user.id,
              },
            });
            // allocate variants proportionally to plan variant quantities
            const allocs = allocateProportional(qty, weights);
            for (let i = 0; i < plan.variants.length; i++) {
              if (allocs[i] > 0) {
                await tx.batchVariant.create({
                  data: { batchId: batch.id, variantId: plan.variants[i].id, plannedQty: allocs[i] },
                });
              }
            }
            await tx.productPlan.update({ where: { id: plan.id }, data: { status: "IN_PRODUCTION" } });
            await logActivity(tx, { module: "PRODUCTION", action: "batch_created", description: `Production batch ${code} created for ${plan.code} — ${qty} ${plan.unit.toLowerCase()}`, userName: user.name, planId: plan.id, batchId: batch.id, refNo: code });
            return batch;
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "reserve": {
        try {
          const result = await db.$transaction(async (tx) => {
            const batchId = String(body.batchId);
            await tx.$queryRaw`SELECT "id" FROM "ProductionBatch" WHERE "id" = ${batchId} FOR UPDATE`;
            const batch = await tx.productionBatch.findUnique({ where: { id: batchId } });
            if (!batch) throw new Error("Batch not found");
            if (!["PLANNED", "MATERIAL_RESERVED"].includes(batch.status)) throw new Error("Batch is no longer open for material reservations");
            const lines = (body.items ?? []) as { materialId: string; warehouseId: string; qty: number }[];
            if (!Array.isArray(lines) || !lines.length || lines.some(line =>
              !line || typeof line.materialId !== "string" || typeof line.warehouseId !== "string" ||
              !Number.isFinite(line.qty) || line.qty <= 0)) throw new Error("Positive material reservation quantities are required");
            lines.sort((a, b) => a.warehouseId.localeCompare(b.warehouseId) || a.materialId.localeCompare(b.materialId));
            if (!await canAccessWarehouses(user, lines.map(line => line.warehouseId))) throw new Error("Warehouse access denied");
            for (const l of lines) {
              const stock = await tx.materialStock.findUnique({ where: { materialId_warehouseId: { materialId: l.materialId, warehouseId: l.warehouseId } }, include: { warehouse: true } });
              if (!stock || !stock.warehouse.isActive || stock.warehouse.type !== "MAIN") throw new Error("An active main warehouse stock record is required");
              const free = D(stock.qty).minus(D(stock.reservedQty));
              if (D(l.qty).gt(free)) throw new Error(`Insufficient free stock to reserve: ${N(free)} available, ${N(l.qty)} requested`);
              const changed = await tx.materialStock.updateMany({
                where: { id: stock.id, qty: stock.qty, reservedQty: stock.reservedQty },
                data: { reservedQty: { increment: D(l.qty) } },
              });
              if (changed.count !== 1) throw new Error("Available stock changed; retry material reservation");
              await tx.inventoryReservation.create({
                data: { materialId: l.materialId, warehouseId: l.warehouseId, qty: D(l.qty), batchId: batch.id, planId: batch.planId },
              });
            }
            await tx.productionBatch.update({ where: { id: batch.id }, data: { status: "MATERIAL_RESERVED" } });
            await logActivity(tx, { module: "PRODUCTION", action: "materials_reserved", description: `Materials reserved for batch ${batch.code} (${lines.length} line(s))`, userName: user.name, batchId: batch.id, refNo: batch.code });
            return { reserved: lines.length };
          });
          return ok(result);
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "status": {
        const batch = await db.productionBatch.findUnique({
          where: { id: String(body.id) },
        });

        if (!batch) return bad("Batch not found", 404);

        if (String(body.status) !== batch.status) {
          return bad(
            "Batch status must be changed through the production workflow",
            409
          );
        }

        return ok(ser(batch));
      }
      case "complete": {
        const batch = await db.productionBatch.findUnique({
          where: { id: String(body.id) },
        });

        if (!batch) return bad("Batch not found", 404);

        if (batch.status !== "COMPLETED") {
          return bad(
            "Batch completion requires final quality inspection",
            409
          );
        }

        return ok(ser(batch));
      }
    }
  }

  // ── Work orders ──
  if (resource === "workorders") {
    switch (action) {
      case "create": {
        try {
          const result = await db.$transaction(async (tx) => {
            const batchId = String(body.batchId);
            await tx.$queryRaw`SELECT "id" FROM "ProductionBatch" WHERE "id" = ${batchId} FOR UPDATE`;
            const batch = await tx.productionBatch.findUnique({ where: { id: batchId } });
            if (!batch) throw new Error("Batch not found");
            if (["COMPLETED", "CANCELLED"].includes(batch.status)) throw new Error("Batch is closed to new work orders");
            const partner = await tx.businessPartner.findUnique({ where: { id: String(body.partnerId) } });
            if (!partner?.isActive) throw new Error("An active vendor is required");
            const qty = Number(body.issuedQty ?? 0);
            const type = String(body.type ?? "EMBROIDERY");
            if (!["EMBROIDERY", "TAILORING", "CUTTING", "PRINTING", "WASHING", "FINISHING", "OTHER"].includes(type)) throw new Error("Invalid production stage");
            if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error("Issued quantity must be a positive integer");
            const existing = await tx.workOrder.aggregate({
              where: { batchId, type, status: { not: "CANCELLED" } }, _sum: { issuedQty: true },
            });
            if ((existing._sum.issuedQty ?? 0) + qty > batch.plannedQty) throw new Error("Issued quantity exceeds remaining batch capacity for this stage");
            const code = await nextDocNo(tx, "WO");
            const pricing = (body.pricing ?? {}) as Record<string, number>;
            const perPiece = Number(pricing.perPiece ?? 0);
            const fixed = Number(pricing.fixed ?? 0);
            if (![perPiece, fixed].every(value => Number.isFinite(value) && value >= 0)) throw new Error("Work-order pricing must be non-negative");
            const estService = D(perPiece).mul(qty).add(fixed).toDecimalPlaces(2);
            const wo = await tx.workOrder.create({
              data: {
                code, batchId: batch.id, planId: batch.planId, type,
                stageKey: (body.stageKey as string) || null, partnerId: partner.id, status: "MATERIALS_PREPARED",
                dispatchDate: body.dispatchDate ? new Date(String(body.dispatchDate)) : undefined,
                expectedDate: body.expectedDate ? new Date(String(body.expectedDate)) : undefined,
                issuedQty: qty, unit: String(body.unit ?? "Piece"),
                pricingJson: JSON.stringify(pricing), estServiceCost: D(estService),
                transportCost: D(Number(body.transportCost ?? 0)), advanceAmount: D(Number(body.advanceAmount ?? 0)),
                instructions: body.instructions as string | undefined, notes: body.notes as string | undefined,
                createdById: user.id,
              },
            });
            // allocate issued qty across variants proportionally (stored per-WO totals; batch variant progress on receiving)
            await logActivity(tx, { module: "PRODUCTION", action: "wo_created", description: `${type} work order ${wo.code} — ${partner.name}, ${qty} pc`, userName: user.name, planId: batch.planId, batchId: batch.id, refNo: wo.code, amount: estService });
            return wo;
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "issue": {
        // Issue materials from a warehouse into vendor custody (virtual location)
        try {
          const result = await db.$transaction(async (tx) => {
            const workOrderId = String(body.workOrderId);
            const order = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { batchId: true } });
            if (!order) throw new Error("Work order not found");
            await tx.$queryRaw`SELECT "id" FROM "ProductionBatch" WHERE "id" = ${order.batchId} FOR UPDATE`;
            const wo = await tx.workOrder.findUnique({
              where: { id: workOrderId },
              include: { partner: true, batch: true },
            });
            if (!wo) throw new Error("Work order not found");
            if (!["DRAFT", "MATERIALS_PREPARED"].includes(wo.status) ||
                ["COMPLETED", "CANCELLED"].includes(wo.batch.status)) throw new Error("Work order is no longer open for material issue");
            const fromWarehouseId = String(body.fromWarehouseId);
            const source = await tx.warehouse.findUnique({ where: { id: fromWarehouseId } });
            if (!source?.isActive || source.type !== "MAIN" || !await canAccessWarehouses(user, [fromWarehouseId])) {
              throw new Error("An accessible active main source warehouse is required");
            }
            const lines = (body.items ?? []) as { materialId: string; qty: number }[];
            if (!Array.isArray(lines) || !lines.length || lines.some(line =>
              !line || typeof line.materialId !== "string" || !Number.isFinite(line.qty) || line.qty <= 0)) {
              throw new Error("Positive material issue quantities are required");
            }
            lines.sort((a, b) => a.materialId.localeCompare(b.materialId));
            await tx.$queryRaw`SELECT "id" FROM "BusinessPartner" WHERE "id" = ${wo.partnerId} FOR UPDATE`;
            let custodyWarehouse = await tx.warehouse.findFirst({
              where: { type: "VENDOR_CUSTODY", location: { partnerId: wo.partnerId } },
              include: { location: true },
            });
            if (!custodyWarehouse) {
              // create vendor custody location + warehouse
              const loc = await tx.location.create({
                data: {
                  code: `VEN-${wo.partnerId.slice(-6).toUpperCase()}`, name: `${wo.partner.name} (Custody)`,
                  type: "VENDOR", partnerId: wo.partnerId,
                },
              });
              custodyWarehouse = await tx.warehouse.create({
                data: { code: `WH-${loc.code}`, name: `${wo.partner.name} Custody`, locationId: loc.id, type: "VENDOR_CUSTODY" },
                include: { location: true },
              });
            }
            for (const l of lines) {
              let remaining = D(l.qty);
              const reservations = await tx.inventoryReservation.findMany({
                where: { batchId: wo.batchId, warehouseId: fromWarehouseId, materialId: l.materialId, status: "ACTIVE",
                  OR: [{ workOrderId: null }, { workOrderId: wo.id }] },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              });
              for (const reservation of reservations) {
                if (remaining.isZero()) break;
                const consumed = remaining.lt(reservation.qty) ? remaining : reservation.qty;
                const changed = await tx.materialStock.updateMany({
                  where: { materialId: l.materialId, warehouseId: fromWarehouseId, reservedQty: { gte: consumed } },
                  data: { reservedQty: { decrement: consumed } },
                });
                if (changed.count !== 1) throw new Error("Reservation balance requires reconciliation");
                if (consumed.eq(reservation.qty)) {
                  await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: "CONSUMED", workOrderId: wo.id } });
                } else {
                  await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { qty: { decrement: consumed } } });
                  await tx.inventoryReservation.create({ data: {
                    materialId: reservation.materialId, warehouseId: reservation.warehouseId,
                    qty: consumed, planId: reservation.planId, batchId: reservation.batchId,
                    workOrderId: wo.id, status: "CONSUMED",
                  } });
                }
                remaining = remaining.sub(consumed);
              }
              await postMaterialMovement(tx, {
                materialId: l.materialId, fromWarehouseId, toWarehouseId: custodyWarehouse.id,
                qty: l.qty, type: "ISSUE_VENDOR", refType: "WORK_ORDER", refId: wo.id, refNo: wo.code,
                userId: user.id, userName: user.name, note: `Issued to ${wo.partner.name} for ${wo.code}`,
              });
              const existing = await tx.workOrderMaterial.findUnique({ where: { workOrderId_materialId: { workOrderId: wo.id, materialId: l.materialId } } });
              if (existing) {
                await tx.workOrderMaterial.update({
                  where: { id: existing.id },
                  data: {
                    issuedQty: { increment: D(l.qty) },
                    remainingQty: { increment: D(l.qty) },
                  },
                });
              } else {
                await tx.workOrderMaterial.create({
                  data: { workOrderId: wo.id, materialId: l.materialId, issuedQty: D(l.qty), remainingQty: D(l.qty) },
                });
              }
            }
            await tx.workOrder.update({ where: { id: wo.id }, data: { status: "DISPATCHED", dispatchDate: wo.dispatchDate ?? new Date() } });
            await tx.productionBatch.update({ where: { id: wo.batchId }, data: { status: "IN_PROGRESS" } });
            await logActivity(tx, { module: "PRODUCTION", action: "materials_issued", description: `${lines.length} material line(s) issued to ${wo.partner.name} for ${wo.code}`, userName: user.name, batchId: wo.batchId, refNo: wo.code });
            return { issued: lines.length, custodyWarehouseId: custodyWarehouse.id };
          });
          return ok(result);
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "receive": {
        // Partial receiving + material reconciliation + service cost + vendor invoice
        try {
          const result = await db.$transaction(async (tx) => {
            const request = await claimTransactionRequest(tx, "WORK_ORDER_RECEIVE", body, user.id);
            if (request?.resourceId) {
              const receipt = await tx.workOrderReceipt.findUniqueOrThrow({ where: { id: request.resourceId } });
              return { receipt: receipt.code, duplicate: true };
            }
            const workOrderId = String(body.workOrderId);
            const order = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { batchId: true } });
            if (!order) throw new Error("Work order not found");
            await tx.$queryRaw`SELECT "id" FROM "ProductionBatch" WHERE "id" = ${order.batchId} FOR UPDATE`;
            const wo = await tx.workOrder.findUnique({
              where: { id: workOrderId },
              include: { partner: true, batch: { include: { variants: { include: { variant: true } } } }, materials: { include: { material: true } } },
            });
            if (!wo) throw new Error("Work order not found");
            if (!["DISPATCHED", "RECEIVED_BY_FACTORY", "IN_PROGRESS", "PARTIALLY_COMPLETED", "READY_FOR_COLLECTION", "PARTIALLY_COLLECTED"].includes(wo.status) ||
                ["CANCELLED", "COMPLETED"].includes(wo.batch.status)) throw new Error("Work order is no longer open for collection");
            const received = Number(body.receivedQty ?? 0);
            const accepted = Number(body.acceptedQty ?? received);
            const rejected = Number(body.rejectedQty ?? 0);
            const damaged = Number(body.damagedQty ?? 0);
            const missing = Number(body.missingQty ?? 0);
            const pending = Number(body.pendingQty ?? 0);
            if (![received, accepted, rejected, damaged, missing, pending].every(value => Number.isSafeInteger(value) && value >= 0) ||
                received !== accepted + rejected + damaged || received + missing === 0) {
              throw new Error("Receipt requires whole quantities with accepted, rejected and damaged matching physical receipts");
            }
            const outstanding = wo.issuedQty - wo.receivedQty - wo.missingQty;
            const totalAccounted = received + missing + pending;
            if (totalAccounted > outstanding) {
              throw new Error(`Over-receiving prevented: ${totalAccounted} accounted > outstanding ${outstanding}`);
            }
            const custodyWarehouse = await tx.warehouse.findFirst({
              where: { type: "VENDOR_CUSTODY", location: { partnerId: wo.partnerId } },
            });

            const code = await nextDocNo(tx, "WOR");
            const consumedJson = (body.consumed ?? {}) as Record<string, number>;
            const returnedJson = (body.returned ?? {}) as Record<string, number>;
            const wastedJson = (body.wasted ?? {}) as Record<string, number>;
            const remainingJson = (body.remaining ?? {}) as Record<string, number>;
            const materialIds = new Set(wo.materials.map(row => row.materialId));
            for (const map of [consumedJson, returnedJson, wastedJson, remainingJson]) {
              if (!map || typeof map !== "object" || Array.isArray(map) || Object.entries(map).some(([id, value]) =>
                !materialIds.has(id) || !Number.isFinite(value) || value < 0)) {
                throw new Error("Material reconciliation requires known issued materials and non-negative quantities");
              }
            }
            if (!custodyWarehouse && [consumedJson, returnedJson, wastedJson].some(map => Object.values(map).some(value => value > 0))) {
              throw new Error("Vendor custody stock must be reconciled before collection");
            }
            const costFields = ["serviceCharge", "additionalCharge", "reworkCharge", "transportCost"];
            if (costFields.some(key => {
              const value = Number(body[key] ?? 0);
              return !Number.isFinite(value) || value < 0 || !D(value).eq(D(value).toDecimalPlaces(2));
            }) || !D(Number(body.paidAmount ?? 0)).isZero()) {
              throw new Error("Receipt costs require non-negative currency amounts and separate payment settlement");
            }

            // Reconciliation: Issued = Consumed + Returned + Wasted + Remaining-at-vendor.
            // remainingQty on the ledger row is the current physical remaining at the vendor.
            for (const wm of wo.materials) {
              const available = N(wm.remainingQty);
              const c = N(consumedJson[wm.materialId] ?? 0);
              const r = N(returnedJson[wm.materialId] ?? 0);
              const w = N(wastedJson[wm.materialId] ?? 0);
              if (c + r + w > available + 0.001) {
                throw new Error(
                  `Material reconciliation failed for ${wm.material.name}: declared ${Math.round((c + r + w) * 1000) / 1000} > remaining at vendor ${Math.round(available * 1000) / 1000}`
                );
              }
            }

            const receipt = await tx.workOrderReceipt.create({
              data: {
                code, workOrderId: wo.id, receivedQty: received, acceptedQty: accepted,
                rejectedQty: rejected, damagedQty: damaged, missingQty: missing,
                consumedJson: JSON.stringify(consumedJson), returnedJson: JSON.stringify(returnedJson),
                wastedJson: JSON.stringify(wastedJson), remainingJson: JSON.stringify(remainingJson),
                serviceCharge: D(Number(body.serviceCharge ?? 0)), additionalCharge: D(Number(body.additionalCharge ?? 0)),
                reworkCharge: D(Number(body.reworkCharge ?? 0)), transportCost: D(Number(body.transportCost ?? 0)),
                invoiceNo: body.invoiceNo as string | undefined,
                paidAmount: D(Number(body.paidAmount ?? 0)), notes: body.notes as string | undefined,
                receivedById: user.id,
              },
            });

            const stockByMaterial = new Map<string, { avgCost: number }>();
            // post material movements: consumption (abnormal cost stays with vendor → wastage posts abnormal loss), returns to main WH
            const needsReturn = Object.values(returnedJson).some(qty => qty > 0);
            const originalIssue = needsReturn ? await tx.inventoryMovement.findFirst({
              where: { refType: "WORK_ORDER", refId: wo.id, type: "ISSUE_VENDOR" },
              orderBy: { id: "asc" }, select: { fromWarehouseId: true },
            }) : null;
            const returnWarehouseId = typeof body.returnWarehouseId === "string" ? body.returnWarehouseId : originalIssue?.fromWarehouseId;
            const mainWh = needsReturn && returnWarehouseId ? await tx.warehouse.findFirst({
              where: { id: returnWarehouseId, type: "MAIN", isActive: true, location: { isActive: true } },
            }) : null;
            if (needsReturn && !mainWh) throw new Error("An active main return warehouse is required");
            if (scopedLocations(user)) {
              const origin = originalIssue ?? await tx.inventoryMovement.findFirst({
                where: { refType: "WORK_ORDER", refId: wo.id, type: "ISSUE_VENDOR" }, select: { fromWarehouseId: true },
              });
              const related = [origin?.fromWarehouseId ?? "", ...(mainWh ? [mainWh.id] : [])];
              if (!await canAccessWarehouses(user, related)) throw new Error("Warehouse access denied");
            }
            for (const [materialId, qtyRaw] of Object.entries({ ...consumedJson, ...returnedJson, ...wastedJson })) {
              const stock = await tx.materialStock.findFirst({ where: { materialId, warehouseId: custodyWarehouse?.id } });
              if (stock) stockByMaterial.set(materialId, { avgCost: N(stock.avgCost) });
            }
            for (const [materialId, qty] of Object.entries(consumedJson)) {
              if (!qty) continue;
              // consumed at vendor → decrement vendor custody
              await postMaterialMovement(tx, {
                materialId, fromWarehouseId: custodyWarehouse?.id, qty, type: "VENDOR_CONSUME",
                refType: "WORK_ORDER_RECEIPT", refId: receipt.id, refNo: code, userId: user.id, userName: user.name,
                note: `Consumed at ${wo.partner.name} for ${wo.code}`,
              });
              await tx.workOrderMaterial.updateMany({
                where: { workOrderId: wo.id, materialId },
                data: {
                  consumedQty: { increment: D(qty) },
                  remainingQty: { decrement: D(qty) },
                },
              });
            }
            for (const [materialId, qty] of Object.entries(returnedJson)) {
              if (!qty || !mainWh) continue;
              await postMaterialMovement(tx, {
                materialId, fromWarehouseId: custodyWarehouse?.id, toWarehouseId: mainWh.id, qty,
                type: "RETURN_STOCK", refType: "WORK_ORDER_RECEIPT", refId: receipt.id, refNo: code,
                userId: user.id, userName: user.name, note: `Returned from ${wo.partner.name}`,
              });
              await tx.workOrderMaterial.updateMany({
                where: { workOrderId: wo.id, materialId },
                data: { returnedQty: { increment: D(qty) }, remainingQty: { decrement: D(qty) } },
              });
            }
            for (const [materialId, qty] of Object.entries(wastedJson)) {
              if (!qty) continue;
              // wastage: remove from custody → abnormal loss account (normal wastage charged to production cost)
              await postMaterialMovement(tx, {
                materialId, fromWarehouseId: custodyWarehouse?.id, qty, type: "WASTAGE",
                refType: "WORK_ORDER_RECEIPT", refId: receipt.id, refNo: code, userId: user.id, userName: user.name,
                note: `Wastage at ${wo.partner.name}`,
              });
              await tx.workOrderMaterial.updateMany({
                where: { workOrderId: wo.id, materialId },
                data: { wastedQty: { increment: D(qty) }, remainingQty: { decrement: D(qty) } },
              });
              const stock = stockByMaterial.get(materialId);
              const value = qty * (stock?.avgCost ?? 0);
              await postJournal(tx, {
                memo: `Material wastage at ${wo.partner.name} (${wo.code})`, refType: "WORK_ORDER_RECEIPT",
                refId: receipt.id, refNo: code, userId: user.id,
                lines: [
                  { accountCode: ACC.ABNORMAL, debit: value },
                  { accountCode: ACC.RM_INV, credit: value },
                ],
              });
            }
            // validate declared remaining-with-vendor against the computed ledger remaining
            for (const wm of wo.materials) {
              if (remainingJson[wm.materialId] === undefined) continue;
              const declaredRemaining = D(remainingJson[wm.materialId]);
              const fresh = await tx.workOrderMaterial.findUniqueOrThrow({ where: { workOrderId_materialId: { workOrderId: wo.id, materialId: wm.materialId } } });
              if (!fresh.remainingQty.eq(declaredRemaining)) {
                throw new Error(
                  `Material reconciliation failed for ${wm.material.name}: declared remaining ${declaredRemaining} ≠ computed remaining ${N(fresh.remainingQty)}`
                );
              }
            }

            // Capitalize actual consumed materials using the movement ledger.
            const consumption = await tx.inventoryMovement.findMany({
              where: {
                refType: "WORK_ORDER_RECEIPT",
                refId: receipt.id,
                type: "VENDOR_CONSUME",
              },
            });

            const materialValue = consumption.reduce(
              (sum, movement) => sum.add(D(movement.value)),
              D(0)
            ).toDecimalPlaces(2);

            if (materialValue.gt(0)) {
              const variants = [...wo.batch.variants].sort(
                (a, b) => a.variantId.localeCompare(b.variantId)
              );

              const totalQty = variants.reduce(
                (sum, variant) => sum + variant.plannedQty,
                0
              );

              if (totalQty <= 0) {
                throw new Error("Cannot allocate material cost without batch quantities");
              }

              if (variants.some(v => v.plannedQty <= 0)) {
                throw new Error("Invalid batch quantity for material costing");
              }

              let allocated = D(0);

              const materialEntries = variants.map((variant, index) => {
                const amount = index === variants.length - 1
                  ? materialValue.sub(allocated)
                  : materialValue.mul(variant.plannedQty)
                      .div(totalQty)
                      .toDecimalPlaces(4);

                allocated = allocated.add(amount);

                return {
                  variantId: variant.variantId,
                  batchId: wo.batchId,
                  category: "MATERIAL",
                  amount,
                  refType: "WORK_ORDER_RECEIPT",
                  refId: receipt.id,
                  refNo: code,
                  note: "Actual material consumption allocated by batch quantity",
                };
              });

              await addCostEntries(tx, materialEntries);

              await postJournal(tx, {
                memo: `Material consumption ${wo.code}`,
                refType: "WORK_ORDER_RECEIPT",
                refId: receipt.id,
                refNo: code,
                userId: user.id,
                lines: [
                  { accountCode: ACC.WIP, debit: materialValue },
                  { accountCode: ACC.RM_INV, credit: materialValue },
                ],
              });
            }

            const serviceCharge = D(Number(body.serviceCharge ?? 0)).add(Number(body.additionalCharge ?? 0)).add(Number(body.reworkCharge ?? 0));
            const transportCost = D(Number(body.transportCost ?? 0));
            const vendorCharge = serviceCharge.add(transportCost);
            if (vendorCharge.gt(0)) {
              const variants = [...wo.batch.variants].sort((a, b) => a.variantId.localeCompare(b.variantId));
              const totalBatchQty = variants.reduce((sum, item) => sum + item.plannedQty, 0);
              if (totalBatchQty <= 0) throw new Error("Vendor charges require batch variant allocations");
              const serviceCategory = ["EMBROIDERY", "TAILORING", "CUTTING", "PRINTING", "WASHING", "FINISHING"].includes(wo.type)
                ? wo.type : "FINISHING";
              const costs = [{ amount: serviceCharge, category: serviceCategory }, { amount: transportCost, category: "VENDOR_TRANSPORT" }];
              await addCostEntries(tx, costs.filter(cost => cost.amount.gt(0)).flatMap(cost => {
                let quantity = 0;
                let allocated = D(0);
                return variants.map(variant => {
                  quantity += variant.plannedQty;
                  const cumulative = cost.amount.mul(quantity).div(totalBatchQty).toDecimalPlaces(4);
                  const amount = cumulative.sub(allocated);
                  allocated = cumulative;
                  return { variantId: variant.variantId, batchId: wo.batchId, category: cost.category,
                    amount, refType: "WORK_ORDER_RECEIPT", refId: receipt.id, refNo: code };
                });
              }));
              await tx.vendorInvoice.create({
                data: {
                  invoiceNo: body.invoiceNo as string || `${code}-SVC`, partnerId: wo.partnerId,
                  workOrderId: wo.id, amount: vendorCharge, status: "OPEN",
                  notes: `Vendor charges for ${wo.code} (receipt ${code})`,
                },
              });
              await postJournal(tx, {
                memo: `Vendor charges ${wo.code}`, refType: "WORK_ORDER_RECEIPT", refId: receipt.id, refNo: code, userId: user.id,
                lines: [
                  { accountCode: ACC.WIP, debit: vendorCharge },
                  { accountCode: payableAccountFor(wo.partner.type), credit: vendorCharge },
                ],
              });
            }

            // update WO aggregates
            const newReceived = wo.receivedQty + received;
            const newAccepted = wo.acceptedQty + accepted;
            const woStatus =
              newReceived + wo.missingQty + missing >= wo.issuedQty ? "AWAITING_QC"
              : newReceived > 0 ? "PARTIALLY_COLLECTED" : wo.status;
            await tx.workOrder.update({
              where: { id: wo.id },
              data: {
                receivedQty: newReceived, acceptedQty: newAccepted,
                rejectedQty: { increment: rejected }, damagedQty: { increment: damaged }, missingQty: { increment: missing },
                actualServiceCost: { increment: serviceCharge },
                status: woStatus,
              },
            });
            // Batch variant progress is credited at QC pass (finished goods creation), not per stage.
            const batchRefresh = await tx.productionBatch.findUnique({ where: { id: wo.batchId }, include: { variants: true } });
            const totalPlanned = batchRefresh!.variants.reduce((a, v) => a + v.plannedQty, 0);
            const totalDone = batchRefresh!.variants.reduce((a, v) => a + v.completedQty, 0);
            await tx.productionBatch.update({
              where: { id: wo.batchId },
              data: { status: totalDone >= totalPlanned ? "COMPLETED" : totalDone > 0 ? "PARTIAL" : "IN_PROGRESS" },
            });

            await logActivity(tx, {
              module: "PRODUCTION", action: "wo_received",
              description: `${wo.code} receipt ${code}: received ${received}, accepted ${accepted}, rejected ${rejected}, damaged ${ damaged}, missing ${missing}`,
              userName: user.name, batchId: wo.batchId, refNo: code, amount: vendorCharge,
            });
            if (request) await tx.salesRequest.update({ where: { key: request.key }, data: { resourceId: receipt.id } });
            return { receipt: code, duplicate: false };
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "complete": {
        const wo = await db.workOrder.findUnique({
          where: { id: String(body.id) },
        });

        if (!wo) return bad("Work order not found", 404);

        if (wo.status !== "COMPLETED") {
          return bad(
            "Work order completion requires receipt and quality inspection",
            409
          );
        }

        return ok(ser(wo));
      }
      case "cancel": {
        const wo = await db.workOrder.findUnique({
          where: { id: String(body.id) },
        });

        if (!wo) return bad("Work order not found", 404);

        if (wo.status !== "CANCELLED") {
          return bad(
            "Work order cancellation requires audited material and accounting reconciliation",
            409
          );
        }

        return ok(ser(wo));
      }
    }
  }
  return bad(`Unknown production action: ${resource}/${action ?? ""}`, 404);
}

function allocateProportional(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) {
    const base = Math.floor(total / n);
    const res = Array(n).fill(base);
    let rem = total - base * n;
    for (let i = 0; rem > 0; i = (i + 1) % n, rem--) res[i] += 1;
    return res;
  }
  const raw = weights.map((w) => (total * w) / sumW);
  const floors = raw.map(Math.floor);
  let rem = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  const res = [...floors];
  for (let k = 0; k < order.length && rem > 0; k++, rem--) res[order[k].i] += 1;
  return res;
}
