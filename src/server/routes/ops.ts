import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, q, canAccessWarehouses } from "./helpers";
import { NextRequest } from "next/server";
import { D, N, nextDocNo, logAudit, logActivity, postJournal, ACC, claimTransactionRequest } from "../core";
import { postFinishedMovement } from "../inventory";
import { addCostEntries } from "../costing";
import { Prisma } from "@prisma/client";
import { can, scopedLocations } from "../auth";

// ───────────────────────── GET ─────────────────────────
export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, "view");
  if ("error" in auth) return auth.error;
  const locationIds = scopedLocations(auth.user);
  const warehouse = locationIds ? { locationId: { in: locationIds } } : undefined;
  const shipmentScope = locationIds ? { OR: [{ originLocationId: { in: locationIds } }, { destLocationId: { in: locationIds } }] } : {};
  const financial = can(auth.user, "view_financial");
  const shipmentCosts = { freightCharge: !financial, insuranceCharge: !financial, customsCharge: !financial,
    importDuties: !financial, taxesCharge: !financial, docCharge: !financial, handlingCharge: !financial,
    lastMileCharge: !financial, otherCharge: !financial, totalCost: !financial, totalCostBdt: !financial,
    exchangeRate: !financial, paidAmount: !financial };
  const variantCosts = { estMaterialCost: !financial, estServiceCost: !financial, targetPrice: !financial };
  const planCosts = { estimatedBudget: !financial, targetMfgCost: !financial, targetLandedCost: !financial,
    targetRetailPrice: !financial, targetWholesalePrice: !financial };
  const packageItems = { omit: { unitCost: !financial }, include: { variant: { omit: variantCosts, include: { plan: { omit: planCosts } } } } };
  const packageContents = { omit: { packagingCost: !financial }, include: { items: packageItems } };

  if (resource === "inspections") {
    const rows = await db.qualityInspection.findMany({
      include: {
        batch: { select: { id: true, code: true, plan: { select: { id: true, name: true, code: true } } } },
        workOrder: { select: { id: true, code: true, partner: { select: { id: true, name: true } } } },
        reworkOrders: true,
      },
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
      where: { warehouse },
      omit: { unitCost: !financial },
      include: { variant: { omit: variantCosts, include: { plan: { omit: planCosts } } }, warehouse: { include: { location: true } } },
    });
    return ok(ser(rows));
  }
  if (resource === "finished-movements") {
    const take = 300;
    const rows = await db.finishedMovement.findMany({
      where: warehouse ? { OR: [{ from: warehouse }, { to: warehouse }] } : undefined,
      omit: { unitCost: !financial, value: !financial },
      include: { variant: { omit: variantCosts }, to: { include: { location: true } }, from: { include: { location: true } } },
      orderBy: { movementDate: "desc" }, take,
    });
    return ok(ser(rows));
  }
  const accessiblePackages = resource === "packages" && warehouse
    ? { sourceWarehouseId: { in: (await db.warehouse.findMany({ where: warehouse, select: { id: true } })).map(row => row.id) } }
    : {};
  if (resource === "packages" && id === "lookup") {
    const scanned = q(req, "code")?.trim() ?? "";
    if (!scanned || scanned.length > 200) return bad("A package barcode or QR value is required");
    let code = scanned;
    if (scanned.startsWith("{")) {
      try {
        const payload = JSON.parse(scanned) as { t?: unknown; code?: unknown };
        if (payload.t !== "package" || typeof payload.code !== "string" || !payload.code) return bad("Invalid package QR value");
        code = payload.code;
      } catch {
        return bad("Invalid package QR value");
      }
    }
    const row = await db.package.findFirst({
      where: { ...accessiblePackages, OR: [{ code }, { barcode: code }] },
      ...packageContents,
    });
    if (!row) return bad("Package not found", 404);
    return ok(ser(row));
  }
  if (resource === "packages" && !id) {
    const rows = await db.package.findMany({
      where: accessiblePackages,
      ...packageContents,
      orderBy: { packingDate: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "packages" && id) {
    const row = await db.package.findFirst({
      where: { id, ...accessiblePackages },
      ...packageContents,
    });
    if (!row) return bad("Package not found", 404);
    return ok(ser(row));
  }
  if (resource === "shipments" && !id) {
    const rows = await db.shipment.findMany({
      where: shipmentScope,
      omit: shipmentCosts,
      include: {
        originWarehouse: true, destWarehouse: true,
        packages: { include: { package: packageContents } },
        receipts: { omit: { receivingCost: !financial, idempotencyKey: true } }, discrepancies: { include: { variant: { omit: variantCosts } } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(ser(rows));
  }
  if (resource === "shipments" && id) {
    const row = await db.shipment.findFirst({
      where: { id, ...shipmentScope },
      omit: shipmentCosts,
      include: {
        packages: { include: { package: packageContents } },
        receipts: { omit: { receivingCost: !financial, idempotencyKey: true } },
        discrepancies: { include: { variant: { omit: variantCosts } } },
        landedCosts: financial ? { include: { variant: true } } : false,
      },
    });
    if (!row) return bad("Shipment not found", 404);
    return ok(ser(row));
  }
  if (resource === "transport") {
    if (!financial || locationIds) return bad("Company-wide transport expenses require financial access", 403);
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
  if ((resource === "finished" || resource === "packages" || resource === "shipments") && scopedLocations(user)) {
    let warehouseIds: string[] = [];
    if (resource === "finished") {
      warehouseIds = action === "transfer" ? [String(body.fromWarehouseId ?? ""), String(body.toWarehouseId ?? "")]
        : [String(body.warehouseId ?? "")];
    } else if (resource === "packages") {
      const existing = action === "create" ? null : await db.package.findUnique({
        where: { id: String(body.id ?? "") }, select: { sourceWarehouseId: true },
      });
      warehouseIds = [String(action === "create" ? body.sourceWarehouseId ?? "" : existing?.sourceWarehouseId ?? "")];
    } else if (action === "create") {
      warehouseIds = [String(body.originWarehouseId ?? ""), String(body.destWarehouseId ?? "")];
    } else {
      const shipmentId = action === "resolve-discrepancy"
        ? (await db.shipmentDiscrepancy.findUnique({ where: { id: String(body.id ?? "") }, select: { shipmentId: true } }))?.shipmentId
        : String(body.shipmentId ?? body.id ?? "");
      const shipment = shipmentId ? await db.shipment.findUnique({
        where: { id: shipmentId }, select: { originWarehouseId: true, destWarehouseId: true },
      }) : null;
      warehouseIds = [String((action === "receive" || action === "resolve-discrepancy" ? shipment?.destWarehouseId : shipment?.originWarehouseId) ?? "")];
    }
    if (!await canAccessWarehouses(user, warehouseIds)) return bad("Warehouse access denied", 403);
  }

  // ── Quality inspections ──
  if (resource === "inspections") {
    if (action === "create") {
      try {
        const result = await db.$transaction(async (tx) => {
          const code = await nextDocNo(tx, "INS");
          const workOrderId = (body.workOrderId as string) || null;
          const wo = workOrderId ? await tx.workOrder.findUnique({ where: { id: workOrderId }, include: { batch: { include: { variants: { include: { variant: true } } } }, plan: true, partner: true } }) : null;
          const batchId = (body.batchId as string) || wo?.batchId || null;

          const inspectionType = String(body.type ?? "FINAL_PRODUCTION");

          if (!["RAW_MATERIAL", "EMBROIDERY", "TAILORING", "FINAL_PRODUCTION", "PRE_DISPATCH", "DESTINATION_RECEIVING"].includes(inspectionType)) {
            throw new Error("Invalid inspection type");
          }

          if (workOrderId && !wo) {
            throw new Error("Work order not found");
          }

          if (wo && batchId !== wo.batchId) {
            throw new Error("Work order and batch mismatch");
          }

          if (wo && body.planId && body.planId !== wo.planId) {
            throw new Error("Work order and product plan mismatch");
          }

          const productionQC = ["EMBROIDERY", "TAILORING", "FINAL_PRODUCTION"].includes(inspectionType);

          if (productionQC && !wo) {
            throw new Error("Production QC requires a work order");
          }

          if (inspectionType === "EMBROIDERY" && wo?.type !== "EMBROIDERY") {
            throw new Error("Embroidery QC requires an embroidery work order");
          }

          if (inspectionType === "TAILORING" && wo?.type !== "TAILORING") {
            throw new Error("Tailoring QC requires a tailoring work order");
          }

          if (inspectionType === "FINAL_PRODUCTION" && wo?.type !== "TAILORING") {
            throw new Error("Final QC requires a tailoring work order");
          }

          if (productionQC && batchId) {
            await tx.$queryRaw`SELECT "id" FROM "ProductionBatch" WHERE "id" = ${batchId} FOR UPDATE`;
          }
          const inspected = Number(body.inspectedQty ?? 0);
          const passed = Number(body.passedQty ?? 0);
          const rework = Number(body.reworkQty ?? 0);
          const rejected = Number(body.rejectedQty ?? 0);
          const damaged = Number(body.damagedQty ?? 0);
          if (![inspected, passed, rework, rejected, damaged].every(v => Number.isSafeInteger(v) && v >= 0) || inspected <= 0) {
            throw new Error("Inspection quantities must be non-negative integers and inspected quantity must be positive");
          }

          const reworkOrderId = typeof body.reworkOrderId === "string" ? body.reworkOrderId : "";
          const priorRework = reworkOrderId ? await tx.reworkOrder.findUnique({
            where: { id: reworkOrderId },
            include: { inspection: true },
          }) : null;
          if (reworkOrderId && (!priorRework ||
              !["IN_PROGRESS", "DONE"].includes(priorRework.status) ||
              priorRework.inspection.status !== "REWORK_REQUIRED" ||
              priorRework.inspection.type !== inspectionType ||
              priorRework.inspection.workOrderId !== workOrderId ||
              priorRework.inspection.batchId !== batchId ||
              priorRework.qty !== inspected)) {
            throw new Error("Reinspection must match an unresolved rework order and its full quantity");
          }

          if (productionQC && wo) {
            const freshOrder = await tx.workOrder.findUniqueOrThrow({
              where: { id: wo.id },
            });

            if (!["AWAITING_QC", "REWORK_REQUIRED", "COMPLETED"].includes(freshOrder.status)) {
              throw new Error("Work order is not ready for quality inspection");
            }

            const previous = await tx.qualityInspection.aggregate({
              where: {
                workOrderId: wo.id,
                type: inspectionType,
              },
              _sum: { inspectedQty: true },
            });

            const resolved = await tx.reworkOrder.aggregate({
              where: { status: "DONE", inspection: { workOrderId: wo.id, type: inspectionType, status: "REWORK_RESOLVED" } },
              _sum: { qty: true },
            });
            const previouslyInspected = (previous._sum.inspectedQty ?? 0) - (resolved._sum.qty ?? 0);
            const originalQty = priorRework ? 0 : inspected;
            const remaining = freshOrder.acceptedQty - previouslyInspected;

            if (originalQty > remaining) {
              throw new Error("Inspection exceeds remaining accepted quantity");
            }

            if (inspectionType === "FINAL_PRODUCTION") {
              const stageQC = await tx.qualityInspection.aggregate({
                where: {
                  workOrderId: wo.id,
                  type: "TAILORING",
                },
                _sum: { passedQty: true },
              });

              if (previouslyInspected + originalQty > (stageQC._sum.passedQty ?? 0)) {
                throw new Error("Final QC exceeds tailoring QC passed quantity");
              }

              const embroideryOrders = await tx.workOrder.findMany({
                where: { batchId: wo.batchId, type: "EMBROIDERY" },
              });

              for (const order of embroideryOrders) {
                const embroideryQC = await tx.qualityInspection.aggregate({
                  where: {
                    workOrderId: order.id,
                    type: "EMBROIDERY",
                  },
                  _sum: { passedQty: true },
                });

                if ((embroideryQC._sum.passedQty ?? 0) < order.acceptedQty || order.status !== "COMPLETED") {
                  throw new Error("Embroidery QC must be completed before final QC");
                }
              }
            }
          }

          if (passed + rework + rejected + damaged !== inspected) {
            throw new Error("Passed + rework + rejected + damaged must equal inspected quantity");
          }
          const status = passed === inspected
            ? "PASSED"
            : rework > 0
              ? "REWORK_REQUIRED"
              : passed > 0
                ? "PASSED_MINOR"
                : "REJECTED";
          const inspection = await tx.qualityInspection.create({
            data: {
              code, inspectionDate: body.inspectionDate ? new Date(String(body.inspectionDate)) : new Date(),
              inspectorName: (body.inspectorName as string) || user.name,
              type: inspectionType,
              batchId, workOrderId, planId: wo?.planId ?? ((body.planId as string) || null),
              inspectedQty: inspected, passedQty: passed, reworkQty: rework,
              rejectedQty: rejected, damagedQty: damaged,
              defectsJson: JSON.stringify(body.defects ?? []),
              severity: body.severity as string | undefined, status,
              correctiveAction: body.correctiveAction as string | undefined,
              notes: body.notes as string | undefined, createdById: user.id,
            },
          });
          if (priorRework) {
            const resolved = await tx.qualityInspection.updateMany({
              where: { id: priorRework.inspectionId, status: "REWORK_REQUIRED" },
              data: { status: "REWORK_RESOLVED" },
            });
            if (resolved.count !== 1) throw new Error("Rework has already been reinspected");
            await tx.reworkOrder.update({
              where: { id: priorRework.id },
              data: { status: "DONE", completedAt: new Date() },
            });
            await logAudit(tx, {
              userId: user.id, userName: user.name, action: "UPDATE", entity: "ReworkOrder",
              entityId: priorRework.id, refNo: priorRework.code,
              prevJson: { status: priorRework.status, inspectionId: priorRework.inspectionId },
              newJson: { status: "DONE", reinspectionId: inspection.id },
            });
          }
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
          if (passed > 0 && wo && inspectionType === "FINAL_PRODUCTION") {
            const explicitWarehouseId = typeof body.warehouseId === "string" && body.warehouseId ? body.warehouseId : undefined;
            const originalIssue = explicitWarehouseId ? null : await tx.inventoryMovement.findFirst({
              where: { refType: "WORK_ORDER", refId: wo.id, type: "ISSUE_VENDOR" },
              orderBy: { id: "asc" }, select: { fromWarehouseId: true },
            });
            const warehouseId = explicitWarehouseId ?? originalIssue?.fromWarehouseId;
            const mainWh = await tx.warehouse.findFirst({
              where: { id: warehouseId ?? undefined, type: "MAIN", isActive: true,
                location: { isActive: true, ...(warehouseId ? {} : { name: "Dhaka" }) } },
              orderBy: { id: "asc" },
            });
            if (!mainWh) {
              throw new Error("Finished goods warehouse not found");
            }
            if (!await canAccessWarehouses(user, [mainWh.id])) throw new Error("Finished goods warehouse access denied");

            if (mainWh) {
              const variants = await tx.batchVariant.findMany({
                where: { batchId: wo.batchId },
                orderBy: { variantId: "asc" },
              });

              const weights = variants.map(
                bv => Math.max(bv.plannedQty - bv.completedQty, 0)
              );

              const available = weights.reduce((a, b) => a + b, 0);

              if (passed > available) {
                throw new Error("Finished goods quantity exceeds production batch capacity");
              }

              const allocs = allocInt(passed, weights);

              for (let i = 0; i < variants.length; i++) {
                const bv = variants[i];

                if (allocs[i] > weights[i]) {
                  throw new Error("Variant production capacity exceeded");
                }
                if (allocs[i] <= 0) continue;
                const manufacturingEntries = await tx.costEntry.findMany({
                  where: {
                    batchId: bv.batchId,
                    variantId: bv.variantId,
                    category: {
                      in: [
                        "MATERIAL", "EMBROIDERY", "TAILORING",
                        "CUTTING", "PRINTING", "WASHING",
                        "FINISHING", "REWORK", "VENDOR_TRANSPORT",
                      ],
                    },
                  },
                });

                if (!manufacturingEntries.length) {
                  throw new Error("Batch manufacturing cost entries are required");
                }

                const manufacturingValue = manufacturingEntries.reduce(
                  (sum, entry) => sum.add(D(entry.amount)),
                  D(0)
                );

                const unitCost = manufacturingValue.div(bv.plannedQty).toDecimalPlaces(4);
                await postFinishedMovement(tx, {
                  variantId: bv.variantId, toWarehouseId: mainWh.id, qty: allocs[i],
                  unitCost, type: "PRODUCTION_IN",
                  refType: "QUALITY_INSPECTION", refId: inspection.id, refNo: code,
                  userId: user.id, userName: user.name, note: `Passed QC inspection ${code}`,
                });
                // Finished stock and production progress must remain equal.
                const fresh = await tx.batchVariant.findUniqueOrThrow({ where: { batchId_variantId: { batchId: bv.batchId, variantId: bv.variantId } } });
                const credit = allocs[i];

                if (credit > fresh.plannedQty - fresh.completedQty) {
                  throw new Error("Duplicate or excess finished goods production prevented");
                }
                if (credit > 0) {
                  await tx.batchVariant.update({ where: { batchId_variantId: { batchId: bv.batchId, variantId: bv.variantId } }, data: { completedQty: { increment: credit } } });
                  await tx.productVariant.update({ where: { id: bv.variantId }, data: { producedQty: { increment: credit } } });
                }
              }
            }
            if (inspectionType === "FINAL_PRODUCTION" && passed > 0) {
              const productionMovements = await tx.finishedMovement.findMany({
                where: {
                  refType: "QUALITY_INSPECTION",
                  refId: inspection.id,
                  type: "PRODUCTION_IN",
                },
              });

              const productionValue = productionMovements.reduce(
                (sum, movement) => sum.add(D(movement.value)),
                D(0)
              ).toDecimalPlaces(2);

              if (productionValue.gt(0)) {
                await postJournal(tx, {
                  memo: `Finished goods capitalization ${code}`,
                  refType: "QUALITY_INSPECTION",
                  refId: inspection.id,
                  refNo: code,
                  userId: user.id,
                  lines: [
                    { accountCode: ACC.FG_INV, debit: productionValue },
                    { accountCode: ACC.WIP, credit: productionValue },
                  ],
                });
              }
            }

            const allocations = await tx.batchVariant.findMany({
              where: { batchId: wo.batchId },
            });

            const planned = allocations.reduce(
              (total, item) => total + item.plannedQty,
              0
            );

            const completed = allocations.reduce(
              (total, item) => total + item.completedQty,
              0
            );

            if (
              planned <= 0 ||
              allocations.some(item =>
                item.completedQty < 0 ||
                item.completedQty > item.plannedQty
              )
            ) {
              throw new Error("Invalid batch completion quantities");
            }

            const batchComplete = allocations.every(
              item => item.completedQty === item.plannedQty
            );

            const updatedBatch = await tx.productionBatch.update({
              where: { id: wo.batchId },
              data: {
                status: batchComplete
                  ? "COMPLETED"
                  : completed > 0 ? "PARTIAL" : "IN_PROGRESS",
              },
            });

            // Serialize plan-level completion reconciliation.
            await tx.$queryRaw`
              SELECT "id"
              FROM "ProductPlan"
              WHERE "id" = ${updatedBatch.planId}
              FOR UPDATE
            `;

            const currentPlan = await tx.productPlan.findUniqueOrThrow({
              where: { id: updatedBatch.planId },
              include: {
                variants: true,
                batches: true,
              },
            });

            if (
              !currentPlan.variants.length ||
              currentPlan.variants.some(variant =>
                variant.producedQty < 0 ||
                variant.producedQty > variant.plannedQty
              )
            ) {
              throw new Error("Invalid product plan completion quantities");
            }

            const producedQty = currentPlan.variants.reduce(
              (total, variant) => total + variant.producedQty,
              0
            );

            const targetQty = currentPlan.variants.reduce(
              (total, variant) => total + variant.plannedQty,
              0
            );

            const activeBatches = currentPlan.batches.filter(
              batch => batch.status !== "CANCELLED"
            );

            const allVariantsComplete =
              targetQty > 0 &&
              targetQty === currentPlan.plannedQty &&
              currentPlan.variants.every(
                variant => variant.producedQty === variant.plannedQty
              );

            const allBatchesComplete =
              activeBatches.length > 0 &&
              activeBatches.every(
                batch => batch.status === "COMPLETED"
              );

            const unresolvedRework = await tx.reworkOrder.count({
              where: {
                status: { in: ["OPEN", "IN_PROGRESS"] },
                inspection: { planId: currentPlan.id },
              },
            });

            const unresolvedReworkInspections =
              await tx.qualityInspection.count({
                where: {
                  planId: currentPlan.id,
                  status: "REWORK_REQUIRED",
                  reworkQty: { gt: 0 },
                },
              });

            const finalQc = await tx.qualityInspection.aggregate({
              where: {
                planId: currentPlan.id,
                type: "FINAL_PRODUCTION",
              },
              _sum: { passedQty: true },
            });

            const finalQcComplete =
              (finalQc._sum.passedQty ?? 0) === targetQty;

            const noUnresolvedRework =
              unresolvedRework === 0 &&
              unresolvedReworkInspections === 0;

            const nextStatus =
              allVariantsComplete &&
              allBatchesComplete &&
              finalQcComplete &&
              noUnresolvedRework
                ? "COMPLETED"
                : producedQty > 0
                  ? "PARTIALLY_COMPLETED"
                  : "IN_PRODUCTION";

            if (![
              "IN_PRODUCTION",
              "PARTIALLY_COMPLETED",
              "COMPLETED",
            ].includes(currentPlan.status)) {
              throw new Error(
                "Product plan requires status reconciliation before completion"
              );
            }

            if (currentPlan.status !== nextStatus) {
              await tx.productPlan.update({
                where: { id: currentPlan.id },
                data: { status: nextStatus },
              });

              await logActivity(tx, {
                module: "PLANNING",
                action: "production_status_synchronized",
                description: `${currentPlan.code}: ${currentPlan.status} to ${nextStatus}`,
                userName: user.name,
                planId: currentPlan.id,
                batchId: updatedBatch.id,
              });
            }
          }

          if (productionQC && wo) {
            const summary = await tx.qualityInspection.aggregate({
              where: {
                workOrderId: wo.id,
                type: inspectionType,
              },
              _sum: {
                passedQty: true,
              },
            });

            const order = await tx.workOrder.findUniqueOrThrow({
              where: { id: wo.id },
            });

            const allPassed = (summary._sum.passedQty ?? 0) >= order.acceptedQty;
            const unresolved = await tx.qualityInspection.count({
              where: { workOrderId: wo.id, status: "REWORK_REQUIRED" },
            });

            await tx.workOrder.update({
              where: { id: wo.id },
              data: {
                status: unresolved > 0
                  ? "REWORK_REQUIRED"
                  : allPassed ? "COMPLETED" : "AWAITING_QC",
              },
            });
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
      try {
        const result = await db.$transaction(async (tx) => {
          const status = String(body.status ?? "");
          if (status !== "IN_PROGRESS") throw new Error("Rework completion requires a reinspection");
          const rwo = await tx.reworkOrder.findUnique({
            where: { id: String(body.id) },
            include: { inspection: { include: { workOrder: true } } },
          });
          if (!rwo) throw new Error("Rework order not found");
          if (rwo.status === status) return rwo;
          const updated = await tx.reworkOrder.updateMany({
            where: { id: rwo.id, status: "OPEN" },
            data: { status },
          });
          if (updated.count !== 1) throw new Error("Only open rework can be started");

          await logAudit(tx, {
            userId: user.id,
            userName: user.name,
            action: "UPDATE",
            entity: "ReworkOrder",
            entityId: rwo.id,
            refNo: rwo.code,
            prevJson: { status: rwo.status },
            newJson: { status },
          });

          return tx.reworkOrder.findUniqueOrThrow({ where: { id: rwo.id } });
        });
        return ok(ser(result));
      } catch (e) {
        return bad((e as Error).message);
      }
    }
  }

  // ── Finished goods ──
  if (resource === "finished") {
    if (action === "transfer") {
      try {
        const result = await db.$transaction(async (tx) => {
          const items = (body.items ?? []) as { variantId: string; qty: number }[];
          const from = String(body.fromWarehouseId), to = String(body.toWarehouseId);
          if (from === to || !Array.isArray(items) || !items.length ||
              items.some(item => !item || typeof item.variantId !== "string" || !item.variantId || !Number.isSafeInteger(item.qty) || item.qty <= 0) ||
              new Set(items.map(item => item.variantId)).size !== items.length) throw new Error("Transfer requires distinct warehouses and products with positive whole quantities");
          const warehouses = await tx.warehouse.findMany({
            where: { id: { in: [from, to] }, type: "MAIN", isActive: true, location: { isActive: true } },
            include: { location: { select: { country: true } } },
          });
          if (warehouses.length !== 2 || warehouses[0].location.country !== warehouses[1].location.country) {
            throw new Error("Use the shipment workflow for cross-border movement");
          }
          const request = await claimTransactionRequest(tx, "FINISHED_TRANSFER", body, user.id);
          if (request?.resourceId) return { transferred: items.length, duplicate: true };
          const refId = request?.key ?? undefined;
          for (const i of items) {
            await postFinishedMovement(tx, {
              variantId: i.variantId, fromWarehouseId: from, toWarehouseId: to, qty: i.qty,
              type: "TRANSFER", refType: "TRANSFER", refId, userId: user.id, userName: user.name, note: "Stock transfer",
            });
          }
          if (request) await tx.salesRequest.update({ where: { key: request.key }, data: { resourceId: request.key } });
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
          if (typeof reason !== "string" || !reason.trim()) throw new Error("Write-off reason is required");
          const request = await claimTransactionRequest(tx, "FINISHED_WRITEOFF", body, user.id);
          if (request?.resourceId) return { done: true, duplicate: true };
          const movement = await postFinishedMovement(tx, {
            variantId, fromWarehouseId: warehouseId, qty, type: "WRITE_OFF",
            refType: "WRITE_OFF", userId: user.id, userName: user.name, note: reason,
          });
          const value = D(movement.value);
          await postJournal(tx, {
            memo: `Finished goods write-off: ${reason}`, refType: "WRITE_OFF", refId: movement.id, userId: user.id,
            lines: [
              { accountCode: ACC.ABNORMAL, debit: value },
              { accountCode: ACC.FG_INV, credit: value },
            ],
          });
          if (request) await tx.salesRequest.update({ where: { key: request.key }, data: { resourceId: movement.id } });
          await logAudit(tx, { userId: user.id, userName: user.name, action: "POST", entity: "WriteOff", entityId: movement.id, newJson: { variantId, qty, reason } });
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
            if (!Array.isArray(items) || !items.length) {
              throw new Error("No products selected for packing");
            }

            if (items.some(i => !i || typeof i.variantId !== "string" || !i.variantId || !Number.isSafeInteger(i.qty) || i.qty <= 0)) {
              throw new Error("Packing quantities must be positive integers");
            }

            if (new Set(items.map(i => i.variantId)).size !== items.length) {
              throw new Error("Duplicate variants in package are not allowed");
            }

            for (const field of ["netWeight", "grossWeight", "lengthCm", "widthCm", "heightCm", "packagingCost"]) {
              const value = Number(body[field] ?? 0);
              if (!Number.isFinite(value) || value < 0) {
                throw new Error("Invalid package measurement or cost: " + field);
              }
            }

            if (Number(body.grossWeight ?? 0) < Number(body.netWeight ?? 0)) {
              throw new Error("Gross weight cannot be less than net weight");
            }

            const sourceWarehouseId = String(body.sourceWarehouseId ?? "");

            const sourceWarehouse = await tx.warehouse.findUnique({
              where: { id: sourceWarehouseId },
            });

            if (!sourceWarehouse) {
              throw new Error("Source warehouse not found");
            }

            if (body.destLocationId) {
              const destination = await tx.location.findUnique({
                where: { id: String(body.destLocationId) },
              });

              if (!destination) {
                throw new Error("Destination location not found");
              }
            }

            const packingCosts = new Map<string, number>();
            // validate availability & prevent double allocation
            for (const i of items) {
              const stock = await tx.finishedStock.findUnique({ where: { variantId_warehouseId: { variantId: i.variantId, warehouseId: sourceWarehouseId } } });
              if (!stock || stock.qty - stock.reservedQty < i.qty) {
                throw new Error(`Insufficient unreserved stock for variant ${i.variantId}`);
              }

              if (stock.qualityStatus !== "PASSED") {
                throw new Error("Only QC-passed stock can be packed");
              }

              if (i.batchId) {
                const batchVariant = await tx.batchVariant.findUnique({
                  where: {
                    batchId_variantId: {
                      batchId: i.batchId,
                      variantId: i.variantId,
                    },
                  },
                });

                if (!batchVariant || batchVariant.completedQty < i.qty) {
                  throw new Error("Invalid batch and variant allocation");
                }
              }

              packingCosts.set(i.variantId, N(stock.unitCost));
            }
            const barcode = `PK-${code}`;
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
                data: {
                  packageId: pkg.id,
                  variantId: i.variantId,
                  qty: i.qty,
                  batchId: i.batchId ?? null,
                  unitCost: D(packingCosts.get(i.variantId) ?? 0),
                },
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
            const packageId = String(body.id);

            await tx.$queryRaw`SELECT "id" FROM "Package" WHERE "id" = ${packageId} FOR UPDATE`;

            const pkg = await tx.package.findUnique({
              where: { id: packageId },
              include: { items: true },
            });

            if (!pkg) throw new Error("Package not found");

            if (pkg.status !== "PACKED" || pkg.shipmentId) {
              throw new Error("Only unshipped packed packages can be unpacked");
            }

            if (N(pkg.packagingCost) > 0) {
              throw new Error("Paid packaging requires accounting review before cancellation");
            }
            for (const item of pkg.items) {
              const packedMovement = await tx.finishedMovement.findMany({
                where: {
                  variantId: item.variantId,
                  refType: "PACKAGE",
                  refId: pkg.id,
                  type: "PACK",
                },
              });

              if (packedMovement.length !== 1 || packedMovement[0].qty !== item.qty) {
                throw new Error("Package movement history requires reconciliation");
              }

              const changed = await tx.finishedStock.updateMany({
                where: {
                  variantId: item.variantId,
                  warehouseId: pkg.sourceWarehouseId,
                  packedQty: { gte: item.qty },
                },
                data: {
                  packedQty: { decrement: item.qty },
                },
              });

              if (changed.count !== 1) {
                throw new Error("Insufficient packed stock for unpacking");
              }

              await postFinishedMovement(tx, {
                variantId: item.variantId,
                toWarehouseId: pkg.sourceWarehouseId,
                qty: item.qty,
                unitCost: N(packedMovement[0].unitCost),
                type: "UNPACK",
                refType: "PACKAGE",
                refId: pkg.id,
                refNo: pkg.code,
                userId: user.id,
                userName: user.name,
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
            const request = await claimTransactionRequest(tx, "SHIPMENT_CREATE", body, user.id);
            if (request?.resourceId) return tx.shipment.findUniqueOrThrow({ where: { id: request.resourceId }, include: { packages: true } });
            const code = await nextDocNo(tx, "SHP");
            const packageIds = (body.packageIds ?? []) as string[];
            if (!Array.isArray(packageIds) || !packageIds.length) {
              throw new Error("Select at least one package");
            }

            if (packageIds.some(id => typeof id !== "string" || !id)) {
              throw new Error("Invalid package identifier");
            }

            if (new Set(packageIds).size !== packageIds.length) {
              throw new Error("Duplicate packages in shipment");
            }

            const shipmentType = String(body.type ?? "LOCAL");

            if (!["LOCAL", "INTERNATIONAL"].includes(shipmentType)) {
              throw new Error("Invalid shipment type");
            }

            const originId = String(body.originWarehouseId ?? "");
            const destinationId = String(body.destWarehouseId ?? "");

            if (!originId || !destinationId || originId === destinationId) {
              throw new Error("Different origin and destination warehouses are required");
            }

            const origin = await tx.warehouse.findUnique({
              where: { id: originId },
              include: { location: true },
            });

            const destination = await tx.warehouse.findUnique({
              where: { id: destinationId },
              include: { location: true },
            });

            if (!origin?.isActive || !destination?.isActive ||
                !origin.location.isActive || !destination.location.isActive) {
              throw new Error("Invalid or inactive shipment warehouse");
            }

            if (origin.type !== "MAIN" || destination.type !== "MAIN") {
              throw new Error("Shipment requires main warehouses");
            }

            if (body.originLocationId && body.originLocationId !== origin.locationId) {
              throw new Error("Origin warehouse and location mismatch");
            }

            if (body.destLocationId && body.destLocationId !== destination.locationId) {
              throw new Error("Destination warehouse and location mismatch");
            }

            if (shipmentType === "LOCAL" &&
                origin.location.country !== destination.location.country) {
              throw new Error("Local shipment must remain within the same country");
            }

            if (shipmentType === "INTERNATIONAL" &&
                origin.location.country === destination.location.country) {
              throw new Error("International shipment requires different countries");
            }

            for (const packageId of [...packageIds].sort()) {
              await tx.$queryRaw`SELECT "id" FROM "Package" WHERE "id" = ${packageId} FOR UPDATE`;
            }

            const availablePackages = await tx.package.findMany({
              where: { id: { in: packageIds } },
              include: { items: true },
            });

            if (availablePackages.length !== packageIds.length) {
              throw new Error("One or more packages do not exist");
            }

            const requiredStock = new Map<string, number>();

            for (const pkg of availablePackages) {
              if (pkg.status !== "PACKED" || pkg.shipmentId) {
                throw new Error("Package already assigned or unavailable");
              }

              if (pkg.sourceWarehouseId !== originId) {
                throw new Error("Package origin warehouse mismatch");
              }

              if (pkg.destLocationId && pkg.destLocationId !== destination.locationId) {
                throw new Error("Package destination mismatch");
              }

              if (!pkg.items.length) {
                throw new Error("Empty packages cannot be shipped");
              }

              for (const item of pkg.items) {
                if (!Number.isSafeInteger(item.qty) || item.qty <= 0) {
                  throw new Error("Invalid package item quantity");
                }

                requiredStock.set(
                  item.variantId,
                  (requiredStock.get(item.variantId) ?? 0) + item.qty
                );
              }
            }

            for (const [variantId, quantity] of requiredStock) {
              const stock = await tx.finishedStock.findUnique({
                where: {
                  variantId_warehouseId: {
                    variantId,
                    warehouseId: originId,
                  },
                },
              });

              if (!stock || stock.packedQty < quantity) {
                throw new Error("Insufficient packed stock for shipment");
              }
            }
            const charges = {
              freight: Number(body.freightCharge ?? 0), insurance: Number(body.insuranceCharge ?? 0),
              customs: Number(body.customsCharge ?? 0), duties: Number(body.importDuties ?? 0),
              taxes: Number(body.taxesCharge ?? 0), docs: Number(body.docCharge ?? 0),
              handling: Number(body.handlingCharge ?? 0), lastMile: Number(body.lastMileCharge ?? 0),
              other: Number(body.otherCharge ?? 0),
            };
            const currency = String(body.currency ?? "BDT");
            const fx = Number(body.exchangeRate ?? 1);
            if (Object.values(charges).some(v => !Number.isFinite(v) || v < 0 || !D(v).eq(D(v).toDecimalPlaces(2)))) {
              throw new Error("Shipment charges must be non-negative amounts with at most two decimal places");
            }

            if (!/^[A-Z]{3}$/.test(currency)) {
              throw new Error("Invalid currency code");
            }

            if (!Number.isFinite(fx) || fx <= 0) {
              throw new Error("Exchange rate must be positive");
            }

            if (currency === "BDT" && fx !== 1) {
              throw new Error("BDT exchange rate must equal 1");
            }

            if (shipmentType === "LOCAL" && currency !== "BDT") {
              throw new Error("Local shipment must use BDT");
            }

            const totalOrig = Object.values(charges).reduce((a, b) => a.add(b), D(0));
            const totalBdt = totalOrig.mul(fx).toDecimalPlaces(2);
            if (!Number.isSafeInteger(totalBdt.mul(100).toNumber())) {
              throw new Error("Shipment cost exceeds supported range");
            }
            const forwarderId = typeof body.freightForwarderId === "string" ? body.freightForwarderId : null;
            if (shipmentType === "INTERNATIONAL" && totalBdt.gt(0) && (!forwarderId || !await tx.businessPartner.count({
              where: { id: forwarderId, type: "FREIGHT_FORWARDER", isActive: true },
            }))) throw new Error("An active freight forwarder is required for shipment charges");
            const shipment = await tx.shipment.create({
              data: {
                code, type: shipmentType, status: "DRAFT",
                originLocationId: origin.locationId,
                originWarehouseId: originId,
                destLocationId: destination.locationId,
                destWarehouseId: destinationId,
                expectedArrival: body.expectedArrival ? new Date(String(body.expectedArrival)) : undefined,
                transportCompanyId: (body.transportCompanyId as string) || null,
                courierCompanyId: (body.courierCompanyId as string) || null,
                freightForwarderId: forwarderId,
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
                otherCharge: D(charges.other), totalCost: totalOrig, currency, exchangeRate: D(fx),
                totalCostBdt: totalBdt,
                customsStatus: body.customsStatus as string | undefined,
                notes: body.notes as string | undefined, createdById: user.id,
              },
              include: { packages: true },
            });
            await tx.shipmentPackage.createMany({
              data: packageIds.map((pid) => ({ shipmentId: shipment.id, packageId: pid })),
            });
            const assigned = await tx.package.updateMany({
              where: {
                id: { in: packageIds },
                status: "PACKED",
                shipmentId: null,
              },
              data: {
                shipmentId: shipment.id,
                destLocationId: destination.locationId,
              },
            });

            if (assigned.count !== packageIds.length) {
              throw new Error("Package assignment changed; retry transaction");
            }
            await logActivity(tx, { module: "LOGISTICS", action: "shipment_created", description: `${shipment.type === "LOCAL" ? "Local" : "International"} shipment ${code} — ${packageIds.length} box(es), cost ৳${totalBdt.toFixed(2)}`, userName: user.name, refNo: code, amount: totalBdt });
            if (request) await tx.salesRequest.update({ where: { key: request.key }, data: { resourceId: shipment.id } });
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
            const shipmentId = String(body.id);

            await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${shipmentId} FOR UPDATE`;

            const shipment = await tx.shipment.findUnique({
              where: { id: shipmentId },
              include: {
                packages: {
                  include: { package: { include: { items: true } } },
                },
              },
            });
            if (!shipment) throw new Error("Shipment not found");
            if (shipment.status !== "DRAFT") throw new Error("Shipment already dispatched");

            if (!shipment.packages.length) {
              throw new Error("Shipment has no assigned packages");
            }

            for (const sp of shipment.packages) {
              if (sp.package.status !== "PACKED" ||
                  sp.package.shipmentId !== shipment.id ||
                  sp.package.sourceWarehouseId !== shipment.originWarehouseId) {
                throw new Error("Invalid package state for dispatch");
              }
            }
            await tx.shipment.update({
              where: { id: shipment.id },
              data: { status: "DISPATCHED", dispatchDate: new Date() },
            });
            const dispatchedPackages = await tx.package.updateMany({
              where: {
                id: { in: shipment.packages.map(sp => sp.packageId) },
                shipmentId: shipment.id,
                status: "PACKED",
              },
              data: { status: "IN_TRANSIT" },
            });

            if (dispatchedPackages.count !== shipment.packages.length) {
              throw new Error("Package status changed during dispatch");
            }
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
            const shipmentId = String(body.id);
            const idem = body.idempotencyKey as string | undefined;
            const request = await claimTransactionRequest(tx, "SHIPMENT_RECEIVE", body, user.id);
            if (request?.resourceId) {
              const receipt = await tx.shipmentReceipt.findUniqueOrThrow({ where: { id: request.resourceId } });
              return { receipt: receipt.code, discrepancies: false, duplicate: true };
            }

            if (idem !== undefined &&
                (typeof idem !== "string" || !idem.trim() || idem.length > 128)) {
              throw new Error("Invalid receiving idempotency key");
            }

            await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${shipmentId} FOR UPDATE`;

            if (idem) {
              const duplicate = await tx.shipmentReceipt.findUnique({
                where: { idempotencyKey: idem },
              });

              if (duplicate) {
                if (duplicate.shipmentId !== shipmentId) {
                  throw new Error("Idempotency key belongs to another shipment");
                }

                return {
                  receipt: duplicate.code,
                  discrepancies: false,
                  duplicate: true,
                };
              }
            }

            const shipment = await tx.shipment.findUnique({
              where: { id: shipmentId },
              include: {
                packages: {
                  include: { package: { include: { items: true } } },
                },
                originWarehouse: true,
                destWarehouse: true,
              },
            });

            if (!shipment) {
              throw new Error("Shipment not found");
            }

            if (!["DISPATCHED", "IN_TRANSIT"].includes(shipment.status)) {
              throw new Error("Shipment is not in transit or already received");
            }

            const originId = shipment.originWarehouseId;
            const destWarehouseId = shipment.destWarehouseId;

            if (!originId || !destWarehouseId || originId === destWarehouseId) {
              throw new Error("Invalid shipment warehouse configuration");
            }

            if (!shipment.originWarehouse?.isActive ||
                !shipment.destWarehouse?.isActive) {
              throw new Error("Shipment warehouse is inactive");
            }

            if (body.warehouseId && body.warehouseId !== destWarehouseId) {
              throw new Error("Receiving warehouse must match shipment destination");
            }

            const previous = await tx.shipmentReceipt.count({
              where: { shipmentId },
            });

            if (previous > 0) {
              throw new Error("Existing shipment receipt requires reconciliation");
            }

            const items = (body.items ?? []) as {
              variantId: string;
              received: number;
              damaged: number;
              missing: number;
            }[];

            if (!Array.isArray(items) || !items.length) {
              throw new Error("Receiving items are required");
            }

            if (items.some(it =>
              !it ||
              typeof it.variantId !== "string" ||
              !it.variantId ||
              ![it.received, it.damaged, it.missing].every(
                qty => Number.isSafeInteger(qty) && qty >= 0
              )
            )) {
              throw new Error("Receiving quantities must be non-negative integers");
            }

            if (new Set(items.map(it => it.variantId)).size !== items.length) {
              throw new Error("Duplicate receiving variants");
            }

            const expected = new Map<string, number>();
            const values = new Map<string, Prisma.Decimal>();

            for (const sp of shipment.packages) {
              const pkg = sp.package;

              if (pkg.status !== "IN_TRANSIT" ||
                  pkg.shipmentId !== shipment.id ||
                  pkg.sourceWarehouseId !== originId) {
                throw new Error("Invalid package state for receiving");
              }

              for (const pit of pkg.items) {
                if (!Number.isSafeInteger(pit.qty) || pit.qty <= 0) {
                  throw new Error("Invalid shipment package item");
                }

                expected.set(
                  pit.variantId,
                  (expected.get(pit.variantId) ?? 0) + pit.qty
                );

                values.set(
                  pit.variantId,
                  (values.get(pit.variantId) ?? D(0)).add(D(pit.unitCost).mul(pit.qty))
                );
              }
            }

            if (!expected.size || items.length !== expected.size) {
              throw new Error("Full shipment receiving requires all expected variants");
            }

            for (const it of items) {
              const expQty = expected.get(it.variantId);

              if (expQty === undefined) {
                throw new Error("Unexpected shipment variant");
              }

              if (it.received + it.damaged + it.missing > expQty) {
                throw new Error("Over-receiving prevented");
              }

              if (it.damaged > 0 || it.missing > 0) {
                throw new Error("Damaged or missing stock requires discrepancy reconciliation");
              }

              if (it.received !== expQty) {
                throw new Error("Partial receiving requires reconciliation workflow");
              }
            }

            const boxesReceived = Number(
              body.boxesReceived ?? shipment.packages.length
            );

            if (!Number.isSafeInteger(boxesReceived) ||
                boxesReceived !== shipment.packages.length) {
              throw new Error("All shipment packages must be received");
            }

            const receivingCost = Number(body.receivingCost ?? 0);

            if (!Number.isFinite(receivingCost) || receivingCost !== 0) {
              throw new Error("Receiving charges require separate accounting review");
            }

            const shipmentCost = D(shipment.totalCostBdt);
            if (!shipmentCost.isFinite() || shipmentCost.lt(0) || !shipmentCost.eq(shipmentCost.toDecimalPlaces(2))) {
              throw new Error("Invalid shipment cost");
            }
            if (shipment.type === "LOCAL" && shipmentCost.gt(0)) {
              throw new Error("Local freight charges require separate accounting review");
            }

            const totalQty = items.reduce((a, it) => a + it.received, 0);
            if (!Number.isSafeInteger(totalQty) || totalQty <= 0) {
              throw new Error("Shipment receiving quantity must be positive");
            }
            const sortedItems = [...items].sort((a, b) => a.variantId.localeCompare(b.variantId));
            const totalCents = shipmentCost.mul(100);
            const allocations = sortedItems.map(it => {
              const share = totalCents.mul(it.received).div(totalQty);
              const cents = share.floor();
              return { variantId: it.variantId, cents, remainder: share.sub(cents) };
            });
            const allocated = allocations.reduce((sum, row) => sum.add(row.cents), D(0));
            const remainingCents = totalCents.sub(allocated).toNumber();
            allocations.sort((a, b) => b.remainder.cmp(a.remainder) || a.variantId.localeCompare(b.variantId));
            for (const row of allocations.slice(0, remainingCents)) row.cents = row.cents.add(1);
            const landedByVariant = new Map(allocations.map(row => [row.variantId, row.cents.div(100)]));

            const code = await nextDocNo(tx, "SHR");

            const receipt = await tx.shipmentReceipt.create({
              data: {
                code,
                shipmentId,
                warehouseId: destWarehouseId,
                receivedByName: (body.receivedByName as string) || user.name,
                boxesExpected: shipment.packages.length,
                boxesReceived,
                itemsJson: JSON.stringify(items),
                receivingCost: D(0),
                idempotencyKey: idem,
                notes: body.notes as string | undefined,
              },
            });

            for (const it of sortedItems) {
              const quantity = it.received;
              const baseValue = values.get(it.variantId) ?? D(0);
              const landedValue = landedByVariant.get(it.variantId) ?? D(0);

              const changed = await tx.finishedStock.updateMany({
                where: {
                  variantId: it.variantId,
                  warehouseId: originId,
                  packedQty: { gte: quantity },
                },
                data: {
                  packedQty: { decrement: quantity },
                },
              });

              if (changed.count !== 1) {
                throw new Error("Insufficient origin packed stock");
              }

              await postFinishedMovement(tx, {
                variantId: it.variantId,
                toWarehouseId: destWarehouseId,
                qty: quantity,
                unitCost: baseValue.add(landedValue).div(quantity),
                type: "RECEIVE_IN",
                refType: "SHIPMENT_RECEIPT",
                refId: receipt.id,
                refNo: code,
                userId: user.id,
                userName: user.name,
                note: `Received via ${shipment.code}`,
              });
            }

            if (shipmentCost.gt(0)) {
              const rows = sortedItems.map(it => ({
                shipmentId,
                variantId: it.variantId,
                warehouseId: destWarehouseId,
                amount: landedByVariant.get(it.variantId) ?? D(0),
              }));

              await tx.landedCostEntry.createMany({
                data: rows,
              });

              await addCostEntries(tx, rows.map(row => ({
                variantId: row.variantId,
                category: "INTL_FREIGHT",
                amount: row.amount,
                refType: "SHIPMENT",
                refId: shipment.id,
                refNo: shipment.code,
                note: "International landed cost",
              })));

              // Accrue unpaid shipment charges as a liability.
              // Already-paid charges require separate reconciliation.
              if (!D(shipment.paidAmount).isZero()) {
                throw new Error(
                  "Previously paid shipment charges require accounting reconciliation"
                );
              }

              const existingExpenses = await tx.expense.count({
                where: { shipmentId: shipment.id },
              });

              if (existingExpenses > 0) {
                throw new Error(
                  "Existing shipment expenses require accounting reconciliation"
                );
              }

              await postJournal(tx, {
                memo: `Unpaid landed cost accrual ${shipment.code}`,
                refType: "SHIPMENT",
                refId: shipment.id,
                refNo: shipment.code,
                userId: user.id,
                lines: [
                  {
                    accountCode: ACC.FG_INV,
                    debit: shipmentCost,
                  },
                  {
                    accountCode: ACC.AP_LOGISTICS,
                    credit: shipmentCost,
                  },
                ],
              });
            }

            const receivedPackages = await tx.package.updateMany({
              where: {
                id: {
                  in: shipment.packages.map(sp => sp.packageId),
                },
                shipmentId,
                status: "IN_TRANSIT",
              },
              data: { status: "RECEIVED" },
            });

            if (receivedPackages.count !== shipment.packages.length) {
              throw new Error("Package receiving status changed");
            }

            await tx.shipment.update({
              where: { id: shipmentId },
              data: {
                status: "RECEIVED_VERIFIED",
                actualArrival: new Date(),
              },
            });

            await logActivity(tx, {
              module: "LOGISTICS",
              action: "shipment_received",
              description: `Shipment ${shipment.code} received: ${totalQty} pieces`,
              userName: user.name,
              refNo: code,
            });

            if (request) await tx.salesRequest.update({ where: { key: request.key }, data: { resourceId: receipt.id } });
            return {
              receipt: code,
              discrepancies: false,
              duplicate: false,
            };
          });

          return ok(ser(result));

        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "resolve-discrepancy": {
        const id = String(body.id);
        const resolution = typeof body.resolution === "string" ? body.resolution.trim() : "";
        const status = String(body.status ?? "RESOLVED");
        if (status !== "RESOLVED") return bad("Shipment write-offs require inventory and accounting reconciliation", 409);
        if (!resolution) return bad("A resolution note is required");
        return db.$transaction(async tx => {
          const current = await tx.shipmentDiscrepancy.findUnique({ where: { id } });
          if (!current) return bad("Shipment discrepancy not found", 404);
          if (current.status === "RESOLVED") return ok(ser(current));
          if (current.status !== "OPEN" || current.receivedQty !== current.expectedQty || current.damagedQty || current.missingQty) {
            return bad("Shipment shortages and damage require inventory and accounting reconciliation", 409);
          }
          const changed = await tx.shipmentDiscrepancy.updateMany({
            where: { id, status: "OPEN", damagedQty: 0, missingQty: 0, receivedQty: current.expectedQty },
            data: { status, resolution, resolvedAt: new Date() },
          });
          if (!changed.count) return bad("Shipment discrepancy changed", 409);
          await logAudit(tx, { userId: user.id, userName: user.name, action: "UPDATE", entity: "ShipmentDiscrepancy",
            entityId: id, prevJson: { status: current.status }, newJson: { status }, reason: resolution });
          return ok(ser(await tx.shipmentDiscrepancy.findUniqueOrThrow({ where: { id } })));
        });
      }
      case "status": {
        if (body.status !== "IN_TRANSIT") {
          return bad("Use the dedicated shipment operation for status changes");
        }

        const changed = await db.shipment.updateMany({
          where: {
            id: String(body.id),
            status: "DISPATCHED",
          },
          data: { status: "IN_TRANSIT" },
        });

        if (changed.count !== 1) {
          return bad("Invalid shipment status transition");
        }

        const shipment = await db.shipment.findUniqueOrThrow({
          where: { id: String(body.id) },
        });

        return ok(ser(shipment));
      }
    }
  }

  // ── Transportation ledger ──
  if (resource === "transport" && action === "create") {
    if (!can(user, "view_financial") || scopedLocations(user)) return bad("Transport expense posting requires financial access", 403);
    try {
      const result = await db.$transaction(async (tx) => {
        const code = await nextDocNo(tx, "TRN");
        const amount = D(typeof body.amount === "number" ? body.amount : 0);
        if (!amount.isFinite() || amount.lte(0) || !amount.eq(amount.toDecimalPlaces(2))) throw new Error("A positive transport currency amount is required");
        if (body.shipmentId) throw new Error("Shipment freight requires the dedicated logistics accounting workflow");
        if (String(body.paymentStatus ?? "PAID") !== "PAID") throw new Error("Standalone unpaid transport charges require payable reconciliation");
        const account = await tx.account.findFirst({
          where: { code: String(body.accountCode ?? "1010"), isActive: true, currency: "BDT", type: { in: ["CASH", "BANK", "MOBILE_BANKING"] } },
        });
        if (!account) throw new Error("An active BDT payment account is required");
        const trn = await tx.transportationExpense.create({
          data: {
            code, origin: body.origin as string | undefined, destination: body.destination as string | undefined,
            purpose: body.purpose as string | undefined, partnerId: (body.partnerId as string) || null,
            vehicleType: body.vehicleType as string | undefined, vehicleInfo: body.vehicleInfo as string | undefined,
            driverInfo: body.driverInfo as string | undefined, planId: (body.planId as string) || null,
            batchId: (body.batchId as string) || null, poId: (body.poId as string) || null,
            workOrderId: (body.workOrderId as string) || null, shipmentId: (body.shipmentId as string) || null,
            amount, paymentStatus: "PAID",
            paymentMethod: body.paymentMethod as string | undefined, notes: body.notes as string | undefined,
            createdById: user.id,
          },
        });
        await postJournal(tx, {
          memo: `Transportation ${code}: ${body.origin ?? ""} → ${body.destination ?? ""}`,
          refType: "TRANSPORT", refId: trn.id, refNo: code, userId: user.id,
          lines: [
            { accountCode: ACC.FREIGHT, debit: amount },
            { accountCode: account.code, credit: amount },
          ],
        });
        // allocate to variants of the batch if batch-linked
        if (body.batchId) {
          const bvs = await tx.batchVariant.findMany({ where: { batchId: String(body.batchId) } });
          const totalQty = bvs.reduce((a, v) => a + v.plannedQty, 0) || 1;
          await addCostEntries(tx, bvs.map((v) => ({
            variantId: v.variantId, batchId: v.batchId, category: "TRANSPORT",
            amount: amount.mul(v.plannedQty).div(totalQty), refType: "TRANSPORT", refId: trn.id, refNo: code,
          })));
        }
        await logActivity(tx, { module: "LOGISTICS", action: "transport_recorded", description: `Transportation ${code}: ৳${amount.toFixed(2)} (${body.origin ?? "?"} → ${body.destination ?? "?"})`, userName: user.name, refNo: code, amount });
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
