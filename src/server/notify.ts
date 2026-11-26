import { db } from "@/lib/db";

/**
 * On-demand alert generation — no background process required.
 * Called when the notifications API is queried; regenerates the alert set
 * from live data, then merges read-state.
 */
export async function refreshAlerts() {
  const now = new Date();
  const alerts: { type: string; severity: string; title: string; message: string; link: string; key: string }[] = [];

  // Low stock / reorder
  const materials = await db.material.findMany({
    where: { isActive: true },
    include: { stocks: { include: { warehouse: true } } },
  });
  for (const m of materials) {
    const main = m.stocks.filter((s) => s.warehouse.type === "MAIN");
    const qty = main.reduce((a, s) => a + Number(s.qty), 0);
    const reserved = main.reduce((a, s) => a + Number(s.reservedQty), 0);
    const reorder = Number(m.reorderLevel);
    if (reorder > 0 && qty <= reorder) {
      alerts.push({
        type: "LOW_STOCK", severity: qty <= Number(m.minStock) ? "DANGER" : "WARNING",
        title: `Low stock: ${m.name}`,
        message: `Available ${qty - reserved} ${m.baseUnit} (reorder level ${reorder}). Total on hand ${qty}.`,
        link: "inventory", key: `LOW_STOCK:${m.id}:${qty}`,
      });
    }
  }

  // Overdue work orders
  const overdueWOs = await db.workOrder.findMany({
    where: { expectedDate: { lt: now }, status: { in: ["DISPATCHED", "RECEIVED_BY_FACTORY", "IN_PROGRESS", "PARTIALLY_COMPLETED", "READY_FOR_COLLECTION", "PARTIALLY_COLLECTED"] } },
    include: { partner: true },
    take: 50,
  });
  for (const wo of overdueWOs) {
    alerts.push({
      type: "OVERDUE_WO", severity: "DANGER",
      title: `Overdue ${wo.type.toLowerCase()} order ${wo.code}`,
      message: `${wo.partner.name} — expected ${wo.expectedDate?.toISOString().slice(0, 10)}; still ${wo.status.replaceAll("_", " ").toLowerCase()}.`,
      link: "production-workorders", key: `OVERDUE_WO:${wo.id}`,
    });
  }

  // Unapproved plans in late stages
  const unapproved = await db.productPlan.findMany({
    where: { status: { in: ["BUDGET_PLANNING", "AWAITING_APPROVAL"] } }, take: 20,
  });
  for (const p of unapproved) {
    alerts.push({
      type: "UNAPPROVED_PLAN", severity: "WARNING",
      title: `Plan ${p.code} awaiting approval`,
      message: `${p.name} — ${p.plannedQty} ${p.unit.toLowerCase()}(s). Approve to unlock procurement and production.`,
      link: `plans`, key: `UNAPPROVED_PLAN:${p.id}`,
    });
  }

  // Pending quality inspections (work orders awaiting QC)
  const awaitQc = await db.workOrder.count({ where: { status: "AWAITING_QC" } });
  if (awaitQc > 0) {
    alerts.push({
      type: "PENDING_QC", severity: "INFO",
      title: `${awaitQc} work order(s) awaiting quality control`,
      message: "Record inspections to release products into finished goods.",
      link: "quality", key: `PENDING_QC:${awaitQc}`,
    });
  }

  // Finished products ready for dispatch
  const readyStock = await db.finishedStock.findMany({
    where: { qty: { gt: 0 }, warehouse: { type: "MAIN" } },
    include: { warehouse: true }, take: 100,
  });
  const readyQty = readyStock.reduce((a, s) => a + (s.qty - s.reservedQty), 0);
  if (readyQty > 0) {
    alerts.push({
      type: "READY_DISPATCH", severity: "INFO",
      title: `${readyQty} finished product(s) ready for dispatch`,
      message: "Available (unreserved) finished stock across warehouses.",
      link: "finished-goods", key: `READY_DISPATCH:${readyQty}`,
    });
  }

  // Delayed shipments
  const delayed = await db.shipment.findMany({
    where: { expectedArrival: { lt: now }, status: { in: ["DISPATCHED", "IN_TRANSIT", "DELAYED"] } }, take: 20,
  });
  for (const s of delayed) {
    alerts.push({
      type: "DELAYED_SHIPMENT", severity: "DANGER",
      title: `Shipment ${s.code} overdue`,
      message: `Expected arrival ${s.expectedArrival?.toISOString().slice(0, 10)} — status ${s.status.replaceAll("_", " ").toLowerCase()}.`,
      link: "logistics", key: `DELAYED_SHIPMENT:${s.id}`,
    });
  }

  // Open discrepancies
  const openDisc = await db.shipmentDiscrepancy.count({ where: { status: "OPEN" } });
  if (openDisc > 0) {
    alerts.push({
      type: "DISCREPANCY", severity: "DANGER",
      title: `${openDisc} shipment discrepancy record(s) open`,
      message: "Missing or damaged products must be recovered, claimed, or written off.",
      link: "logistics", key: `DISCREPANCY:${openDisc}`,
    });
  }

  // Outstanding vendor invoices
  const openInvoices = await db.vendorInvoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, take: 100 });
  const outstanding = openInvoices.reduce((a, v) => a + (Number(v.amount) - Number(v.paidAmount)), 0);
  if (outstanding > 0) {
    alerts.push({
      type: "OUTSTANDING_PAYABLE", severity: "WARNING",
      title: `Outstanding vendor payables: ৳${Math.round(outstanding).toLocaleString()}`,
      message: `${openInvoices.length} open vendor invoice(s).`,
      link: "finance-invoices", key: `OUTSTANDING:${Math.round(outstanding)}`,
    });
  }

  // Budget overruns: plans where actual expenses > estimated budget
  const plans = await db.productPlan.findMany({ where: { status: { in: ["IN_PRODUCTION", "PARTIALLY_COMPLETED", "PROCUREMENT_IN_PROGRESS"] } } });
  for (const p of plans) {
    const [expenses, serviceCost] = await Promise.all([
      db.expense.aggregate({ where: { planId: p.id }, _sum: { amount: true } }),
      db.costEntry.aggregate({
        where: { variant: { planId: p.id }, category: { in: ["EMBROIDERY", "TAILORING", "CUTTING", "PRINTING", "WASHING", "FINISHING"] } },
        _sum: { amount: true },
      }),
    ]);
    const actual = Number(expenses._sum.amount ?? 0) + Number(serviceCost._sum.amount ?? 0);
    if (Number(p.estimatedBudget) > 0 && actual > Number(p.estimatedBudget)) {
      alerts.push({
        type: "BUDGET_OVERRUN", severity: "DANGER",
        title: `Budget overrun: ${p.code}`,
        message: `Actual ৳${Math.round(actual).toLocaleString()} exceeds estimated ৳${Number(p.estimatedBudget).toLocaleString()}.`,
        link: "plans", key: `BUDGET:${p.id}:${Math.round(actual)}`,
      });
    }
  }

  // Unreconciled materials (work orders completed with remaining vendor custody)
  const unreconciled = await db.workOrderMaterial.count({
    where: { workOrder: { status: "COMPLETED" }, remainingQty: { gt: 0 } },
  });
  if (unreconciled > 0) {
    alerts.push({
      type: "UNRECONCILED", severity: "WARNING",
      title: `${unreconciled} material line(s) still in vendor custody`,
      message: "Completed work orders with materials remaining at vendors — collect or write off.",
      link: "production-workorders", key: `UNRECONCILED:${unreconciled}`,
    });
  }

  // Merge with existing notifications by key (idempotent)
  const existing = await db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  const existingKeys = new Set(existing.map((n) => `${n.type}:${n.message}`));
  for (const a of alerts) {
    const msgKey = `${a.type}:${a.message}`;
    if (existingKeys.has(msgKey)) continue;
    await db.notification.create({
      data: { type: a.type, severity: a.severity, title: a.title, message: a.message, link: a.link },
    });
  }
  // Clean stale alerts of generated types that no longer apply
  const generatedTypes = new Set(alerts.map((a) => a.type));
  const currentKeys = new Set(alerts.map((a) => `${a.type}:${a.message}`));
  for (const n of existing) {
    if (generatedTypes.has(n.type) && !currentKeys.has(`${n.type}:${n.message}`)) {
      await db.notification.delete({ where: { id: n.id } });
    }
  }
  return db.notification.findMany({ orderBy: [{ isRead: "asc" }, { createdAt: "desc" }], take: 100 });
}
