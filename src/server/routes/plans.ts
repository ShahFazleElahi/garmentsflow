import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, q } from "./helpers";
import { NextRequest } from "next/server";
import { D, N, allocateIntegers, nextDocNo, logAudit, logActivity, Tx } from "../core";
import { generateMRP } from "../inventory";
import { PLAN_STATUSES } from "@/lib/constants";

// ───────────────────────── GET ─────────────────────────
export async function handleGet(segments: string[], req: NextRequest) {
  const [resource, id] = segments;
  const auth = await requirePerm(req, "view");
  if ("error" in auth) return auth.error;

  if (resource === "plans" && !id) {
    const rows = await db.productPlan.findMany({
      include: {
        category: true, collection: true,
        colors: true, sizes: true,
        variants: true,
        batches: { include: { variants: true } },
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
      return planDetail(planId);
    }
    return planDetail(id);
  }

  return bad(`Unknown planning resource: ${resource}`, 404);
}

async function planDetail(planId: string) {
  const plan = await db.productPlan.findUnique({
    where: { id: planId },
    include: {
      category: true, collection: true, colors: true, sizes: true, matrix: true,
      variants: { include: { cost: true } },
      boms: { include: { items: { include: { material: true } } }, orderBy: { version: "desc" } },
      materialRequirements: { include: { material: true } },
      designs: { include: { samples: true } },
      batches: { include: { variants: true, workOrders: true } },
      purchaseOrders: { include: { supplier: true, items: { include: { material: true } } } },
      measurementCharts: true,
      plans: true,
    },
  });
  if (!plan) return bad("Plan not found", 404);
  const [issues, inspections, finishedStocks, packages, shipmentsLocal, shipmentsIntl, expenses, budgetItems] = await Promise.all([
    db.workOrderMaterial.findMany({ where: { workOrder: { planId } }, include: { material: true, workOrder: true } }),
    db.qualityInspection.findMany({ where: { planId }, orderBy: { inspectionDate: "desc" } }),
    db.finishedStock.findMany({ where: { variant: { planId } }, include: { warehouse: true, variant: true } }),
    db.package.findMany({ where: { items: { some: { variant: { planId } } } }, include: { items: { include: { variant: true } } } }),
    db.shipment.findMany({ where: { type: "LOCAL", packages: { some: { package: { items: { some: { variant: { planId } } } } } } }, include: { packages: { include: { package: true } } } }),
    db.shipment.findMany({ where: { type: "INTERNATIONAL", packages: { some: { package: { items: { some: { variant: { planId } } } } } } }, include: { packages: { include: { package: true } }, landedCosts: true } }),
    db.expense.findMany({ where: { planId }, orderBy: { date: "desc" } }),
    db.expense.findMany({ where: { planId }, orderBy: { date: "desc" } }),
  ]);
  const payments = await db.vendorInvoice.findMany({ where: { OR: [{ po: { planId } }, { workOrderId: { in: plan.batches.flatMap((b) => b.workOrders.map((w) => w.id)) } }] } });
  const salesItems = await db.salesInvoiceItem.findMany({ where: { variant: { planId } }, include: { invoice: { include: { customer: true } } } });
  const costEntries = await db.costEntry.findMany({ where: { variant: { planId } }, orderBy: { date: "asc" } });
  const activities = await db.activityEvent.findMany({ where: { OR: [{ planId }, { batchId: { in: plan.batches.map((b) => b.id) } }] }, orderBy: { date: "desc" }, take: 200 });
  const auditLogs = await db.auditLog.findMany({ where: { OR: [{ entityId: planId }, { refNo: { startsWith: plan.code.split("-").slice(0, 2).join("-") } }] }, orderBy: { createdAt: "desc" }, take: 50 });
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
      case "colors": {
        const planId = String(body.planId);
        const colors = (body.colors ?? []) as { id?: string; name: string; hex?: string; fabricShade?: string; dyeLot?: string; active?: boolean }[];
        if (await db.productVariant.count({ where: { planId } })) return bad("Cannot replace colors after variants have been generated", 409);
        await db.matrixCell.deleteMany({ where: { planId } });
        await db.planColor.deleteMany({ where: { planId } });
        const created: unknown[] = [];
        for (const c of colors) {
          created.push(await db.planColor.create({ data: { planId, name: c.name, hex: c.hex ?? "#334155", fabricShade: c.fabricShade, dyeLot: c.dyeLot, active: c.active ?? true } }));
        }
        return ok(ser(created));
      }
      case "sizes": {
        const planId = String(body.planId);
        const sizes = (body.sizes ?? []) as { id?: string; name: string; measurements?: unknown; active?: boolean }[];
        if (await db.productVariant.count({ where: { planId } })) return bad("Cannot replace sizes after variants have been generated", 409);
        await db.matrixCell.deleteMany({ where: { planId } });
        await db.planSize.deleteMany({ where: { planId } });
        const created: unknown[] = [];
        for (const s of sizes) {
          created.push(await db.planSize.create({ data: { planId, name: s.name, measurementsJson: s.measurements ? JSON.stringify(s.measurements) : undefined, active: s.active ?? true } }));
        }
        return ok(ser(created));
      }
      case "matrix": {
        const planId = String(body.planId);
        const cells = (body.cells ?? []) as { colorId: string; sizeId: string; qty: number; enabled?: boolean }[];
        const plan = await db.productPlan.findUnique({ where: { id: planId }, include: { colors: true, sizes: true } });
        if (!plan) return bad("Plan not found", 404);
        await db.$transaction(async (tx) => {
          await tx.matrixCell.deleteMany({ where: { planId } });
          for (const c of cells) {
            if (!plan.colors.some(x => x.id === c.colorId && x.active) || !plan.sizes.some(x => x.id === c.sizeId && x.active)) throw new Error("Invalid matrix color or size");
            if (c.qty < 0 || !Number.isInteger(c.qty)) throw new Error("Matrix quantities must be non-negative integers");
            await tx.matrixCell.create({ data: { planId, colorId: c.colorId, sizeId: c.sizeId, qty: c.qty, enabled: c.enabled ?? true } });
          }
          const total = cells.filter(c => c.enabled !== false).reduce((a, c) => a + c.qty, 0);
          await logActivity(tx, { module: "PLANNING", action: "matrix_updated", description: `Production matrix updated — allocated ${total} of planned quantity`, userName: user.name, planId });
        });
        return ok({ saved: true, total: cells.filter(c => c.enabled !== false).reduce((a, c) => a + c.qty, 0) });
      }
      case "generate-variants": {
        const planId = String(body.planId);
        const result = await db.$transaction(async (tx) => {
          const plan = await tx.productPlan.findUnique({ where: { id: planId }, include: { colors: true, sizes: true, matrix: true } });
          if (!plan) throw new Error("Plan not found");
          const cells = plan.matrix.filter((m) => m.enabled && m.qty > 0);
          if (cells.length === 0) throw new Error("No allocated matrix cells with quantity");
          // SKU: PRD-0001-BLK-XL (color/size tokens)
          const token = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "GEN";
          const existing = await tx.productVariant.findMany({ where: { planId } });
          const existingByKey = new Map(existing.map((v) => [`${v.colorId}:${v.sizeId}`, v]));
          let seqNum = existing.length;
          const barcodes: string[] = [];
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
            seqNum += 1;
            const sku = `${plan.code}-${token(color.name)}-${token(size.name)}`;
            const barcode = `GF-${plan.code}-${cell.colorId}-${cell.sizeId}`;
            barcodes.push(sku);
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
      }
      case "status": {
        if (!PLAN_STATUSES.includes(body.status as typeof PLAN_STATUSES[number])) return bad("Unknown plan status");
        if (body.status === "APPROVED") return bad("Use the approval action to validate the matrix");
        if (["PROCUREMENT_IN_PROGRESS", "READY_FOR_PRODUCTION", "IN_PRODUCTION", "PARTIALLY_COMPLETED", "COMPLETED"].includes(String(body.status))) {
          const existing = await db.productPlan.findUnique({ where: { id: String(body.id) } });
          if (!existing?.approvedAt) return bad("Approve the plan first", 409);
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
            const plan = await tx.productPlan.findUnique({ where: { id: String(body.id) }, include: { matrix: true, variants: true } });
            if (!plan) throw new Error("Plan not found");
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
            const plan = await tx.productPlan.findUnique({ where: { id: String(body.id) }, include: { colors: true, sizes: true, matrix: true, variants: true } });
            if (!plan) throw new Error("Plan not found");
            const activeBatches = await tx.productionBatch.count({ where: { planId: plan.id, status: { in: ["IN_PROGRESS", "MATERIAL_RESERVED", "PARTIAL"] } } });
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
              data: { version: newVersion, status: "BUDGET_PLANNING", approvedAt: null, approvedById: null, plannedQty: Number(body.plannedQty ?? plan.plannedQty) },
            });
            await logAudit(tx, { userId: user.id, userName: user.name, action: "REVISE", entity: "ProductPlan", entityId: plan.id, refNo: plan.code, prevJson: snapshot, newJson: { version: newVersion, plannedQty: updated.plannedQty }, reason: String(body.reason ?? "") });
            await logActivity(tx, { module: "PLANNING", action: "plan_revised", description: `Plan ${plan.code} revised to v${newVersion}${activeBatches ? ` — ${activeBatches} active batch(es) unaffected` : ""}`, userName: user.name, planId: plan.id, refNo: plan.code });
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
        const planId = String(body.planId);
        const result = await db.$transaction(async (tx) => {
          const plan = await tx.productPlan.findUnique({ where: { id: planId }, include: { boms: true } });
          if (!plan) throw new Error("Plan not found");
          const approved = plan.boms.find((b) => b.status === "APPROVED");
          // editing an approved BOM creates a new version
          let bom = plan.boms.sort((a, b) => b.version - a.version)[0];
          if (bom && bom.status === "APPROVED") {
            bom = await tx.bOM.create({ data: { planId, version: bom.version + 1, status: "DRAFT", notes: `Revised from v${bom.version}` } });
          } else if (!bom) {
            bom = await tx.bOM.create({ data: { planId, version: 1, status: "DRAFT" } });
          }
          await tx.bOMItem.deleteMany({ where: { bomId: bom.id } });
          const items = (body.items ?? []) as { materialId: string; component?: string; qtyPerPiece: number; wastagePct?: number; estUnitCost?: number; sizeOverrides?: Record<string, number>; supplierId?: string }[];
          for (const it of items) {
            await tx.bOMItem.create({
              data: {
                bomId: bom.id, materialId: it.materialId, component: it.component ?? "MAIN",
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
            let estCost = 0;
            for (const it of items) {
              let per = it.qtyPerPiece;
              if (it.sizeOverrides && it.sizeOverrides[v.sizeName] != null) per = it.sizeOverrides[v.sizeName];
              estCost += per * (1 + (it.wastagePct ?? 0) / 100) * Number(it.estUnitCost ?? 0);
            }
            await tx.productVariant.update({ where: { id: v.id }, data: { estMaterialCost: D(Math.round(estCost * 100) / 100) } });
          }
          await logActivity(tx, { module: "PLANNING", action: "bom_saved", description: `BOM v${bom.version} saved (${items.length} items) for ${plan.code}`, userName: user.name, planId, refNo: plan.code });
          return { bomId: bom.id, version: bom.version, items: items.length };
        });
        return ok(result);
      }
      case "bom-approve": {
        const result = await db.$transaction(async (tx) => {
          const bom = await tx.bOM.update({ where: { id: String(body.id) }, data: { status: "APPROVED", approvedAt: new Date() } });
          await tx.productPlan.update({ where: { id: bom.planId }, data: { status: "MATERIAL_PLANNING" } });
          await logActivity(tx, { module: "PLANNING", action: "bom_approved", description: `BOM v${bom.version} approved`, userName: user.name, planId: bom.planId });
          return bom;
        });
        return ok(ser(result));
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
