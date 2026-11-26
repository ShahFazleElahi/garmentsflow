import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, q } from "./helpers";
import { NextRequest } from "next/server";
import { D, N, allocateIntegers, nextDocNo, logAudit, logActivity, Tx } from "../core";
import { generateMRP } from "../inventory";
import { PLAN_STATUSES } from "@/lib/constants";
import { can, scopedLocations, type AuthUser } from "../auth";

// ───────────────────────── GET ─────────────────────────
export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, "view");
  if ("error" in auth) return auth.error;
  const access = planningAccess(auth.user);

  if (resource === "plans" && !id) {
    const rows = await db.productPlan.findMany({
      omit: access.planCosts,
      include: {
        category: true, collection: true,
        colors: true, sizes: true,
        variants: { omit: access.variantCosts },
        batches: { omit: { estBudget: !access.financial }, include: { variants: true } },
        boms: { orderBy: { version: "desc" } },
        _count: { select: { designs: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(ser(rows));
  }

  if (resource === "plans" && id) {
    if (id === "detail") {
      const planId = q(req, "planId");
      if (!planId) return bad("planId is required");
      return planDetail(planId, access);
    }
    return planDetail(id, access);
  }

  return bad(`Unknown planning resource: ${resource}`, 404);
}

function planningAccess(user: AuthUser) {
  const financial = can(user, "view_financial");
  const locations = scopedLocations(user);
  const planCosts = { estimatedBudget: !financial, targetMfgCost: !financial, targetLandedCost: !financial,
    targetWholesalePrice: !financial, targetRetailPrice: !financial };
  const variantCosts = { estMaterialCost: !financial, estServiceCost: !financial, targetPrice: !financial };
  const workOrderCosts = { pricingJson: !financial, estServiceCost: !financial, transportCost: !financial,
    advanceAmount: !financial, actualServiceCost: !financial, paidAmount: !financial, vendorInvoiceNo: !financial };
  return { financial, locations, planCosts, variantCosts, workOrderCosts, audit: can(user, "manage_users") };
}

async function planDetail(planId: string, access: ReturnType<typeof planningAccess>) {
  const { financial, locations, planCosts, variantCosts, workOrderCosts } = access;
  const material = { omit: { purchasePrice: !financial, avgCost: !financial } };
  const warehouse = locations ? { locationId: { in: locations } } : undefined;
  const shipmentScope = locations ? { OR: [{ originLocationId: { in: locations } }, { destLocationId: { in: locations } }] } : {};
  const shipmentCosts = { freightCharge: !financial, insuranceCharge: !financial, customsCharge: !financial,
    importDuties: !financial, taxesCharge: !financial, docCharge: !financial, handlingCharge: !financial,
    lastMileCharge: !financial, otherCharge: !financial, totalCost: !financial, totalCostBdt: !financial,
    exchangeRate: !financial, paidAmount: !financial };
  const plan = await db.productPlan.findUnique({
    where: { id: planId },
    omit: planCosts,
    include: {
      category: true, collection: true, colors: true, sizes: true, matrix: true,
      variants: { omit: variantCosts, include: { cost: financial } },
      boms: { include: { items: { omit: { estUnitCost: !financial }, include: { material, color: { select: { name: true } } } } }, orderBy: { version: "desc" } },
      materialRequirements: { omit: { estCost: !financial }, include: { material } },
      designs: { include: { samples: { omit: { materialsCost: !financial, factoryCharge: !financial, tailorCharge: !financial, transportCost: !financial, totalCost: !financial } } } },
      batches: { omit: { estBudget: !financial }, include: { variants: true, workOrders: { omit: workOrderCosts } } },
      purchaseOrders: financial ? { include: { supplier: true, items: { include: { material: true } } } } : false,
      measurementCharts: true,
      plans: access.audit,
    },
  });
  if (!plan) return bad("Plan not found", 404);
  const visibleWarehouses = warehouse
    ? (await db.warehouse.findMany({ where: warehouse, select: { id: true } })).map(row => row.id)
    : undefined;
  const relatedShipments = { packages: { some: { package: { items: { some: { variant: { planId } } } } } }, ...shipmentScope };
  const [issues, inspections, finishedStocks, packages, shipmentsLocal, shipmentsIntl, expenses, payments, salesItems, costEntries, activities, auditLogs] = await Promise.all([
    db.workOrderMaterial.findMany({ where: { workOrder: { planId } }, include: { material, workOrder: { omit: workOrderCosts } } }),
    db.qualityInspection.findMany({ where: { planId }, orderBy: { inspectionDate: "desc" } }),
    db.finishedStock.findMany({ where: { variant: { planId }, warehouse }, omit: { unitCost: !financial }, include: { warehouse: true, variant: { omit: variantCosts } } }),
    db.package.findMany({ where: { sourceWarehouseId: visibleWarehouses ? { in: visibleWarehouses } : undefined, items: { some: { variant: { planId } } } },
      omit: { packagingCost: !financial }, include: { items: { where: { variant: { planId } }, omit: { unitCost: !financial }, include: { variant: { omit: variantCosts } } } } }),
    db.shipment.findMany({ where: { type: "LOCAL", ...relatedShipments }, omit: shipmentCosts,
      include: { packages: { include: { package: { omit: { packagingCost: !financial } } } } } }),
    db.shipment.findMany({ where: { type: "INTERNATIONAL", ...relatedShipments }, omit: shipmentCosts,
      include: { packages: { include: { package: { omit: { packagingCost: !financial } } } }, landedCosts: financial } }),
    financial ? db.expense.findMany({ where: { planId }, orderBy: { date: "desc" } }) : [],
    financial ? db.vendorInvoice.findMany({ where: { OR: [{ po: { planId } }, { workOrderId: { in: plan.batches.flatMap(b => b.workOrders.map(w => w.id)) } }] } }) : [],
    financial ? db.salesInvoiceItem.findMany({ where: { variant: { planId }, invoice: locations ? { locationId: { in: locations } } : undefined }, include: { invoice: { include: { customer: true } } } }) : [],
    financial ? db.costEntry.findMany({ where: { variant: { planId } }, orderBy: { date: "asc" } }) : [],
    financial ? db.activityEvent.findMany({ where: { OR: [{ planId }, { batchId: { in: plan.batches.map(b => b.id) } }] }, orderBy: { date: "desc" }, take: 200 }) : [],
    access.audit ? db.auditLog.findMany({ where: { OR: [{ entityId: planId }, { refNo: plan.code }] }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
  ]);
  return ok(ser({ plan: { ...plan, requirements: plan.materialRequirements }, issues, inspections, finishedStocks, packages, shipmentsLocal, shipmentsIntl, expenses, payments, salesItems, costEntries, activities, auditLogs }));
}

// ───────────────────────── POST ─────────────────────────
export async function handlePost(segments: string[], body: Record<string, unknown>, req: NextRequest) {
  const [resource, action] = segments;
  const permNeeded = ["approve", "status", "revise", "bom-approve"].includes(action ?? "") ? "approve" : "create";
  const auth = await requirePerm(req, permNeeded as "approve" | "create");
  if ("error" in auth) return auth.error;
  const { user } = auth;

  if (resource === "plans") {
    if (["update", "colors", "sizes", "matrix", "generate-variants"].includes(action ?? "")) {
      const plan = await db.productPlan.findUnique({ where: { id: String(body.planId ?? body.id ?? "") }, select: { approvedAt: true, status: true, _count: { select: { batches: true } } } });
      if (!plan) return bad("Plan not found", 404);
      if (plan.approvedAt || plan._count.batches > 0) return bad("Approved or batched plans must be revised before changing quantities or variants", 409);
    }
    switch (action) {
      case "create": {
        if (typeof body.name !== "string" || !body.name.trim() || !Number.isSafeInteger(Number(body.plannedQty)) || Number(body.plannedQty) <= 0) return bad("Name and positive planned quantity required");
        const code = await nextDocNoGen();
        const plan = await db.productPlan.create({
          data: {
            code, name: String(body.name), description: body.description as string | undefined,
            categoryId: (body.categoryId as string) || null, collectionId: (body.collectionId as string) || null,
            season: body.season as string | undefined, targetMarket: body.targetMarket as string | undefined,
            targetCustomer: body.targetCustomer as string | undefined,
            status: "DRAFT",
            unit: String(body.unit ?? "Piece"),
            plannedQty: Number(body.plannedQty ?? 0),
            planningDate: body.planningDate ? new Date(String(body.planningDate)) : new Date(),
            expectedStartDate: body.expectedStartDate ? new Date(String(body.expectedStartDate)) : undefined,
            targetCompletionDate: body.targetCompletionDate ? new Date(String(body.targetCompletionDate)) : undefined,
            estimatedBudget: D(body.estimatedBudget as number),
            targetMfgCost: D(body.targetMfgCost as number),
            targetLandedCost: D(body.targetLandedCost as number),
            targetWholesalePrice: D(body.targetWholesalePrice as number),
            targetRetailPrice: D(body.targetRetailPrice as number),
            priority: String(body.priority ?? "MEDIUM"),
            assignedTo: body.assignedTo as string | undefined,
            instructions: body.instructions as string | undefined,
            notes: body.notes as string | undefined,
            createdById: user.id,
          },
        });
        await db.$transaction(async (tx) => {
          await logAudit(tx, { userId: user.id, userName: user.name, action: "CREATE", entity: "ProductPlan", entityId: plan.id, refNo: plan.code, newJson: plan });
          await logActivity(tx, { module: "PLANNING", action: "plan_created", description: `Product plan ${plan.code} — ${plan.name} (${plan.plannedQty} ${plan.unit.toLowerCase()})`, userName: user.name, planId: plan.id, refNo: plan.code });
        });
        return ok(ser(plan));
      }
      case "update": {
        const { id, ...rest } = body as Record<string, unknown> & { id: string };
        const allowed = ["name", "description", "categoryId", "collectionId", "season", "targetMarket", "targetCustomer", "unit", "plannedQty", "planningDate", "expectedStartDate", "targetCompletionDate", "estimatedBudget", "targetMfgCost", "targetLandedCost", "targetWholesalePrice", "targetRetailPrice", "priority", "assignedTo", "instructions", "notes"];
        const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([key]) => allowed.includes(key)));
        for (const k of ["estimatedBudget", "targetMfgCost", "targetLandedCost", "targetWholesalePrice", "targetRetailPrice"]) {
          if (rest[k] != null) patch[k] = D(rest[k] as number);
        }
        for (const k of ["planningDate", "expectedStartDate", "targetCompletionDate"]) {
          if (rest[k]) patch[k] = new Date(String(rest[k]));
        }
        if (patch.plannedQty != null && (!Number.isSafeInteger(Number(patch.plannedQty)) || Number(patch.plannedQty) <= 0)) return bad("Invalid planned quantity");
        const plan = await db.productPlan.update({ where: { id }, data: patch as never });
        return ok(ser(plan));
      }
      case "colors":
      case "sizes": {
        try {
          const planId = String(body.planId);
          const names = body[action] as { name: string; hex?: string; fabricShade?: string; dyeLot?: string;
            measurements?: unknown; active?: boolean }[];
          if (!Array.isArray(names) || !names.length || names.some(row => typeof row?.name !== "string" || !row.name.trim()) ||
              new Set(names.map(row => row.name.trim().toLowerCase())).size !== names.length) {
            return bad("Distinct names are required");
          }
          const result = await db.$transaction(async tx => {
            await tx.$queryRaw`SELECT "id" FROM "ProductPlan" WHERE "id" = ${planId} FOR UPDATE`;
            const plan = await tx.productPlan.findUniqueOrThrow({
              where: { id: planId }, include: { _count: { select: { variants: true, batches: true } } },
            });
            if (plan.approvedAt || plan._count.variants || plan._count.batches ||
                (action === "colors" && await tx.bOMItem.count({ where: { bom: { planId }, colorId: { not: null } } }))) {
              throw new Error("Existing variants, batches or BOM allocations protect this matrix dimension");
            }
            await tx.matrixCell.deleteMany({ where: { planId } });
            if (action === "colors") {
              await tx.planColor.deleteMany({ where: { planId } });
              return tx.planColor.createManyAndReturn({ data: names.map(row => ({
                planId, name: row.name.trim(), hex: row.hex ?? "#334155", fabricShade: row.fabricShade,
                dyeLot: row.dyeLot, active: row.active ?? true,
              })) });
            }
            await tx.planSize.deleteMany({ where: { planId } });
            return tx.planSize.createManyAndReturn({ data: names.map(row => ({
              planId, name: row.name.trim(), measurementsJson: row.measurements ? JSON.stringify(row.measurements) : undefined,
              active: row.active ?? true,
            })) });
          });
          return ok(ser(result));
        } catch (error) {
          return bad((error as Error).message, 409);
        }
      }
      case "matrix": {
        try {
          const planId = String(body.planId);
          const cells = body.cells as { colorId: string; sizeId: string; qty: number; enabled?: boolean }[];
          if (!Array.isArray(cells) || !cells.length || cells.some(cell => !cell || typeof cell.colorId !== "string" ||
              typeof cell.sizeId !== "string" || !Number.isSafeInteger(cell.qty) || cell.qty < 0) ||
              new Set(cells.map(cell => `${cell.colorId}:${cell.sizeId}`)).size !== cells.length) {
            return bad("Matrix requires distinct color and size pairs with non-negative whole quantities");
          }
          const total = cells.filter(cell => cell.enabled !== false).reduce((sum, cell) => sum + cell.qty, 0);
          await db.$transaction(async tx => {
            await tx.$queryRaw`SELECT "id" FROM "ProductPlan" WHERE "id" = ${planId} FOR UPDATE`;
            const plan = await tx.productPlan.findUniqueOrThrow({
              where: { id: planId }, include: { colors: true, sizes: true, _count: { select: { batches: true } } },
            });
            if (plan.approvedAt || plan._count.batches) throw new Error("Approved or batched plans protect their matrix");
            const colors = new Set(plan.colors.filter(row => row.active).map(row => row.id));
            const sizes = new Set(plan.sizes.filter(row => row.active).map(row => row.id));
            if (cells.some(cell => !colors.has(cell.colorId) || !sizes.has(cell.sizeId))) throw new Error("Invalid matrix color or size");
            if (total > plan.plannedQty) throw new Error("Matrix allocation exceeds plan quantity");
            await tx.matrixCell.deleteMany({ where: { planId } });
            await tx.matrixCell.createMany({ data: cells.map(cell => ({
              planId, colorId: cell.colorId, sizeId: cell.sizeId, qty: cell.qty, enabled: cell.enabled ?? true,
            })) });
            await logActivity(tx, { module: "PLANNING", action: "matrix_updated", description: `Production matrix updated — allocated ${total} of planned quantity`, userName: user.name, planId });
          });
          return ok({ saved: true, total });
        } catch (error) {
          return bad((error as Error).message);
        }
      }
      case "generate-variants": {
        try {
          const planId = String(body.planId);
          const result = await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "ProductPlan" WHERE "id" = ${planId} FOR UPDATE`;
            const plan = await tx.productPlan.findUnique({ where: { id: planId }, include: { colors: true, sizes: true,
              matrix: { orderBy: [{ colorId: "asc" }, { sizeId: "asc" }] }, _count: { select: { batches: true } } } });
            if (!plan) throw new Error("Plan not found");
            if (plan.approvedAt || plan._count.batches) throw new Error("Approved or batched plans protect their variants");
            const cells = plan.matrix.filter((m) => m.enabled && m.qty > 0);
            if (cells.length === 0) throw new Error("No allocated matrix cells with quantity");
            // SKU: PRD-0001-BLK-XL (color/size tokens)
            const token = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "GEN";
            const existing = await tx.productVariant.findMany({ where: { planId } });
            const existingByKey = new Map(existing.map((v) => [`${v.colorId}:${v.sizeId}`, v]));
            const skus = new Set(existing.map(row => row.sku));
            for (const cell of cells) {
              const color = plan.colors.find((c) => c.id === cell.colorId)!;
              const size = plan.sizes.find((s) => s.id === cell.sizeId)!;
              const key = `${cell.colorId}:${cell.sizeId}`;
              const existingVariant = existingByKey.get(key);
              if (existingVariant) {
                // preserve SKU — same approved variant reproduced
                await tx.productVariant.update({ where: { id: existingVariant.id }, data: { plannedQty: cell.qty } });
                continue;
              }
              const baseSku = `${plan.code}-${token(color.name)}-${token(size.name)}`;
              let sku = baseSku;
              for (let suffix = 2; skus.has(sku); suffix++) sku = `${baseSku}-${suffix}`;
              skus.add(sku);
              const barcode = `GF-${plan.code}-${cell.colorId}-${cell.sizeId}`;
              await tx.productVariant.create({
                data: {
                  planId, sku, colorId: cell.colorId, sizeId: cell.sizeId, colorName: color.name, sizeName: size.name,
                  barcode, qrPayload: JSON.stringify({ t: "variant", sku }), plannedQty: cell.qty,
                },
              });
            }
            // remove variants no longer in matrix (only when no stock/batch movement)
            const keepKeys = new Set(cells.map((c) => `${c.colorId}:${c.sizeId}`));
            for (const v of existing) {
              if (!keepKeys.has(`${v.colorId}:${v.sizeId}`)) {
                const hasBatch = await tx.batchVariant.count({ where: { variantId: v.id } });
                const hasStock = await tx.finishedStock.count({ where: { variantId: v.id, qty: { gt: 0 } } });
                if (!hasBatch && !hasStock) await tx.productVariant.delete({ where: { id: v.id } });
              }
            }
            await tx.productPlan.update({ where: { id: planId }, data: { status: "VARIANT_CONFIGURATION" } });
            await logActivity(tx, { module: "PLANNING", action: "variants_generated", description: `Variants generated for ${plan.code}`, userName: user.name, planId });
            return { generated: true };
          });
          return ok(result);
        } catch (error) {
          return bad((error as Error).message);
        }
      }
      case "status": {
        if (!PLAN_STATUSES.includes(body.status as typeof PLAN_STATUSES[number])) return bad("Unknown plan status");
        if (body.status === "APPROVED") return bad("Use the approval action to validate the matrix");
        const existing = await db.productPlan.findUnique({
          where: { id: String(body.id) },
          include: {
            _count: { select: { batches: true } },
          },
        });

        if (!existing) return bad("Plan not found", 404);

        const requestedStatus = String(body.status);

        if (requestedStatus === existing.status) {
          return ok(ser(existing));
        }

        if ([
          "IN_PRODUCTION",
          "PARTIALLY_COMPLETED",
          "COMPLETED",
        ].includes(requestedStatus)) {
          return bad(
            "Production status is managed automatically by production and quality control",
            409
          );
        }

        if (
          existing._count.batches > 0 ||
          ["IN_PRODUCTION", "PARTIALLY_COMPLETED", "COMPLETED"].includes(
            existing.status
          )
        ) {
          return bad(
            "An active production plan cannot be manually moved to another status",
            409
          );
        }

        if (
          ["PROCUREMENT_IN_PROGRESS", "READY_FOR_PRODUCTION"].includes(
            requestedStatus
          ) &&
          !existing.approvedAt
        ) {
          return bad("Approve the plan first", 409);
        }
        const plan = await db.productPlan.update({
          where: { id: String(body.id) },
          data: { status: String(body.status) },
        });
        await db.$transaction((tx) => logActivity(tx, { module: "PLANNING", action: "status_changed", description: `${plan.code} → ${String(body.status).replaceAll("_", " ")}`, userName: user.name, planId: plan.id, refNo: plan.code }));
        return ok(ser(plan));
      }
      case "approve": {
        try {
          const result = await db.$transaction(async (tx) => {
            const id = String(body.id);
            await tx.$queryRaw`SELECT "id" FROM "ProductPlan" WHERE "id" = ${id} FOR UPDATE`;
            const plan = await tx.productPlan.findUnique({ where: { id }, include: { matrix: true, variants: true, _count: { select: { batches: true } } } });
            if (!plan) throw new Error("Plan not found");
            if (plan.status === "APPROVED") return plan;
            if (plan.approvedAt || plan._count.batches || ["IN_PRODUCTION", "PARTIALLY_COMPLETED", "COMPLETED", "CANCELLED"].includes(plan.status)) {
              throw new Error("Approval cannot restart an existing production workflow");
            }
            const allocated = plan.matrix.filter((m) => m.enabled).reduce((a, m) => a + m.qty, 0);
            if (plan.plannedQty <= 0 || allocated !== plan.plannedQty) {
              throw new Error(`Cannot approve: allocated quantity (${allocated}) must equal planned quantity (${plan.plannedQty})`);
            }
            const variantQty = plan.variants.reduce((a, v) => a + v.plannedQty, 0);
            if (variantQty !== plan.plannedQty || plan.matrix.filter(m => m.enabled && m.qty > 0).some(m => !plan.variants.some(v => v.colorId === m.colorId && v.sizeId === m.sizeId && v.plannedQty === m.qty))) {
              throw new Error(`Cannot approve: generated variants cover ${variantQty} of ${plan.plannedQty} — generate variants first`);
            }
            const updated = await tx.productPlan.update({
              where: { id: plan.id },
              data: { status: "APPROVED", approvedAt: new Date(), approvedById: user.id },
            });
            await logAudit(tx, { userId: user.id, userName: user.name, action: "APPROVE", entity: "ProductPlan", entityId: plan.id, refNo: plan.code, newJson: { status: "APPROVED" } });
            await logActivity(tx, { module: "PLANNING", action: "plan_approved", description: `Plan ${plan.code} approved — ${plan.plannedQty} ${plan.unit.toLowerCase()} across ${plan.variants.length} variants`, userName: user.name, planId: plan.id, refNo: plan.code });
            return updated;
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "revise": {
        try {
          const result = await db.$transaction(async (tx) => {
            const id = String(body.id);
            await tx.$queryRaw`SELECT "id" FROM "ProductPlan" WHERE "id" = ${id} FOR UPDATE`;
            const plan = await tx.productPlan.findUnique({ where: { id }, include: { colors: true, sizes: true, matrix: true, variants: true,
              _count: { select: { batches: true } } } });
            if (!plan) throw new Error("Plan not found");
            if (plan._count.batches) throw new Error("Revising a batched plan requires production reconciliation");
            const plannedQty = Number(body.plannedQty ?? plan.plannedQty);
            if (!Number.isSafeInteger(plannedQty) || plannedQty <= 0) throw new Error("Revised quantity must be a positive integer");
            const snapshot = { plannedQty: plan.plannedQty, colors: plan.colors.length, sizes: plan.sizes.length, matrix: plan.matrix.map((m) => ({ colorId: m.colorId, sizeId: m.sizeId, qty: m.qty })) };
            await tx.planVersion.create({
              data: {
                planId: plan.id, version: plan.version, snapshotJson: JSON.stringify(snapshot),
                reason: String(body.reason ?? "Revision"), revisedById: user.id, revisedBy: user.name,
              },
            });
            const newVersion = plan.version + 1;
            const updated = await tx.productPlan.update({
              where: { id: plan.id },
              data: { version: newVersion, status: "BUDGET_PLANNING", approvedAt: null, approvedById: null, plannedQty },
            });
            await logAudit(tx, { userId: user.id, userName: user.name, action: "REVISE", entity: "ProductPlan", entityId: plan.id, refNo: plan.code, prevJson: snapshot, newJson: { version: newVersion, plannedQty: updated.plannedQty }, reason: String(body.reason ?? "") });
            await logActivity(tx, { module: "PLANNING", action: "plan_revised", description: `Plan ${plan.code} revised to v${newVersion}`, userName: user.name, planId: plan.id, refNo: plan.code });
            return updated;
          });
          return ok(ser(result));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "designs": {
        if ((body as { sub?: string }).sub === "approve") {
          const design = await db.design.update({
            where: { id: String(body.id) },
            data: { status: "APPROVED", approvedAt: new Date(), approvedById: user.id },
          });
          return ok(ser(design));
        }
        if ((body as { sub?: string }).sub === "freeze") {
          const design = await db.design.update({ where: { id: String(body.id) }, data: { status: "FROZEN", frozenAt: new Date() } });
          await db.$transaction((tx) => logActivity(tx, { module: "PLANNING", action: "design_frozen", description: `Design ${design.code} v${design.version} frozen for production`, userName: user.name, planId: design.planId }));
          return ok(ser(design));
        }
        const planId = String(body.planId);
        const count = await db.design.count({ where: { planId } });
        const design = await db.design.create({
          data: {
            planId, code: `DSG-${String(count + 1).padStart(3, "0")}`, name: String(body.name),
            designer: (body.designer as string) || user.name, version: 1, status: "DRAFT",
            instructions: body.instructions as string | undefined,
            filesJson: JSON.stringify(body.files ?? []),
          },
        });
        return ok(ser(design));
      }
      case "samples": {
        if ((body as { sub?: string }).sub === "status") {
          const sample = await db.sample.update({ where: { id: String(body.id) }, data: { status: String(body.status), approvedAt: body.status === "APPROVED" ? new Date() : undefined } });
          return ok(ser(sample));
        }
        const designId = String(body.designId);
        const sample = await db.sample.create({
          data: {
            designId, qty: Number(body.qty ?? 1),
            status: String(body.status ?? "CONCEPT"),
            materialsCost: D(body.materialsCost as number), factoryCharge: D(body.factoryCharge as number),
            tailorCharge: D(body.tailorCharge as number), transportCost: D(body.transportCost as number),
            totalCost: D((Number(body.materialsCost ?? 0) + Number(body.factoryCharge ?? 0) + Number(body.tailorCharge ?? 0) + Number(body.transportCost ?? 0))),
            corrections: body.corrections as string | undefined,
          },
        });
        return ok(ser(sample));
      }
      case "measurement": {
        const planId = (body.planId as string) || null;
        const chart = await db.measurementChart.create({
          data: {
            planId, name: String(body.name), categoryKey: body.categoryKey as string | undefined,
            unit: String(body.unit ?? "inch"), version: 1,
            itemsJson: JSON.stringify(body.items ?? []), isTemplate: Boolean(body.isTemplate),
          },
        });
        return ok(ser(chart));
      }
      case "measurement-approve": {
        const chart = await db.measurementChart.update({ where: { id: String(body.id) }, data: { status: "APPROVED", approvedAt: new Date() } });
        return ok(ser(chart));
      }
      case "bom": {
        try {
          const planId = String(body.planId);
          const result = await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "ProductPlan" WHERE "id" = ${planId} FOR UPDATE`;
            const plan = await tx.productPlan.findUnique({ where: { id: planId }, include: { boms: true, colors: true } });
            if (!plan) throw new Error("Plan not found");
            if (plan.approvedAt) throw new Error("Revise the product plan before editing its BOM");
            const items = body.items as { materialId: string; colorId?: string; component?: string; qtyPerPiece: number; wastagePct?: number; estUnitCost?: number; sizeOverrides?: Record<string, number>; supplierId?: string }[];
            const colors = new Set(plan.colors.filter(c => c.active).map(c => c.id));
            const nonNegative = (value: number) => Number.isFinite(value) && value >= 0;
            if (!Array.isArray(items) || !items.length || items.some(item => !item || !item.materialId ||
              (item.colorId != null && !colors.has(item.colorId)) || !nonNegative(item.qtyPerPiece) ||
              !nonNegative(item.wastagePct ?? 0) || !nonNegative(item.estUnitCost ?? 0) ||
              (item.sizeOverrides != null && (typeof item.sizeOverrides !== "object" || Array.isArray(item.sizeOverrides) ||
                Object.values(item.sizeOverrides).some(value => !nonNegative(value)))))) {
              throw new Error("BOM requires valid materials, plan colors and non-negative quantities and costs");
            }
            // editing an approved BOM creates a new version
            let bom = plan.boms.sort((a, b) => b.version - a.version)[0];
            if (bom && bom.status === "APPROVED") {
              bom = await tx.bOM.create({ data: { planId, version: bom.version + 1, status: "DRAFT", notes: `Revised from v${bom.version}` } });
            } else if (!bom) {
              bom = await tx.bOM.create({ data: { planId, version: 1, status: "DRAFT" } });
            }
            await tx.bOMItem.deleteMany({ where: { bomId: bom.id } });
            for (const it of items) {
              await tx.bOMItem.create({
                data: {
                  bomId: bom.id, materialId: it.materialId, colorId: it.colorId ?? null, component: it.component ?? "MAIN",
                  qtyPerPiece: D(it.qtyPerPiece), wastagePct: D(it.wastagePct ?? 0),
                  estUnitCost: D(it.estUnitCost ?? 0),
                  sizeOverridesJson: it.sizeOverrides && Object.keys(it.sizeOverrides).length ? JSON.stringify(it.sizeOverrides) : undefined,
                  supplierId: it.supplierId || null,
                },
              });
            }
            // estimated material cost per variant
            const variants = await tx.productVariant.findMany({ where: { planId } });
            for (const v of variants) {
              let estCost = D(0);
              for (const it of items) {
                if (it.colorId && it.colorId !== v.colorId) continue;
                let per = it.qtyPerPiece;
                if (it.sizeOverrides && it.sizeOverrides[v.sizeName] != null) per = it.sizeOverrides[v.sizeName];
                estCost = estCost.add(D(per).mul(D(1).add(D(it.wastagePct).div(100))).mul(D(it.estUnitCost)));
              }
              await tx.productVariant.update({ where: { id: v.id }, data: { estMaterialCost: estCost.toDecimalPlaces(2) } });
            }
            await logActivity(tx, { module: "PLANNING", action: "bom_saved", description: `BOM v${bom.version} saved (${items.length} items) for ${plan.code}`, userName: user.name, planId, refNo: plan.code });
            return { bomId: bom.id, version: bom.version, items: items.length };
          });
          return ok(result);
        } catch (error) {
          return bad((error as Error).message);
        }
      }
      case "bom-approve": {
        try {
          const result = await db.$transaction(async (tx) => {
            const id = String(body.id);
            const candidate = await tx.bOM.findUniqueOrThrow({ where: { id } });
            await tx.$queryRaw`SELECT "id" FROM "ProductPlan" WHERE "id" = ${candidate.planId} FOR UPDATE`;
            const latest = await tx.bOM.findFirstOrThrow({ where: { planId: candidate.planId }, orderBy: { version: "desc" }, include: { _count: { select: { items: true } }, plan: true } });
            if (latest.id !== id || !latest._count.items) throw new Error("Only the latest nonempty BOM can be approved");
            if (latest.status === "APPROVED") return latest;
            if (latest.status !== "DRAFT" || latest.plan.approvedAt) throw new Error("Revise the product plan before approving a new BOM");
            const bom = await tx.bOM.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date() } });
            await tx.productPlan.update({ where: { id: bom.planId }, data: { status: "MATERIAL_PLANNING" } });
            await logActivity(tx, { module: "PLANNING", action: "bom_approved", description: `BOM v${bom.version} approved`, userName: user.name, planId: bom.planId });
            return bom;
          });
          return ok(ser(result));
        } catch (error) {
          return bad((error as Error).message);
        }
      }
      case "mrp": {
        try {
          const rows = await db.$transaction(async (tx) => generateMRP(tx, String(body.planId)));
          return ok(ser(rows));
        } catch (e) {
          return bad((e as Error).message);
        }
      }
      case "budget": {
        const planId = String(body.planId);
        const plan = await db.productPlan.update({
          where: { id: planId },
          data: {
            estimatedBudget: D(body.estimatedBudget as number),
            targetMfgCost: D(body.targetMfgCost as number),
            targetLandedCost: D(body.targetLandedCost as number),
            targetWholesalePrice: D(body.targetWholesalePrice as number),
            targetRetailPrice: D(body.targetRetailPrice as number),
            status: "BUDGET_PLANNING",
          },
        });
        await db.$transaction((tx) => logActivity(tx, { module: "PLANNING", action: "budget_updated", description: `Budget set to ৳${Number(body.estimatedBudget).toLocaleString()} for ${plan.code}`, userName: user.name, planId, amount: Number(body.estimatedBudget ?? 0) }));
        return ok(ser(plan));
      }
      case "duplicate": {
        const src = await db.productPlan.findUnique({ where: { id: String(body.id) }, include: { colors: true, sizes: true, matrix: true, boms: { include: { items: true } } } });
        if (!src) return bad("Plan not found", 404);
        const code = await nextDocNoGen();
        const copy = await db.productPlan.create({
          data: {
            code, name: `${src.name} (Copy)`, description: src.description, categoryId: src.categoryId,
            collectionId: src.collectionId, season: src.season, targetMarket: src.targetMarket,
            targetCustomer: src.targetCustomer, unit: src.unit, plannedQty: src.plannedQty,
            estimatedBudget: src.estimatedBudget, targetMfgCost: src.targetMfgCost, targetLandedCost: src.targetLandedCost,
            targetWholesalePrice: src.targetWholesalePrice, targetRetailPrice: src.targetRetailPrice,
            priority: src.priority, instructions: src.instructions, notes: src.notes, createdById: user.id, status: "DRAFT",
          },
        });
        await db.$transaction(async (tx) => {
          const colorMap = new Map<string, string>();
          for (const c of src.colors) {
            const nc = await tx.planColor.create({ data: { planId: copy.id, name: c.name, hex: c.hex, fabricShade: c.fabricShade, dyeLot: c.dyeLot } });
            colorMap.set(c.id, nc.id);
          }
          const sizeMap = new Map<string, string>();
          for (const s of src.sizes) {
            const ns = await tx.planSize.create({ data: { planId: copy.id, name: s.name, measurementsJson: s.measurementsJson } });
            sizeMap.set(s.id, ns.id);
          }
          for (const m of src.matrix) {
            await tx.matrixCell.create({ data: { planId: copy.id, colorId: colorMap.get(m.colorId)!, sizeId: sizeMap.get(m.sizeId)!, qty: m.qty, enabled: m.enabled } });
          }
          await logActivity(tx, { module: "PLANNING", action: "plan_duplicated", description: `Plan ${src.code} duplicated as ${copy.code}`, userName: user.name, planId: copy.id, refNo: copy.code });
        });
        return ok(ser(copy));
      }
    }
  }
  return bad(`Unknown planning action: ${resource}/${action ?? ""}`, 404);
}

async function nextDocNoGen(): Promise<string> {
  return db.$transaction((tx) => nextDocNo(tx, "PLAN"));
}
