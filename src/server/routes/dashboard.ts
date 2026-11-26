import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, qDate, q } from "./helpers";
import { NextRequest } from "next/server";
import { refreshAlerts } from "../notify";

export async function handleGet(segments: string[], req: NextRequest) {
  const [resource] = segments;
  const auth = await requirePerm(req, "view");
  if ("error" in auth) return auth.error;
  const { user } = auth;

  if (resource === "dashboard") {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      activePlans, planAgg, batchAgg, batchCount,
      todayPurchases, todayExpenses, monthExpenses,
      materialStocks, reservations,
      woAgg, finishedStocks, packagesAgg, shipments,
      expensesAgg, salesAgg, cogsAgg, cashAccounts,
      vendorInvoices, plansAll, batchesAll,
    ] = await Promise.all([
      db.productPlan.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
      db.productPlan.aggregate({ _sum: { plannedQty: true, estimatedBudget: true } }),
      db.productPlan.aggregate({ where: { status: { in: ["APPROVED", "PROCUREMENT_IN_PROGRESS", "READY_FOR_PRODUCTION", "IN_PRODUCTION", "PARTIALLY_COMPLETED", "COMPLETED"] } }, _sum: { plannedQty: true } }),
      db.productionBatch.count(),
      db.purchaseOrder.aggregate({ where: { orderDate: { gte: todayStart } }, _sum: { total: true } }),
      db.expense.aggregate({ where: { date: { gte: todayStart } }, _sum: { amount: true } }),
      db.expense.aggregate({ where: { date: { gte: monthStart } }, _sum: { amount: true } }),
      db.materialStock.findMany({ include: { material: true, warehouse: true } }),
      db.inventoryReservation.aggregate({ where: { status: "ACTIVE" }, _sum: { qty: true } }),
      db.workOrder.aggregate({
        where: { type: "EMBROIDERY" },
        _sum: { issuedQty: true, acceptedQty: true },
      }),
      db.finishedStock.findMany({ include: { warehouse: true, variant: true } }),
      db.package.aggregate({ where: { status: { in: ["PACKED", "DISPATCHED", "IN_TRANSIT"] } }, _sum: { packagingCost: true } }),
      db.shipment.findMany({ select: { status: true, type: true, totalCostBdt: true, dispatchDate: true, expectedArrival: true, code: true, id: true } }),
      db.expense.aggregate({ _sum: { amount: true } }),
      db.salesInvoice.findMany({ select: { total: true, cogs: true, exchangeRate: true, invoiceDate: true } }),
      db.salesInvoice.aggregate({ _sum: { cogs: true } }),
      db.account.findMany({ where: { type: { in: ["CASH", "BANK", "MOBILE_BANKING"] } } }),
      db.vendorInvoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { partner: true } }),
      db.productPlan.findMany({ include: { variants: true, batches: { include: { variants: true } }, collection: true, category: true }, orderBy: { createdAt: "desc" } }),
      db.productionBatch.findMany({ include: { variants: true, workOrders: true, plan: true } }),
    ]);

    const mainStocks = materialStocks.filter((s) => s.warehouse.type === "MAIN");
    const vendorStocks = materialStocks.filter((s) => s.warehouse.type === "VENDOR_CUSTODY");
    const availableMaterial = mainStocks.reduce((a, s) => a + Math.max(0, Number(s.qty) - Number(s.reservedQty)), 0);
    const materialValuation = mainStocks.reduce((a, s) => a + Number(s.qty) * Number(s.avgCost), 0);
    const reservedMaterial = mainStocks.reduce((a, s) => a + Number(s.reservedQty), 0);
    const factoryStock = vendorStocks.filter((s) => s.warehouse.name.toLowerCase().includes("factory") || s.warehouse.name.toLowerCase().includes("embroidery"));
    const tailorStock = vendorStocks.filter((s) => s.warehouse.name.toLowerCase().includes("tailor"));

    // tailoring WOs
    const woTailoring = await db.workOrder.aggregate({ where: { type: "TAILORING" }, _sum: { issuedQty: true, acceptedQty: true } });

    const finishedByWh = new Map<string, number>();
    for (const s of finishedStocks) finishedByWh.set(s.warehouseId, (finishedByWh.get(s.warehouseId) ?? 0) + s.qty);
    const finishedTotal = finishedStocks.filter((s) => s.warehouse.type === "MAIN").reduce((a, s) => a + s.qty, 0);
    const packedTotal = finishedStocks.reduce((a, s) => a + s.reservedQty, 0);

    const outstandingSupplier = vendorInvoices.filter(v => v.partner.type === "SUPPLIER").reduce((a, v) => a + Number(v.amount) - Number(v.paidAmount), 0);

    // location stocks
    const warehouses = await db.warehouse.findMany({ include: { location: true } });
    const locStock: Record<string, number> = {};
    for (const s of finishedStocks) {
      const wh = warehouses.find((w) => w.id === s.warehouseId);
      if (!wh) continue;
      locStock[wh.location.name] = (locStock[wh.location.name] ?? 0) + s.qty;
    }

    // Charts data
    // 1. Production pipeline — per plan status counts & qty
    const pipeline = ["APPROVED", "PROCUREMENT_IN_PROGRESS", "READY_FOR_PRODUCTION", "IN_PRODUCTION", "PARTIALLY_COMPLETED", "COMPLETED"].map((st) => ({
      status: st.replaceAll("_", " "), qty: plansAll.filter((p) => p.status === st).reduce((a, p) => a + p.plannedQty, 0),
    }));
    // 2. Daily expenses last 14 days
    const since = new Date(now.getTime() - 13 * 24 * 3600 * 1000);
    const expensesRecent = await db.expense.findMany({ where: { date: { gte: since } }, select: { date: true, amount: true } });
    const dailyExpenses: { day: string; amount: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(since.getTime() + i * 24 * 3600 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyExpenses.push({ day: key.slice(5), amount: expensesRecent.filter((e) => e.date.toISOString().slice(0, 10) === key).reduce((a, e) => a + Number(e.amount), 0) });
    }
    // 3. planned vs actual per plan
    const plannedVsActual = plansAll.slice(0, 8).map((p) => ({
      name: p.code.replace(/^PRD-\d+-/, ""), planned: p.plannedQty,
      actual: p.batches.reduce((a, b) => a + b.variants.reduce((x, bv) => x + bv.completedQty, 0), 0),
    }));
    // 4. color-wise production
    const colorAgg = new Map<string, number>();
    for (const p of plansAll) for (const v of p.variants) colorAgg.set(v.colorName, (colorAgg.get(v.colorName) ?? 0) + v.producedQty);
    const colorWise = [...colorAgg.entries()].map(([name, qty]) => ({ name, qty }));
    // 5. size-wise production
    const sizeAgg = new Map<string, number>();
    for (const p of plansAll) for (const v of p.variants) sizeAgg.set(v.sizeName, (sizeAgg.get(v.sizeName) ?? 0) + v.producedQty);
    const sizeWise = [...sizeAgg.entries()].map(([name, qty]) => ({ name, qty }));
    // 6. location-wise inventory
    const locationWise = [...Object.entries(locStock)].map(([name, qty]) => ({ name, qty }));
    // 7. shipment status
    const shipStatus = new Map<string, number>();
    for (const s of shipments) shipStatus.set(s.status.replaceAll("_", " "), (shipStatus.get(s.status.replaceAll("_", " ")) ?? 0) + 1);
    const shipmentStatus = [...shipStatus.entries()].map(([name, count]) => ({ name, count }));
    // 8. vendor performance (top 6 by order value)
    const wos = await db.workOrder.findMany({ include: { partner: true, receipts: true } });
    const vendorAgg = new Map<string, { orders: number; issued: number; accepted: number; delayed: number }>();
    for (const wo of wos) {
      const cur = vendorAgg.get(wo.partner.name) ?? { orders: 0, issued: 0, accepted: 0, delayed: 0 };
      cur.orders += 1; cur.issued += wo.issuedQty; cur.accepted += wo.acceptedQty;
      if (wo.expectedDate && wo.expectedDate < now && !["COMPLETED", "CANCELLED"].includes(wo.status)) cur.delayed += 1;
      vendorAgg.set(wo.partner.name, cur);
    }
    const vendorPerf = [...vendorAgg.entries()].slice(0, 6).map(([name, v]) => ({ name, fillRate: v.issued > 0 ? Math.round((v.accepted / v.issued) * 100) : 0, orders: v.orders, delayed: v.delayed }));
    // 9. revenue vs cost monthly
    const salesAll = await db.salesInvoice.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { invoiceDate: "asc" } });
    const monthAgg = new Map<string, { revenue: number; cogs: number }>();
    let totalRevenueBdt = 0, totalCogsBdt = 0;
    for (const s of salesAll) {
      const revenueBdt = Number(s.total) * Number(s.exchangeRate);
      totalRevenueBdt += revenueBdt; totalCogsBdt += Number(s.cogs);
      const key = s.invoiceDate.toISOString().slice(0, 7);
      const cur = monthAgg.get(key) ?? { revenue: 0, cogs: 0 };
      cur.revenue += revenueBdt; cur.cogs += Number(s.cogs);
      monthAgg.set(key, cur);
    }
    const revenueProfit = [...monthAgg.entries()].map(([month, v]) => ({ month, revenue: v.revenue, cogs: v.cogs, profit: v.revenue - v.cogs }));

    // calendar: upcoming deadlines
    const calendarItems = [
      ...batchesAll.filter((b) => b.expectedCompletionDate && !["COMPLETED", "CANCELLED"].includes(b.status)).map((b) => ({ date: b.expectedCompletionDate!, label: `Batch due: ${b.code}`, type: "PRODUCTION", ref: b.code })),
      ...(await db.workOrder.findMany({ where: { expectedDate: { not: null }, status: { notIn: ["COMPLETED", "CANCELLED"] } }, include: { partner: true } })).map((w) => ({ date: w.expectedDate!, label: `${w.type} due: ${w.code}`, type: "WORK_ORDER", ref: w.code })),
      ...(await db.shipment.findMany({ where: { expectedArrival: { not: null }, status: { in: ["DISPATCHED", "IN_TRANSIT", "READY", "DELAYED"] } } })).map((s) => ({ date: s.expectedArrival!, label: `Shipment arrival: ${s.code}`, type: "SHIPMENT", ref: s.code })),
      ...(await db.purchaseOrder.findMany({ where: { expectedDate: { not: null }, status: { in: ["ORDERED", "PARTIAL"] } }, include: { supplier: true } })).map((p) => ({ date: p.expectedDate!, label: `PO delivery: ${p.code}`, type: "PURCHASE", ref: p.code })),
    ].slice(0, 60);

    const overdue = [
      ...batchesAll.filter((b) => b.expectedCompletionDate && b.expectedCompletionDate < now && !["COMPLETED", "CANCELLED"].includes(b.status)).map((b) => ({ label: `Batch ${b.code} overdue (${b.plan.name})`, ref: b.code })),
      ...(await db.workOrder.findMany({ where: { expectedDate: { lt: now }, status: { in: ["DISPATCHED", "IN_PROGRESS", "PARTIALLY_COMPLETED", "READY_FOR_COLLECTION", "RECEIVED_BY_FACTORY"] } }, include: { partner: true } })).map((w) => ({ label: `${w.code} overdue at ${w.partner.name}`, ref: w.code })),
    ];

    const recentActivity = await db.activityEvent.findMany({ orderBy: { date: "desc" }, take: 15 });

    const avgCostPerProduct = finishedTotal > 0
      ? finishedStocks.filter((s) => s.warehouse.type === "MAIN").reduce((a, s) => a + Number(s.unitCost) * s.qty, 0) / finishedTotal
      : 0;

    return ok(ser({
      kpis: {
        activePlans,
        plannedQty: Number(planAgg._sum.plannedQty ?? 0),
        approvedQty: Number(batchAgg._sum.plannedQty ?? 0),
        productionBatches: batchCount,
        todayPurchases: Number(todayPurchases._sum.total ?? 0),
        todayExpenses: Number(todayExpenses._sum.amount ?? 0),
        monthExpenses: Number(monthExpenses._sum.amount ?? 0),
        availableMaterial: Math.round(availableMaterial * 1000) / 1000,
        materialValuation: Math.round(materialValuation),
        reservedMaterial: Math.round(reservedMaterial * 1000) / 1000,
        materialsAtFactories: Math.round(factoryStock.reduce((a, s) => a + Number(s.qty), 0) * 1000) / 1000,
        materialsAtTailors: Math.round(tailorStock.reduce((a, s) => a + Number(s.qty), 0) * 1000) / 1000,
        underEmbroidery: Number(woAgg._sum.issuedQty ?? 0) - Number(woAgg._sum.acceptedQty ?? 0),
        underTailoring: Number(woTailoring._sum.issuedQty ?? 0) - Number(woTailoring._sum.acceptedQty ?? 0),
        awaitingQC: await db.workOrder.count({ where: { status: "AWAITING_QC" } }),
        reworkRequired: await db.workOrder.count({ where: { status: "REWORK_REQUIRED" } }),
        finishedProducts: finishedTotal,
        readyForDispatch: finishedTotal - packedTotal,
        packedProducts: packedTotal,
        inTransit: shipments.filter((s) => ["DISPATCHED", "IN_TRANSIT"].includes(s.status)).length,
        dhakaStock: locStock["Dhaka"] ?? 0,
        sylhetStock: locStock["Sylhet"] ?? 0,
        ukStock: locStock["United Kingdom"] ?? 0,
        estimatedBudget: Number(planAgg._sum.estimatedBudget ?? 0),
        actualProductionCost: Math.round(Number((await db.costEntry.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0)),
        budgetVariance: Math.round(Number(planAgg._sum.estimatedBudget ?? 0) - Number((await db.costEntry.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0)),
        avgCostPerProduct: Math.round(avgCostPerProduct * 100) / 100,
        outstandingSupplier: Math.round(outstandingSupplier),
        outstandingFactories: Math.round(vendorInvoices.filter((v) => v.partner.type === "EMBROIDERY_FACTORY" || v.partner.type === "PROCESSING").reduce((a, v) => a + Number(v.amount) - Number(v.paidAmount), 0)),
        outstandingTailors: Math.round(vendorInvoices.filter((v) => v.partner.type === "TAILOR").reduce((a, v) => a + Number(v.amount) - Number(v.paidAmount), 0)),
        cashBank: Math.round(cashAccounts.reduce((a, c) => a + Number(c.balance), 0)),
        transportExpenses: Math.round(Number((await db.transportationExpense.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0)),
        salesRevenue: Math.round(totalRevenueBdt),
        grossProfit: Math.round(totalRevenueBdt - totalCogsBdt),
      },
      charts: {
        pipeline, dailyExpenses, plannedVsActual, colorWise, sizeWise,
        locationWise, shipmentStatus, vendorPerf, revenueProfit,
      },
      calendar: calendarItems,
      overdue,
      recentActivity,
      approvedQty: Number(batchAgg._sum.plannedQty ?? 0),
    }));
  }

  if (resource === "daily-ops") {
    const date = qDate(req, "date") ?? new Date();
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const inRange = (d: Date | null | undefined) => d && d >= dayStart && d < dayEnd;
    const [purchases, expenses, receipts, woDispatched, woReceived, inspections, sales, payments] = await Promise.all([
      db.purchaseOrder.findMany({ where: { orderDate: { gte: dayStart, lt: dayEnd } }, include: { supplier: true } }),
      db.expense.findMany({ where: { date: { gte: dayStart, lt: dayEnd } } }),
      db.materialReceipt.findMany({ where: { receiptDate: { gte: dayStart, lt: dayEnd } }, include: { items: true, po: true } }),
      db.workOrder.findMany({ where: { dispatchDate: { gte: dayStart, lt: dayEnd } }, include: { partner: true } }),
      db.workOrderReceipt.findMany({ where: { receiptDate: { gte: dayStart, lt: dayEnd } }, include: { workOrder: { include: { partner: true } } } }),
      db.qualityInspection.findMany({ where: { inspectionDate: { gte: dayStart, lt: dayEnd } } }),
      db.salesInvoice.findMany({ where: { invoiceDate: { gte: dayStart, lt: dayEnd } }, include: { customer: true } }),
      db.payment.findMany({ where: { date: { gte: dayStart, lt: dayEnd } } }),
    ]);
    const shipmentsDispatched = await db.shipment.findMany({ where: { dispatchDate: { gte: dayStart, lt: dayEnd } } });
    const shipmentsReceived = await db.shipmentReceipt.findMany({ where: { receiptDate: { gte: dayStart, lt: dayEnd } } });
    const activity = await db.activityEvent.findMany({ where: { date: { gte: dayStart, lt: dayEnd } }, orderBy: { date: "desc" } });

    // daily closing summary
    const cashMovements = await db.journalEntry.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
      include: { lines: { include: { account: true } } },
    });
    let cashIn = 0, cashOut = 0;
    for (const je of cashMovements) {
      for (const l of je.lines) {
        if (["CASH", "BANK", "MOBILE_BANKING"].includes(l.account.type)) {
          if (Number(l.debit) > 0) cashIn += Number(l.debit);
          if (Number(l.credit) > 0) cashOut += Number(l.credit);
        }
      }
    }
    const exceptions = activity.filter((a) => a.description.toLowerCase().includes("discrepanc") || a.description.toLowerCase().includes("wastage") || a.description.toLowerCase().includes("reject"));

    return ok(ser({
      date: dayStart,
      purchases: purchases.map((p) => ({ code: p.code, supplier: p.supplier.name, total: Number(p.total) })),
      expenses: expenses.map((e) => ({ code: e.code, category: e.category, description: e.description, amount: Number(e.amount) })),
      materialReceipts: receipts.map((r) => ({ code: r.code, items: r.items.length })),
      factoryDispatches: woDispatched.filter((w) => w.type === "EMBROIDERY").map((w) => ({ code: w.code, partner: w.partner.name, qty: w.issuedQty })),
      factoryCollections: woReceived.filter((r) => r.workOrder.type === "EMBROIDERY").map((r) => ({ code: r.workOrder.code, partner: r.workOrder.partner.name, received: r.receivedQty })),
      tailoringDispatches: woDispatched.filter((w) => w.type === "TAILORING").map((w) => ({ code: w.code, partner: w.partner.name, qty: w.issuedQty })),
      tailoringCollections: woReceived.filter((r) => r.workOrder.type === "TAILORING").map((r) => ({ code: r.workOrder.code, partner: r.workOrder.partner.name, received: r.receivedQty })),
      inspections: inspections.map((i) => ({ code: i.code, status: i.status, passed: i.passedQty, rejected: i.rejectedQty })),
      shipments: shipmentsDispatched.map((s) => ({ code: s.code, type: s.type, status: s.status })),
      receivedShipments: shipmentsReceived.map((r) => ({ code: r.code, boxes: r.boxesReceived })),
      payments: payments.map((p) => ({ code: p.code, direction: p.direction, amount: Number(p.amount), method: p.method })),
      sales: sales.map((s) => ({ code: s.code, customer: s.customer.name, total: Number(s.total) })),
      activity,
      closing: { cashIn: Math.round(cashIn), cashOut: Math.round(cashOut), net: Math.round(cashIn - cashOut), exceptionCount: exceptions.length },
      totals: {
        purchases: purchases.reduce((a, p) => a + Number(p.total), 0),
        expenses: expenses.reduce((a, e) => a + Number(e.amount), 0),
        sales: sales.reduce((a, s) => a + Number(s.total), 0),
      },
    }));
  }

  return bad(`Unknown dashboard resource: ${resource}`, 404);
}
