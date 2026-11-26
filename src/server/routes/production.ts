import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, q } from "./helpers";
import { NextRequest } from "next/server";
import { D, N, nextDocNo, logAudit, logActivity, postJournal, ACC, payableAccountFor } from "../core";
import { postMaterialMovement } from "../inventory";
import { addCostEntries } from "../costing";
import { Prisma } from "@prisma/client";

// ───────────────────────── GET ─────────────────────────
export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, "view");
  if ("error" in auth) return auth.error;

  if (resource === "batches" && !id) {
    const rows = await db.productionBatch.findMany({
      include: {
        plan: { include: { category: true, collection: true } },
        variants: { include: { variant: true } },
        workOrders: { include: { partner: true } },
        inspections: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "batches" && id) {
    const row = await db.productionBatch.findUnique({
      where: { id },
      include: {
        plan: { include: { colors: true, sizes: true, variants: true } },
        variants: { include: { variant: true } },
        workOrders: { include: { partner: true, materials: { include: { material: true } }, receipts: true } },
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
      include: {
        partner: true, batch: { include: { plan: true } },
        materials: { include: { material: true } },
        receipts: { orderBy: { receiptDate: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "workorders" && id) {
    const row = await db.workOrder.findUnique({
      where: { id },
      include: {
        partner: true, batch: { include: { plan: { include: { colors: true, sizes: true } }, variants: { include: { variant: true } } } },
        materials: { include: { material: true } },
        receipts: { orderBy: { receiptDate: "desc" } },
        inspections: true,
      },
    });
    if (!row) return bad("Work order not found", 404);
    return ok(ser(row));
  }
  if (resource === "progress") {
    const rows = await db.batchVariant.findMany({ include: { variant: { include: { plan: true } }, batch: true } });
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
            const plan = await tx.productPlan.findUnique({ where: { id: String(body.planId) }, include: { variants: true, batches: { include: { variants: true } } } });
            if (!plan) throw new Error("Plan not found");
            if (!["APPROVED", "PROCUREMENT_IN_PROGRESS", "READY_FOR_PRODUCTION", "IN_PRODUCTION", "PARTIALLY_COMPLETED"].includes(plan.status)) {
              throw new Error("Plan must be approved before creating production batches");
            }
            const qty = Number(body.plannedQty ?? 0);
            if (qty <= 0) throw new Error("Batch quantity must be positive");
            // cannot exceed remaining approved quantity
            const alreadyBatched = plan.batches.filter((b) => b.status !== "CANCELLED").reduce((a, b) => a + b.plannedQty, 0);
            if (alreadyBatched + qty > plan.plannedQty) {
              throw new Error(`Batch quantity exceeds approved plan: approved ${plan.plannedQty}, already batched ${alreadyBatched}, requested ${qty}`);
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
            const weights = plan.variants.map((v) => v.plannedQty);
            const totalW = weights.reduce((a, b) => a + b, 0);
            const allocs = allocateProportional(qty, weights);
            for (let i = 0; i < plan.variants.length; i++) {
              if (allocs[i] > 0) {
                await tx.batchVariant.create({
                  data: { batchId: batch.id, variantId: plan.variants[i].id, plannedQty: allocs[i] },
                });
              }
            }
            void totalW;
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
            const batch = await tx.productionBatch.findUnique({ where: { id: String(body.batchId) }, include: { plan: true } });
            if (!batch) throw new Error("Batch not found");
            const lines = (body.items ?? []) as { materialId: string; warehouseId: string; qty: number }[];
            for (const l of lines) {
              const stock = await tx.materialStock.findUnique({ where: { materialId_warehouseId: { materialId: l.materialId, warehouseId: l.warehouseId } } });
              if (!stock) throw new Error("Stock record not found");
              const free = D(stock.qty).minus(D(stock.reservedQty));
              if (D(l.qty).gt(free)) throw new Error(`Insufficient free stock to reserve: ${N(free)} available, ${N(l.qty)} requested`);
              await tx.materialStock.update({ where: { id: stock.id }, data: { reservedQty: { increment: D(l.qty) } } });
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
        const batch = await db.productionBatch.update({ where: { id: String(body.id) }, data: { status: String(body.status) } });
        return ok(ser(batch));
      }
      case "complete": {
        const batch = await db.productionBatch.update({ where: { id: String(body.id) }, data: { status: "COMPLETED" } });
        await db.$transaction((tx) => logActivity(tx, { module: "PRODUCTION", action: "batch_completed", description: `Batch ${batch.code} completed`, userName: user.name, batchId: batch.id, refNo: batch.code }));
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
            const batch = await tx.productionBatch.findUnique({ where: { id: String(body.batchId) }, include: { plan: true, variants: { include: { variant: true } } } });
            if (!batch) throw new Error("Batch not found");
            const partner = await tx.businessPartner.findUnique({ where: { id: String(body.partnerId) } });
            if (!partner) throw new Error("Vendor not found");
            const qty = Number(body.issuedQty ?? 0);
            if (qty <= 0) throw new Error("Issued quantity must be positive");
            const code = await nextDocNo(tx, "WO");
            const pricing = (body.pricing ?? {}) as Record<string, number>;
            const perPiece = Number(pricing.perPiece ?? 0);
            const fixed = Number(pricing.fixed ?? 0);
            const estService = qty * perPiece + fixed;
            const wo = await tx.workOrder.create({
              data: {
                code, batchId: batch.id, planId: batch.planId, type: String(body.type ?? "EMBROIDERY"),
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
            await logActivity(tx, { module: "PRODUCTION", action: "wo_created", description: `${String(body.type ?? "EMBROIDERY")} work order ${wo.code} — ${partner.name}, ${qty} pc`, userName: user.name, planId: batch.planId, batchId: batch.id, refNo: wo.code, amount: estService });
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
            const wo = await tx.workOrder.findUnique({
              where: { id: String(body.workOrderId) },
              include: { partner: true, batch: true },
            });
            if (!wo) throw new Error("Work order not found");
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
            const fromWarehouseId = String(body.fromWarehouseId);
            const lines = (body.items ?? []) as { materialId: string; qty: number }[];
            if (!lines.length) throw new Error("No material lines to issue");
            for (const l of lines) {
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
            const idem = body.idempotencyKey as string | undefined;
            if (idem) {
              const dupe = await tx.workOrderReceipt.findFirst({ where: { workOrderId: String(body.workOrderId), code: idem } });
              if (dupe) return { duplicate: true };
            }
            const wo = await tx.workOrder.findUnique({
              where: { id: String(body.workOrderId) },
              include: { partner: true, batch: { include: { variants: { include: { variant: true } } } }, materials: { include: { material: true } } },
            });
            if (!wo) throw new Error("Work order not found");
            const received = Number(body.receivedQty ?? 0);
            const accepted = Number(body.acceptedQty ?? received);
            const rejected = Number(body.rejectedQty ?? 0);
            const damaged = Number(body.damagedQty ?? 0);
            const missing = Number(body.missingQty ?? 0);
            const pending = Number(body.pendingQty ?? 0);
            const totalAccounted = accepted + rejected + damaged + missing + pending;
            if (totalAccounted > wo.issuedQty - wo.receivedQty + 0.0001) {
              throw new Error(`Over-receiving prevented: ${totalAccounted} accounted > outstanding ${wo.issuedQty - wo.receivedQty}`);
            }
            const custodyWarehouse = await tx.warehouse.findFirst({
              where: { type: "VENDOR_CUSTODY", location: { partnerId: wo.partnerId } },
            });

            const code = await nextDocNo(tx, "WOR");
            const consumedJson = (body.consumed ?? {}) as Record<string, number>;
            const returnedJson = (body.returned ?? {}) as Record<string, number>;
            const wastedJson = (body.wasted ?? {}) as Record<string, number>;
            const remainingJson = (body.remaining ?? {}) as Record<string, number>;

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
            const mainWh = await tx.warehouse.findFirst({ where: { type: "MAIN", location: { name: "Dhaka" } } });
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
              const declaredRemaining = N(remainingJson[wm.materialId] ?? N(wm.remainingQty));
              const fresh = await tx.workOrderMaterial.findUniqueOrThrow({ where: { workOrderId_materialId: { workOrderId: wo.id, materialId: wm.materialId } } });
              if (Math.abs(N(fresh.remainingQty) - declaredRemaining) > 0.001) {
                throw new Error(
                  `Material reconciliation failed for ${wm.material.name}: declared remaining ${declaredRemaining} ≠ computed remaining ${N(fresh.remainingQty)}`
                );
              }
            }

            // service cost → vendor invoice + journal + costing allocation
            const serviceCharge = Number(body.serviceCharge ?? 0) + Number(body.additionalCharge ?? 0) + Number(body.reworkCharge ?? 0);
            const transportCost = Number(body.transportCost ?? 0);
            if (serviceCharge > 0) {
              const costCategory = wo.type === "EMBROIDERY" ? "EMBROIDERY" : wo.type === "TAILORING" ? "TAILORING" : wo.type === "CUTTING" ? "CUTTING" : wo.type === "PRINTING" ? "PRINTING" : wo.type === "WASHING" ? "WASHING" : "FINISHING";
              // allocate across batch variants proportionally to accepted qty
              const totalBatchQty = wo.batch.variants.reduce((a, bv) => a + bv.plannedQty, 0) || 1;
              const entries = wo.batch.variants.map((bv) => ({
                variantId: bv.variantId,
                batchId: wo.batchId,
                category: costCategory,
                amount: (accepted / totalBatchQty) * bv.plannedQty * (serviceCharge / Math.max(accepted, 1)),
                refType: "WORK_ORDER", refId: wo.id, refNo: wo.code,
              }));
              await addCostEntries(tx, entries);
              const cat = await tx.businessPartner.findUniqueOrThrow({ where: { id: wo.partnerId } });
              await tx.vendorInvoice.create({
                data: {
                  invoiceNo: body.invoiceNo as string || `${wo.code}-SVC`, partnerId: wo.partnerId,
                  workOrderId: wo.id, amount: D(serviceCharge), status: "OPEN",
                  notes: `Service charge for ${wo.code} (receipt ${code})`,
                },
              });
              await postJournal(tx, {
                memo: `Service charges ${wo.code}`, refType: "WORK_ORDER_RECEIPT", refId: receipt.id, refNo: code, userId: user.id,
                lines: [
                  { accountCode: ACC.SERVICE, debit: serviceCharge },
                  { accountCode: payableAccountFor(cat.type), credit: serviceCharge },
                ],
              });
            }
            if (transportCost > 0) {
              const totalBatchQty = wo.batch.variants.reduce((a, bv) => a + bv.plannedQty, 0) || 1;
              await addCostEntries(tx, wo.batch.variants.map((bv) => ({
                variantId: bv.variantId, batchId: wo.batchId, category: "TRANSPORT",
                amount: (accepted / totalBatchQty) * bv.plannedQty * (transportCost / Math.max(accepted, 1)),
                refType: "WORK_ORDER", refId: wo.id, refNo: wo.code,
              })));
            }

            // update WO aggregates
            const newReceived = wo.receivedQty + received;
            const newAccepted = wo.acceptedQty + accepted;
            const woStatus =
              newReceived >= wo.issuedQty ? "AWAITING_QC"
              : newReceived > 0 ? "PARTIALLY_COLLECTED" : wo.status;
            await tx.workOrder.update({
              where: { id: wo.id },
              data: {
                receivedQty: newReceived, acceptedQty: newAccepted,
                rejectedQty: { increment: rejected }, damagedQty: { increment: damaged }, missingQty: { increment: missing },
                actualServiceCost: { increment: D(serviceCharge) },
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
              userName: user.name, batchId: wo.batchId, refNo: code, amount: serviceCharge,
            });
            return { receipt: code, duplicate: false };
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "complete": {
        const wo = await db.workOrder.update({ where: { id: String(body.id) }, data: { status: "COMPLETED" } });
        await db.$transaction((tx) => logActivity(tx, { module: "PRODUCTION", action: "wo_completed", description: `Work order ${wo.code} completed`, userName: user.name, batchId: wo.batchId, refNo: wo.code }));
        return ok(ser(wo));
      }
      case "cancel": {
        const wo = await db.workOrder.update({ where: { id: String(body.id) }, data: { status: "CANCELLED" } });
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
