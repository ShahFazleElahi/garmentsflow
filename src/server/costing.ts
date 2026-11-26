import { D, N, Tx } from "./core";
import { Prisma } from "@prisma/client";

/**
 * Costing engine — recomputes variant costs from the CostEntry ledger.
 * Cost levels:
 *  1. materialCost   — actual consumed materials (normal wastage included)
 *  2. serviceCost    — embroidery/tailoring/other service charges
 *  3. transportCost  — procurement + vendor + local logistics allocations
 *  4. otherCost      — packaging, customs, intl freight, other landed costs
 *  mfgCost = material + service (Dhaka manufacturing cost)
 *  landed = mfg + transport + other
 */
export async function recomputeVariantCosts(tx: Tx, variantIds: string[]) {
  if (variantIds.length === 0) return;
  const entries = await tx.costEntry.findMany({ where: { variantId: { in: variantIds } } });
  const serviceCats = new Set(["EMBROIDERY", "TAILORING", "CUTTING", "PRINTING", "WASHING", "FINISHING", "REWORK"]);
  const transportCats = new Set(["TRANSPORT", "LOCAL_SHIPMENT"]);
  const otherCats = new Set(["PACKAGING", "INTL_FREIGHT", "CUSTOMS", "DUTIES", "INSURANCE", "OTHER"]);

  const agg = new Map<string, { material: Prisma.Decimal; service: Prisma.Decimal; transport: Prisma.Decimal; other: Prisma.Decimal }>();
  for (const e of entries) {
    const cur = agg.get(e.variantId) ?? { material: new Prisma.Decimal(0), service: new Prisma.Decimal(0), transport: new Prisma.Decimal(0), other: new Prisma.Decimal(0) };
    const amt = D(e.amount);
    if (e.category === "MATERIAL") cur.material = cur.material.add(amt);
    else if (serviceCats.has(e.category)) cur.service = cur.service.add(amt);
    else if (transportCats.has(e.category)) cur.transport = cur.transport.add(amt);
    else if (otherCats.has(e.category)) cur.other = cur.other.add(amt);
    else cur.other = cur.other.add(amt);
    agg.set(e.variantId, cur);
  }

  for (const variantId of variantIds) {
    const a = agg.get(variantId) ?? { material: new Prisma.Decimal(0), service: new Prisma.Decimal(0), transport: new Prisma.Decimal(0), other: new Prisma.Decimal(0) };
    const existing = await tx.variantCost.findUnique({ where: { variantId } });
    const mfg = a.material.add(a.service);
    const landed = mfg.add(a.transport).add(a.other);
    const data = {
      materialCost: a.material.toDecimalPlaces(4),
      serviceCost: a.service.toDecimalPlaces(4),
      transportCost: a.transport.toDecimalPlaces(4),
      otherCost: a.other.toDecimalPlaces(4),
      mfgCost: mfg.toDecimalPlaces(4),
      landedCostBdt: landed.toDecimalPlaces(4),
      finalized: existing?.finalized ?? false,
    };
    if (existing) {
      if (existing.finalized) continue; // never silently change finalized costs
      await tx.variantCost.update({ where: { variantId }, data: { ...data, landedCostSylhet: landed.toDecimalPlaces(4) } });
    } else {
      await tx.variantCost.create({ data: { variantId, ...data } });
    }
  }
}

export async function addCostEntries(
  tx: Tx,
  rows: { variantId: string; batchId?: string | null; category: string; amount: number | Prisma.Decimal; refType?: string; refId?: string; refNo?: string; date?: Date; note?: string }[]
) {
  for (const r of rows) {
    if (D(r.amount).isZero()) continue;
    await tx.costEntry.create({
      data: {
        variantId: r.variantId, batchId: r.batchId ?? null, category: r.category,
        amount: D(r.amount).toDecimalPlaces(4), refType: r.refType, refId: r.refId,
        refNo: r.refNo, date: r.date ?? new Date(), note: r.note,
      },
    });
  }
  await recomputeVariantCosts(tx, [...new Set(rows.map((r) => r.variantId))]);
}

export async function finalizeVariantCosts(tx: Tx, planId: string, userId: string) {
  const variants = await tx.productVariant.findMany({ where: { planId } });
  const ids = variants.map((v) => v.id);
  // Block finalization while shipment discrepancies are open for related variants
  const openDiscrepancies = await tx.shipmentDiscrepancy.count({
    where: { variantId: { in: ids }, status: "OPEN" },
  });
  if (openDiscrepancies > 0) {
    throw new Error(`Cannot finalize costs: ${openDiscrepancies} unresolved shipment discrepancy record(s) exist for this plan's variants`);
  }
  const now = new Date();
  for (const id of ids) {
    await tx.variantCost.upsert({
      where: { variantId: id },
      update: { finalized: true, finalizedAt: now },
      create: { variantId: id, finalized: true, finalizedAt: now },
    });
  }
}
