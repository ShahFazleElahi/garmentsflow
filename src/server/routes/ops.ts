import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, q } from "./helpers";
import { NextRequest } from "next/server";
import { D, N, nextDocNo, logAudit, logActivity, postJournal, ACC } from "../core";
import { postFinishedMovement } from "../inventory";
import { addCostEntries } from "../costing";
import { Prisma } from "@prisma/client";

// ───────────────────────── GET ─────────────────────────
export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, "view");
  if ("error" in auth) return auth.error;

  if (resource === "inspections") {
    const rows = await db.qualityInspection.findMany({
      include: { batch: { include: { plan: true } }, workOrder: { include: { partner: true } }, reworkOrders: true },
      orderBy: { inspectionDate: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "rework") {
    const rows = await db.reworkOrder.findMany({ include: { inspection: true }, orderBy: { createdAt: "desc" } });
    return ok(ser(rows));
  }
  if (resource === "finished-stocks") {
    const rows = await db.finishedStock.findMany({
      include: { variant: { include: { plan: true } }, warehouse: { include: { location: true } } },
    });
    return ok(ser(rows));
  }
  if (resource === "finished-movements") {
    const take = 300;
    const rows = await db.finishedMovement.findMany({
      include: { variant: true, to: { include: { location: true } }, from: { include: { location: true } } },
      orderBy: { movementDate: "desc" }, take,
    });
    return ok(ser(rows));
  }
  if (resource === "packages" && !id) {
    const rows = await db.package.findMany({
      include: { items: { include: { variant: { include: { plan: true } } } } },
      orderBy: { packingDate: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "packages" && id) {
    const row = await db.package.findUnique({
      where: { id },
      include: { items: { include: { variant: { include: { plan: true } } } } },
    });
    if (!row) return bad("Package not found", 404);
    return ok(ser(row));
  }
  if (resource === "shipments" && !id) {
    const rows = await db.shipment.findMany({
      include: {
        originWarehouse: true, destWarehouse: true,
        packages: { include: { package: { include: { items: { include: { variant: true } } } } } },
        receipts: true, discrepancies: { include: { variant: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "shipments" && id) {
    const row = await db.shipment.findUnique({
      where: { id },
      include: {
        packages: { include: { package: { include: { items: { include: { variant: true } } } } } },
        receipts: true, discrepancies: { include: { variant: true } }, landedCosts: { include: { variant: true } },
      },
    });
    if (!row) return bad("Shipment not found", 404);
    return ok(ser(row));
  }
  if (resource === "transport") {
    const rows = await db.transportationExpense.findMany({ orderBy: { date: "desc" } });
    return ok(ser(rows));
  }
  return bad(`Unknown ops resource: ${resource}`, 404);
}

// ───────────────────────── POST ─────────────────────────
export async function handlePost(segments: string[], body: Record<string, unknown>, req: NextRequest) {
  const [resource, action] = segments;
  const auth = await requirePerm(req, "post");
  if ("error" in auth) return auth.error;
  const { user } = auth;

  // ── Quality inspections ──
  if (resource === "inspections") {
    if (action === "create") {
      try {
        const result = await db.$transaction(async (tx) => {
          const code = await nextDocNo(tx, "INS");
          const workOrderId = (body.workOrderId as string) || null;
          const wo = workOrderId ? await tx.workOrder.findUnique({ where: { id: workOrderId }, include: { batch: { include: { variants: { include: { variant: true } } } }, plan: true, partner: true } }) : null;
          const batchId = (body.batchId as string) || wo?.batchId || null;
          const inspected = Number(body.inspectedQty ?? 0);
          const passed = Number(body.passedQty ?? 0);
          const rework = Number(body.reworkQty ?? 0);
          const rejected = Number(body.rejectedQty ?? 0);
          const damaged = Number(body.damagedQty ?? 0);
          if (passed + rework + rejected + damaged !== inspected) {
            throw new Error("Passed + rework + rejected + damaged must equal inspected quantity");
          }
          const status = String(body.status ?? (passed === inspected ? "PASSED" : rework > 0 ? "REWORK_REQUIRED" : "PASSED_MINOR"));
          const inspection = await tx.qualityInspection.create({
            data: {
              code, inspectionDate: body.inspectionDate ? new Date(String(body.inspectionDate)) : new Date(),
              inspectorName: (body.inspectorName as string) || user.name,
              type: String(body.type ?? "FINAL_PRODUCTION"),
              batchId, workOrderId, planId: wo?.planId ?? ((body.planId as string) || null),
              inspectedQty: inspected, passedQty: passed, reworkQty: rework,
              rejectedQty: rejected, damagedQty: damaged,
              defectsJson: JSON.stringify(body.defects ?? []),
              severity: body.severity as string | undefined, status,
              correctiveAction: body.correctiveAction as string | undefined,
              notes: body.notes as string | undefined, createdById: user.id,
            },
          });
          // rework order
          if (rework > 0) {
            const rwoCode = await nextDocNo(tx, "RWO");
            await tx.reworkOrder.create({
              data: {
                code: rwoCode, inspectionId: inspection.id, qty: rework,
                partnerId: ((body.reworkVendorId as string) || wo?.partnerId) || null,
                status: "OPEN", notes: body.reworkNotes as string | undefined,
              },
            });
            if (wo) await tx.workOrder.update({ where: { id: wo.id }, data: { status: "REWORK_REQUIRED" } });
          }
          // passed qty → finished goods (PRODUCTION_IN at Dhaka main warehouse)
          if (passed > 0 && wo) {
            const mainWh = await tx.warehouse.findFirst({ where: { type: "MAIN", location: { name: "Dhaka" } } });
            if (mainWh) {
              const totalBatchQty = wo.batch.variants.reduce((a, bv) => a + bv.plannedQty, 0) || 1;
              const weights = wo.batch.variants.map((bv) => bv.plannedQty);
              const allocs = allocInt(passed, weights);
              for (let i = 0; i < wo.batch.variants.length; i++) {
                const bv = wo.batch.variants[i];
                if (allocs[i] <= 0) continue;
                const cost = await tx.variantCost.findUnique({ where: { variantId: bv.variantId } });
                const unitCost = cost ? N(cost.mfgCost) / Math.max(bv.plannedQty, 1) : 0;
                await postFinishedMovement(tx, {
                  variantId: bv.variantId, toWarehouseId: mainWh.id, qty: allocs[i],
                  unitCost: Math.round(unitCost * 100) / 100, type: "PRODUCTION_IN",
                  refType: "QUALITY_INSPECTION", refId: inspection.id, refNo: code,
                  userId: user.id, userName: user.name, note: `Passed QC inspection ${code}`,
                });
                // credit batch variant progress (capped at planned)
                const fresh = await tx.batchVariant.findUniqueOrThrow({ where: { batchId_variantId: { batchId: bv.batchId, variantId: bv.variantId } } });
                const credit = Math.min(allocs[i], Math.max(bv.plannedQty - fresh.completedQty, 0));
                if (credit > 0) {
                  await tx.batchVariant.update({ where: { batchId_variantId: { batchId: bv.batchId, variantId: bv.variantId } }, data: { completedQty: { increment: credit } } });
                  await tx.productVariant.update({ where: { id: bv.variantId }, data: { producedQty: { increment: credit } } });
                }
              }
            }
            await tx.workOrder.update({ where: { id: wo.id }, data: { status: rework > 0 ? "REWORK_REQUIRED" : "COMPLETED" } });
          }
          await logActivity(tx, {
            module: "QUALITY", action: "inspection_recorded",
            description: `Inspection ${code}: ${inspected} inspected, ${passed} passed, ${rework} rework, ${rejected} rejected, ${damaged} damaged`,
            userName: user.name, batchId: batchId ?? undefined, refNo: code,
          });
          return inspection;
        });
        return ok(ser(result));
      } catch (e) {
        return bad((e as Error).message);
      }
    }
    if (action === "rework-status") {
      const rwo = await db.reworkOrder.update({ where: { id: String(body.id) }, data: { status: String(body.status), completedAt: body.status === "DONE" ? new Date() : undefined } });
      return ok(ser(rwo));
    }
  }

  // ── Finished goods ──
  if (resource === "finished") {
    if (action === "transfer") {
      try {
        const result = await db.$transaction(async (tx) => {
          const items = (body.items ?? []) as { variantId: string; qty: number }[];
          const from = String(body.fromWarehouseId), to = String(body.toWarehouseId);
          for (const i of items) {
            await postFinishedMovement(tx, {
              variantId: i.variantId, fromWarehouseId: from, toWarehouseId: to, qty: i.qty,
              type: "ADJUST", refType: "TRANSFER", userId: user.id, userName: user.name, note: "Stock transfer",
            });
          }
          return { transferred: items.length };
        });
        return ok(result);
      } catch (e) {
        return bad((e as Error).message);
      }
    }
    if (action === "writeoff") {
      try {
        const result = await db.$transaction(async (tx) => {
          const { variantId, warehouseId, qty, reason } = body as { variantId: string; warehouseId: string; qty: number; reason: string };
          const stock = await tx.finishedStock.findUnique({ where: { variantId_warehouseId: { variantId, warehouseId } } });
          if (!stock) throw new Error("Stock not found");
          const value = D(qty).mul(D(stock.unitCost));
          await postFinishedMovement(tx, {
            variantId, fromWarehouseId: warehouseId, qty, type: "WRITE_OFF",
            refType: "WRITE_OFF", userId: user.id, userName: user.name, note: reason,
          });
          await postJournal(tx, {
            memo: `Finished goods write-off: ${reason}`, refType: "WRITE_OFF", userId: user.id,
            lines: [
              { accountCode: ACC.ABNORMAL, debit: value },
              { accountCode: ACC.FG_INV, credit: value },
            ],
          });
          await logAudit(tx, { userId: user.id, userName: user.name, action: "POST", entity: "WriteOff", newJson: { variantId, qty, reason } });
          return { done: true };
        });
        return ok(result);
      } catch (e) {
        return bad((e as Error).message);
      }
    }
  }

  // ── Packaging ──
  if (resource === "packages") {
    switch (action) {
      case "create": {
        try {
          const result = await db.$transaction(async (tx) => {
            const code = await nextDocNo(tx, "PKG");
            const items = (body.items ?? []) as { variantId: string; qty: number; batchId?: string }[];
            if (!items.length) throw new Error("No products selected for packing");
            const sourceWarehouseId = String(body.sourceWarehouseId);
            // validate availability & prevent double allocation
            for (const i of items) {
              const stock = await tx.finishedStock.findUnique({ where: { variantId_warehouseId: { variantId: i.variantId, warehouseId: sourceWarehouseId } } });
              if (!stock || stock.qty - stock.reservedQty < i.qty) {
                throw new Error(`Insufficient unreserved stock for variant ${i.variantId}`);
              }
            }
            const barcode = `PK${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
            const pkg = await tx.package.create({
              data: {
                code, boxNo: String(body.boxNo ?? code), barcode,
                qrPayload: JSON.stringify({ t: "package", code }),
                sourceWarehouseId, destLocationId: (body.destLocationId as string) || null,
                netWeight: D(Number(body.netWeight ?? 0)), grossWeight: D(Number(body.grossWeight ?? 0)),
                lengthCm: D(Number(body.lengthCm ?? 0)), widthCm: D(Number(body.widthCm ?? 0)), heightCm: D(Number(body.heightCm ?? 0)),
                packagingCost: D(Number(body.packagingCost ?? 0)), packedByName: (body.packedByName as string) || user.name,
                notes: body.notes as string | undefined,
              },
            });
            for (const i of items) {
              await tx.packageItem.create({
                data: { packageId: pkg.id, variantId: i.variantId, qty: i.qty, batchId: i.batchId ?? null },
              });
              await postFinishedMovement(tx, {
                variantId: i.variantId, fromWarehouseId: sourceWarehouseId, qty: i.qty, type: "PACK",
                refType: "PACKAGE", refId: pkg.id, refNo: code, userId: user.id, userName: user.name,
                note: "Packed into box",
              });
              await tx.finishedStock.update({
                where: { variantId_warehouseId: { variantId: i.variantId, warehouseId: sourceWarehouseId } },
                data: { packedQty: { increment: i.qty } },
              });
            }
            if (Number(body.packagingCost ?? 0) > 0) {
              const totalQty = items.reduce((a, i) => a + i.qty, 0);
              const variants = [...new Set(items.map((i) => i.variantId))];
              await addCostEntries(tx, variants.map((vid) => ({
                variantId: vid, category: "PACKAGING",
                amount: (Number(body.packagingCost) * (items.find((i) => i.variantId === vid)?.qty ?? 0)) / Math.max(totalQty, 1),
                refType: "PACKAGE", refId: pkg.id, refNo: code,
              })));
              await postJournal(tx, {
                memo: `Packaging cost ${code}`, refType: "PACKAGE", refId: pkg.id, refNo: code, userId: user.id,
                lines: [
                  { accountCode: ACC.PACKAGING, debit: Number(body.packagingCost) },
                  { accountCode: "1010", credit: Number(body.packagingCost) },
                ],
              });
            }
            await logActivity(tx, { module: "PACKAGING", action: "package_created", description: `Package ${code} — ${items.reduce((a, i) => a + i.qty, 0)} pc packed`, userName: user.name, refNo: code });
            return pkg;
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "unpack": {
        try {
          const result = await db.$transaction(async (tx) => {
            const pkg = await tx.package.findUnique({ where: { id: String(body.id) }, include: { items: true } });
            if (!pkg) throw new Error("Package not found");
            if (!["PACKED", "DISPATCHED", "IN_TRANSIT"].includes(pkg.status)) throw new Error("Package cannot be unpacked in current status");
            for (const item of pkg.items) {
              await postFinishedMovement(tx, {
                variantId: item.variantId, toWarehouseId: pkg.sourceWarehouseId, qty: item.qty, type: "UNPACK",
                refType: "PACKAGE", refId: pkg.id, refNo: pkg.code, userId: user.id, userName: user.name,
              });
              await tx.finishedStock.update({
                where: { variantId_warehouseId: { variantId: item.variantId, warehouseId: pkg.sourceWarehouseId } },
                data: { packedQty: { decrement: item.qty } },
              });
            }
            await tx.package.update({ where: { id: pkg.id }, data: { status: "CANCELLED" } });
            await logActivity(tx, { module: "PACKAGING", action: "package_unpacked", description: `Package ${pkg.code} unpacked — items returned to available stock`, userName: user.name, refNo: pkg.code });
            return { unpacked: true };
          });
          return ok(result);
        } catch (e) {
          return bad((e as Error).message);
        }
      }
    }
  }

  // ── Shipments ──
  if (resource === "shipments") {
    switch (action) {
      case "create": {
        try {
          const result = await db.$transaction(async (tx) => {
            const code = await nextDocNo(tx, "SHP");
            const packageIds = (body.packageIds ?? []) as string[];
            if (!packageIds.length) throw new Error("Select at least one package");
            const charges = {
              freight: Number(body.freightCharge ?? 0), insurance: Number(body.insuranceCharge ?? 0),
              customs: Number(body.customsCharge ?? 0), duties: Number(body.importDuties ?? 0),
              taxes: Number(body.taxesCharge ?? 0), docs: Number(body.docCharge ?? 0),
              handling: Number(body.handlingCharge ?? 0), lastMile: Number(body.lastMileCharge ?? 0),
              other: Number(body.otherCharge ?? 0),
            };
            const currency = String(body.currency ?? "BDT");
            const fx = Number(body.exchangeRate ?? 1);
            const totalOrig = Object.values(charges).reduce((a, b) => a + b, 0);
            const totalBdt = currency === "BDT" ? totalOrig : totalOrig * fx;
            const shipment = await tx.shipment.create({
              data: {
                code, type: String(body.type ?? "LOCAL"), status: "DRAFT",
                originLocationId: (body.originLocationId as string) || null,
                originWarehouseId: (body.originWarehouseId as string) || null,
                destLocationId: (body.destLocationId as string) || null,
                destWarehouseId: (body.destWarehouseId as string) || null,
                expectedArrival: body.expectedArrival ? new Date(String(body.expectedArrival)) : undefined,
                transportCompanyId: (body.transportCompanyId as string) || null,
                courierCompanyId: (body.courierCompanyId as string) || null,
                freightForwarderId: (body.freightForwarderId as string) || null,
                transportMethod: body.transportMethod as string | undefined,
                trackingId: body.trackingId as string | undefined,
                awbNo: body.awbNo as string | undefined, blRef: body.blRef as string | undefined,
                customsRef: body.customsRef as string | undefined, hsCode: body.hsCode as string | undefined,
                countryOfOrigin: body.countryOfOrigin as string | undefined,
                incoterms: body.incoterms as string | undefined,
                vehicleType: body.vehicleType as string | undefined, vehicleReg: body.vehicleReg as string | undefined,
                driverName: body.driverName as string | undefined, driverPhone: body.driverPhone as string | undefined,
                senderInfo: body.senderInfo as string | undefined, receiverInfo: body.receiverInfo as string | undefined,
                pickupAddress: body.pickupAddress as string | undefined, deliveryAddress: body.deliveryAddress as string | undefined,
                freightCharge: D(charges.freight), insuranceCharge: D(charges.insurance),
                customsCharge: D(charges.customs), importDuties: D(charges.duties), taxesCharge: D(charges.taxes),
                docCharge: D(charges.docs), handlingCharge: D(charges.handling), lastMileCharge: D(charges.lastMile),
                otherCharge: D(charges.other), totalCost: D(totalOrig), currency, exchangeRate: D(fx),
                totalCostBdt: D(Math.round(totalBdt * 100) / 100),
                customsStatus: body.customsStatus as string | undefined,
                notes: body.notes as string | undefined, createdById: user.id,
              },
              include: { packages: true },
            });
            await tx.shipmentPackage.createMany({
              data: packageIds.map((pid) => ({ shipmentId: shipment.id, packageId: pid })),
            });
            await tx.package.updateMany({ where: { id: { in: packageIds } }, data: { status: "DISPATCHED", shipmentId: shipment.id } });
            await logActivity(tx, { module: "LOGISTICS", action: "shipment_created", description: `${shipment.type === "LOCAL" ? "Local" : "International"} shipment ${code} — ${packageIds.length} box(es), cost ৳${Math.round(totalBdt).toLocaleString()}`, userName: user.name, refNo: code, amount: totalBdt });
            return shipment;
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "dispatch": {
        try {
          const result = await db.$transaction(async (tx) => {
            const shipment = await tx.shipment.findUnique({ where: { id: String(body.id) }, include: { packages: { include: { package: { include: { items: true } } } } } });
            if (!shipment) throw new Error("Shipment not found");
            if (shipment.status !== "DRAFT") throw new Error("Shipment already dispatched");
            await tx.shipment.update({
              where: { id: shipment.id },
              data: { status: "DISPATCHED", dispatchDate: new Date() },
            });
            await tx.package.updateMany({ where: { id: { in: shipment.packages.map((sp) => sp.packageId) } }, data: { status: "IN_TRANSIT" } });
            await logActivity(tx, { module: "LOGISTICS", action: "shipment_dispatched", description: `Shipment ${shipment.code} dispatched — ${shipment.packages.length} box(es) now in transit`, userName: user.name, refNo: shipment.code });
            return { dispatched: true };
          });
          return ok(result);
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "receive": {
        try {
          const result = await db.$transaction(async (tx) => {
            const idem = body.idempotencyKey as string | undefined;
            if (idem) {
              const dupe = await tx.shipmentReceipt.findFirst({ where: { shipmentId: String(body.id), code: idem } });
              if (dupe) return { duplicate: true };
            }
            const shipment = await tx.shipment.findUnique({
              where: { id: String(body.id) },
              include: { packages: { include: { package: { include: { items: true } } } }, originWarehouse: true, destWarehouse: true },
            });
            if (!shipment) throw new Error("Shipment not found");
            if (!["DISPATCHED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(shipment.status)) throw new Error("Shipment is not in transit");
            const destWarehouseId = String(body.warehouseId ?? shipment.destWarehouseId);
            if (!destWarehouseId) throw new Error("Destination warehouse required");
            const items = (body.items ?? []) as { variantId: string; received: number; damaged: number; missing: number }[];
            const code = await nextDocNo(tx, "SHR");

            // expected quantities from packages
            const expected = new Map<string, number>();
            for (const sp of shipment.packages) for (const it of sp.package.items) {
              expected.set(it.variantId, (expected.get(it.variantId) ?? 0) + it.qty);
            }
            // outbound leg: remove from origin (packed stock already decremented at pack time; in-transit tracked on origin packedQty)
            // Actually: pack moved qty out of origin available stock. Receiving adds to destination.
            const receipt = await tx.shipmentReceipt.create({
              data: {
                code, shipmentId: shipment.id, receiptDate: new Date(), warehouseId: destWarehouseId,
                receivedByName: (body.receivedByName as string) || user.name,
                boxesExpected: shipment.packages.length, boxesReceived: Number(body.boxesReceived ?? shipment.packages.length),
                itemsJson: JSON.stringify(items),
                receivingCost: D(Number(body.receivingCost ?? 0)), notes: body.notes as string | undefined,
                idempotencyKey: idem,
              },
            });

            let damagedTotal = 0, missingTotal = 0;
            const quarantineWh = await tx.warehouse.findFirst({ where: { type: "QUARANTINE", location: { id: { not: "" } } } });
            for (const it of items) {
              const expQty = expected.get(it.variantId) ?? 0;
              if (it.received > expQty) throw new Error(`Over-receiving prevented for variant: received ${it.received} > expected ${expQty}`);
              if (it.received > 0) {
                const cost = await tx.variantCost.findUnique({ where: { variantId: it.variantId } });
                await postFinishedMovement(tx, {
                  variantId: it.variantId, toWarehouseId: destWarehouseId, qty: it.received,
                  unitCost: cost ? N(cost.landedCostBdt) / Math.max((await tx.productVariant.findUniqueOrThrow({ where: { id: it.variantId } })).plannedQty, 1) : 0,
                  type: "RECEIVE_IN", refType: "SHIPMENT_RECEIPT", refId: receipt.id, refNo: code,
                  userId: user.id, userName: user.name, note: `Received via ${shipment.code}`,
                });
              }
              if (it.damaged > 0 && quarantineWh) {
                const cost = await tx.variantCost.findUnique({ where: { variantId: it.variantId } });
                const v = await tx.productVariant.findUniqueOrThrow({ where: { id: it.variantId } });
                await postFinishedMovement(tx, {
                  variantId: it.variantId, toWarehouseId: quarantineWh.id, qty: it.damaged,
                  unitCost: cost ? N(cost.landedCostBdt) / Math.max(v.plannedQty, 1) : 0, type: "RECEIVE_IN",
                  refType: "SHIPMENT_RECEIPT", refId: receipt.id, refNo: code,
                  userId: user.id, userName: user.name, note: `Damaged in shipment ${shipment.code} — quarantined`,
                });
              }
              damagedTotal += it.damaged; missingTotal += it.missing;
              // release origin reserved (packed) qty for all received+damaged+missing (they left origin already)
            }
            // release origin packed reservations
            for (const sp of shipment.packages) {
              for (const pit of sp.package.items) {
                await tx.finishedStock.updateMany({
                  where: { variantId: pit.variantId, warehouseId: sp.package.sourceWarehouseId },
                  data: { packedQty: { decrement: pit.qty } },
                }).catch(() => null);
              }
              await tx.package.update({ where: { id: sp.packageId }, data: { status: "RECEIVED" } });
            }

            // auto discrepancy records
            for (const it of items) {
              const expQty = expected.get(it.variantId) ?? 0;
              if (it.damaged > 0 || it.missing > 0) {
                await tx.shipmentDiscrepancy.create({
                  data: {
                    shipmentId: shipment.id, variantId: it.variantId, expectedQty: expQty,
                    receivedQty: it.received, damagedQty: it.damaged, missingQty: it.missing, status: "OPEN",
                  },
                });
              }
            }

            // landed cost allocation for INTERNATIONAL: allocate total BDT cost across received variants by qty
            if (shipment.type === "INTERNATIONAL" && Number(shipment.totalCostBdt) > 0) {
              const receivedQty = items.reduce((a, i) => a + i.received, 0);
              if (receivedQty > 0) {
                const perUnit = Number(shipment.totalCostBdt) / receivedQty;
                const rows = items.filter((i) => i.received > 0).map((i) => ({
                  shipmentId: shipment.id, variantId: i.variantId, warehouseId: destWarehouseId,
                  amount: D(Math.round(perUnit * i.received * 100) / 100),
                }));
                await tx.landedCostEntry.createMany({ data: rows });
                await addCostEntries(tx, rows.map((r) => ({
                  variantId: r.variantId, category: "INTL_FREIGHT", amount: r.amount,
                  refType: "SHIPMENT", refId: shipment.id, refNo: shipment.code, note: "International landed cost",
                })));
                await postJournal(tx, {
                  memo: `Landed cost ${shipment.code}`, refType: "SHIPMENT", refId: shipment.id, refNo: shipment.code, userId: user.id,
                  lines: [
                    { accountCode: ACC.FG_INV, debit: Number(shipment.totalCostBdt) },
                    { accountCode: ACC.LANDED, credit: Number(shipment.totalCostBdt) },
                  ],
                });
              }
            }

            const allReceived = items.reduce((a, i) => a + i.received, 0) >= [...expected.values()].reduce((a, b) => a + b, 0);
            await tx.shipment.update({
              where: { id: shipment.id },
              data: {
                status: allReceived ? "RECEIVED_VERIFIED" : "PARTIALLY_RECEIVED",
                actualArrival: new Date(),
              },
            });
            await logActivity(tx, {
              module: "LOGISTICS", action: "shipment_received",
              description: `Shipment ${shipment.code} received at destination: ${items.reduce((a, i) => a + i.received, 0)} pc accepted, ${damagedTotal} damaged, ${missingTotal} missing${damagedTotal + missingTotal > 0 ? " — discrepancy record(s) created" : ""}`,
              userName: user.name, refNo: code,
            });
            return { receipt: code, discrepancies: damagedTotal + missingTotal > 0, duplicate: false };
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "resolve-discrepancy": {
        const disc = await db.shipmentDiscrepancy.update({
          where: { id: String(body.id) },
          data: { status: String(body.status ?? "RESOLVED"), resolution: body.resolution as string | undefined, resolvedAt: new Date() },
        });
        await db.$transaction((tx) => logActivity(tx, { module: "LOGISTICS", action: "discrepancy_resolved", description: `Shipment discrepancy ${disc.id.slice(-6)} resolved: ${body.resolution ?? ""}`, userName: user.name, refNo: disc.shipmentId }));
        return ok(ser(disc));
      }
      case "status": {
        const shipment = await db.shipment.update({ where: { id: String(body.id) }, data: { status: String(body.status) } });
        return ok(ser(shipment));
      }
    }
  }

  // ── Transportation ledger ──
  if (resource === "transport" && action === "create") {
    try {
      const result = await db.$transaction(async (tx) => {
        const code = await nextDocNo(tx, "TRN");
        const amount = Number(body.amount ?? 0);
        const trn = await tx.transportationExpense.create({
          data: {
            code, origin: body.origin as string | undefined, destination: body.destination as string | undefined,
            purpose: body.purpose as string | undefined, partnerId: (body.partnerId as string) || null,
            vehicleType: body.vehicleType as string | undefined, vehicleInfo: body.vehicleInfo as string | undefined,
            driverInfo: body.driverInfo as string | undefined, planId: (body.planId as string) || null,
            batchId: (body.batchId as string) || null, poId: (body.poId as string) || null,
            workOrderId: (body.workOrderId as string) || null, shipmentId: (body.shipmentId as string) || null,
            amount: D(amount), paymentStatus: String(body.paymentStatus ?? "PAID"),
            paymentMethod: body.paymentMethod as string | undefined, notes: body.notes as string | undefined,
            createdById: user.id,
          },
        });
        await postJournal(tx, {
          memo: `Transportation ${code}: ${body.origin ?? ""} → ${body.destination ?? ""}`,
          refType: "TRANSPORT", refId: trn.id, refNo: code, userId: user.id,
          lines: [
            { accountCode: ACC.FREIGHT, debit: amount },
            { accountCode: String(body.accountCode ?? "1010"), credit: amount },
          ],
        });
        // allocate to variants of the batch if batch-linked
        if (body.batchId) {
          const bvs = await tx.batchVariant.findMany({ where: { batchId: String(body.batchId) } });
          const totalQty = bvs.reduce((a, v) => a + v.plannedQty, 0) || 1;
          await addCostEntries(tx, bvs.map((v) => ({
            variantId: v.variantId, batchId: v.batchId, category: "TRANSPORT",
            amount: (amount * v.plannedQty) / totalQty, refType: "TRANSPORT", refId: trn.id, refNo: code,
          })));
        }
        await logActivity(tx, { module: "LOGISTICS", action: "transport_recorded", description: `Transportation ${code}: ৳${amount.toLocaleString()} (${body.origin ?? "?"} → ${body.destination ?? "?"})`, userName: user.name, refNo: code, amount });
        return trn;
      });
      return ok(ser(result));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  return bad(`Unknown ops action: ${resource}/${action ?? ""}`, 404);
}

function allocInt(total: number, weights: number[]): number[] {
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
