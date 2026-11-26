import { Prisma as ProfitPrisma } from "@prisma/client";
import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, q } from "./helpers";
import { NextRequest } from "next/server";
import { N } from "../core";
import { can, scopedLocations } from "../auth";

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const raw = v == null ? "" : String(v);
    const s = typeof v === "string" && /^[\s]*[=+\-@]/.test(raw) ? "'" + raw : raw;
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export async function handleGet(segments: string[], req: NextRequest) {
  const [resource] = segments;
  const financialReport = resource && (resource.startsWith("financial") || resource.startsWith("costing") ||
    ["profitability", "inventory-valuation", "procurement", "material-consumption", "vendor-custody", "production", "logistics"].includes(resource));
  const auth = await requirePerm(req, financialReport ? "view_financial" : "view");
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const locations = scopedLocations(user);
  if (locations && financialReport && !["profitability", "inventory-valuation", "procurement"].includes(resource)) {
    return bad("This financial report requires unrestricted location access", 403);
  }
  const format = q(req, "format");
  const planId = q(req, "planId");
  const partnerId = q(req, "partnerId");
  const batchId = q(req, "batchId");
  const locationId = q(req, "locationId");

  let rows: Record<string, unknown>[] = [];

  switch (resource) {
    case "plan-summary": {
      const plans = await db.productPlan.findMany({
        where: planId ? { id: planId } : undefined,
        include: { category: true, collection: true, variants: true, batches: { include: { variants: true } } },
        orderBy: { createdAt: "desc" },
      });
      rows = plans.map((p) => ({
        code: p.code, name: p.name, category: p.category?.name ?? "", collection: p.collection?.name ?? "",
        status: p.status, plannedQty: p.plannedQty, variants: p.variants.length,
        produced: p.variants.reduce((a, v) => a + v.producedQty, 0),
        batched: p.batches.reduce((a, b) => a + b.plannedQty, 0),
        ...(can(user, "view_financial") && !locations ? { estimatedBudget: Number(p.estimatedBudget) } : {}), version: p.version,
      }));
      break;
    }
    case "procurement": {
      const pos = await db.purchaseOrder.findMany({
        where: { supplierId: partnerId ?? undefined, locationId: locations ? { in: locations } : undefined },
        include: { supplier: true, items: { include: { material: true } } },
        orderBy: { orderDate: "desc" },
      });
      rows = pos.map((p) => ({
        code: p.code, date: p.orderDate.toISOString().slice(0, 10), supplier: p.supplier.name,
        type: p.type, status: p.status, lines: p.items.length,
        total: Number(p.total), paid: Number(p.paidAmount), outstanding: Number(p.total) - Number(p.paidAmount),
      }));
      break;
    }
    case "inventory-valuation": {
      const stocks = await db.materialStock.findMany({
        where: locations ? { warehouse: { locationId: { in: locations } } } : undefined,
        include: { material: { include: { category: true } }, warehouse: { include: { location: true } } },
      });
      rows = stocks.map((s) => ({
        material: s.material.name, sku: s.material.sku, category: s.material.category?.name ?? "",
        warehouse: s.warehouse.name, location: s.warehouse.location.name,
        qty: Number(s.qty), reserved: Number(s.reservedQty), avgCost: Number(s.avgCost),
        value: Number(s.qty) * Number(s.avgCost),
      }));
      break;
    }
    case "material-consumption": {
      const movements = await db.inventoryMovement.findMany({
        where: { type: { in: ["VENDOR_CONSUME", "WASTAGE"] }, ...(planId ? {} : {}) },
        include: { material: true, from: { include: { location: { include: { partner: true } } } } },
        orderBy: { movementDate: "desc" }, take: 500,
      });
      rows = movements.map((m) => ({
        date: m.movementDate.toISOString().slice(0, 10), material: m.material.name,
        type: m.type, vendor: m.from?.location?.partner?.name ?? m.from?.name ?? "", qty: Number(m.qty),
        unitCost: Number(m.unitCost), value: Number(m.value), ref: m.refNo ?? "",
      }));
      break;
    }
    case "vendor-custody": {
      const stocks = await db.materialStock.findMany({
        where: { warehouse: { type: "VENDOR_CUSTODY" } },
        include: { material: true, warehouse: { include: { location: { include: { partner: true } } } } },
      });
      rows = stocks.map((s) => ({
        vendor: s.warehouse.location.partner?.name ?? s.warehouse.name, material: s.material.name,
        sku: s.material.sku, qty: Number(s.qty), avgCost: Number(s.avgCost),
        value: Number(s.qty) * Number(s.avgCost),
      }));
      break;
    }
    case "production": {
      const batches = await db.productionBatch.findMany({
        where: batchId ? { id: batchId } : undefined,
        include: { plan: true, variants: { include: { variant: true } }, workOrders: { include: { partner: true, receipts: true } } },
        orderBy: { createdAt: "desc" },
      });
      rows = batches.map((b) => ({
        code: b.code, plan: b.plan.name, status: b.status, planned: b.plannedQty,
        completed: b.variants.reduce((a, v) => a + v.completedQty, 0),
        workOrders: b.workOrders.length,
        issued: b.workOrders.reduce((a, w) => a + w.issuedQty, 0),
        accepted: b.workOrders.reduce((a, w) => a + w.acceptedQty, 0),
        serviceCost: b.workOrders.reduce((a, w) => a + Number(w.actualServiceCost), 0),
      }));
      break;
    }
    case "quality": {
      const ins = await db.qualityInspection.findMany({
        include: { workOrder: { include: { partner: true } }, batch: { include: { plan: true } } },
        orderBy: { inspectionDate: "desc" },
      });
      rows = ins.map((i) => ({
        code: i.code, date: i.inspectionDate.toISOString().slice(0, 10), type: i.type,
        vendor: i.workOrder?.partner?.name ?? "", plan: i.batch?.plan?.name ?? "",
        inspected: i.inspectedQty, passed: i.passedQty, rework: i.reworkQty,
        rejected: i.rejectedQty, damaged: i.damagedQty, status: i.status,
        defectRate: i.inspectedQty > 0 ? Math.round(((i.rejectedQty + i.damagedQty + i.reworkQty) / i.inspectedQty) * 100) : 0,
      }));
      break;
    }
    case "vendor-performance": {
      const wos = await db.workOrder.findMany({ include: { partner: true, receipts: true } });
      const agg = new Map<string, { orders: number; issued: number; accepted: number; rejected: number; damaged: number; missing: number; delayed: number; serviceCost: number; onTime: number }>();
      const now = new Date();
      for (const w of wos) {
        const cur = agg.get(w.partner.name) ?? { orders: 0, issued: 0, accepted: 0, rejected: 0, damaged: 0, missing: 0, delayed: 0, serviceCost: 0, onTime: 0 };
        cur.orders += 1; cur.issued += w.issuedQty; cur.accepted += w.acceptedQty;
        cur.rejected += w.rejectedQty; cur.damaged += w.damagedQty; cur.missing += w.missingQty;
        cur.serviceCost += Number(w.actualServiceCost);
        if (w.expectedDate && w.expectedDate < now && !["COMPLETED", "CANCELLED"].includes(w.status)) cur.delayed += 1;
        if (w.status === "COMPLETED" && (!w.expectedDate || (w.receipts[0]?.receiptDate ?? new Date()) <= w.expectedDate)) cur.onTime += 1;
        agg.set(w.partner.name, cur);
      }
      rows = [...agg.entries()].map(([name, v]) => ({
        vendor: name, orders: v.orders, issued: v.issued, accepted: v.accepted,
        fillRate: v.issued > 0 ? Math.round((v.accepted / v.issued) * 100) : 0,
        rejected: v.rejected, damaged: v.damaged, missing: v.missing, delayed: v.delayed,
        onTimeRate: v.orders > 0 ? Math.round((v.onTime / v.orders) * 100) : 0,
        serviceCost: Math.round(v.serviceCost),
      }));
      break;
    }
    case "logistics": {
      const shipments = await db.shipment.findMany({
        where: locationId ? { destLocationId: locationId } : undefined,
        include: { packages: { include: { package: { include: { items: true } } } }, receipts: true, discrepancies: true },
        orderBy: { createdAt: "desc" },
      });
      rows = shipments.map((s) => ({
        code: s.code, type: s.type, status: s.status, boxes: s.packages.length,
        pieces: s.packages.reduce((a, sp) => a + sp.package.items.reduce((x, i) => x + i.qty, 0), 0),
        cost: Number(s.totalCostBdt), dispatchDate: s.dispatchDate?.toISOString().slice(0, 10) ?? "",
        arrival: s.actualArrival?.toISOString().slice(0, 10) ?? s.expectedArrival?.toISOString().slice(0, 10) ?? "",
        discrepancies: s.discrepancies.length,
      }));
      break;
    }
    case "financial-daily-expenses": {
      const expenses = await db.expense.findMany({ orderBy: { date: "desc" }, take: 500 });
      rows = expenses.map((e) => ({
        code: e.code, date: e.date.toISOString().slice(0, 10), category: e.category,
        description: e.description, amount: Number(e.amount), status: e.paymentStatus,
      }));
      break;
    }
    case "financial-payables": {
      const invoices = await db.vendorInvoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { partner: true } });
      rows = invoices.map((v) => ({
        invoiceNo: v.invoiceNo, vendor: v.partner.name, type: v.partner.type,
        date: v.date.toISOString().slice(0, 10), amount: Number(v.amount),
        paid: Number(v.paidAmount), outstanding: Number(v.amount) - Number(v.paidAmount), status: v.status,
      }));
      break;
    }
    case "costing-variants": {
      const costs = await db.variantCost.findMany({
        where: planId ? { variant: { planId } } : undefined,
        include: { variant: { include: { plan: true } } },
        take: 500,
      });
      const salesItems = await db.salesInvoiceItem.findMany({ include: { invoice: true } });
      rows = costs.map((c) => {
        const sold = salesItems.filter((s) => s.variantId === c.variantId);
        const revenue = sold.reduce((a, s) => a + N(s.lineTotal) * N(s.invoice.exchangeRate), 0);
        const qty = Math.max(c.variant.plannedQty, 1);
        return {
          plan: c.variant.plan.code, sku: c.variant.sku, color: c.variant.colorName, size: c.variant.sizeName,
          materialCost: Number(c.materialCost) / qty, serviceCost: Number(c.serviceCost) / qty,
          transportCost: Number(c.transportCost) / qty, otherCost: Number(c.otherCost) / qty,
          mfgCostPerUnit: Number(c.mfgCost) / qty, landedCostPerUnit: Number(c.landedCostBdt) / qty,
          produced: c.variant.producedQty, soldQty: sold.reduce((a, s) => a + s.qty, 0),
          revenue, grossProfit: revenue - Number(c.landedCostBdt) / qty * sold.reduce((a, s) => a + s.qty, 0),
          finalized: c.finalized,
        };
      });
      break;
    }
    case "profitability": {
      const plans = await db.productPlan.findMany({
        where: planId ? { id: planId } : undefined,
        include: { variants: true },
      });

      const salesItems = await db.salesInvoiceItem.findMany({
        where: {
          invoice: {
            locationId: locations ? { in: locations } : undefined,
            status: {
              in: ["CONFIRMED", "PARTIAL", "PAID"],
            },
            items: planId ? { some: { variant: { planId } } } : undefined,
          },
        },
        include: {
          invoice: true,
          variant: true,
        },
        orderBy: { id: "asc" },
      });

      const Dec = ProfitPrisma.Decimal;

      type Totals = {
        revenue: InstanceType<typeof Dec>;
        cogs: InstanceType<typeof Dec>;
        sold: number;
      };

      const totals = new Map<string, Totals>();

      const grouped = new Map<string, typeof salesItems>();

      for (const item of salesItems) {
        const items = grouped.get(item.invoiceId) ?? [];
        items.push(item);
        grouped.set(item.invoiceId, items);
      }

      for (const items of grouped.values()) {
        const invoice = items[0].invoice;

        const revenueTotal = new Dec(invoice.total)
          .mul(invoice.exchangeRate)
          .toDecimalPlaces(2);

        const cogsTotal = new Dec(invoice.cogs)
          .toDecimalPlaces(2);

        const grossWeight = items.reduce(
          (total, item) => total.add(item.lineTotal),
          new Dec(0)
        );

        const costWeight = items.reduce(
          (total, item) =>
            total.add(new Dec(item.unitCost).mul(item.qty)),
          new Dec(0)
        );

        if (grossWeight.lte(0) || costWeight.lte(0)) {
          return bad(
            "Sales invoice requires profitability reconciliation",
            409
          );
        }

        let cumulativeGross = new Dec(0);
        let cumulativeCost = new Dec(0);
        let allocatedRevenue = new Dec(0);
        let allocatedCogs = new Dec(0);

        for (const item of items) {
          cumulativeGross = cumulativeGross.add(item.lineTotal);

          cumulativeCost = cumulativeCost.add(
            new Dec(item.unitCost).mul(item.qty)
          );

          const revenueToDate = revenueTotal
            .mul(cumulativeGross)
            .div(grossWeight)
            .toDecimalPlaces(2);

          const cogsToDate = cogsTotal
            .mul(cumulativeCost)
            .div(costWeight)
            .toDecimalPlaces(2);

          const revenue = revenueToDate.sub(allocatedRevenue);

          const cogs = cogsToDate.sub(allocatedCogs);

          allocatedRevenue = revenueToDate;
          allocatedCogs = cogsToDate;

          const current = totals.get(item.variant.planId) ?? {
            revenue: new Dec(0),
            cogs: new Dec(0),
            sold: 0,
          };

          current.revenue = current.revenue.add(revenue);
          current.cogs = current.cogs.add(cogs);
          current.sold += item.qty;

          totals.set(item.variant.planId, current);
        }
      }

      rows = plans.map(plan => {
        const current = totals.get(plan.id) ?? {
          revenue: new Dec(0),
          cogs: new Dec(0),
          sold: 0,
        };

        const grossProfit = current.revenue.sub(current.cogs);

        const margin = current.revenue.gt(0)
          ? grossProfit
              .div(current.revenue)
              .mul(100)
              .toDecimalPlaces(2)
              .toNumber()
          : 0;

        return {
          plan: plan.code,
          name: plan.name,
          status: plan.status,
          plannedQty: plan.plannedQty,
          produced: plan.variants.reduce(
            (total, variant) => total + variant.producedQty,
            0
          ),
          sold: current.sold,
          revenue: current.revenue.toNumber(),
          cogs: current.cogs.toNumber(),
          grossProfit: grossProfit.toNumber(),
          margin,
          estimatedBudget: Number(plan.estimatedBudget),
        };
      });

      break;
    }
    default:
      return bad(`Unknown report: ${resource}`, 404);
  }

  if (format === "csv") {
    if (!canExport(user)) return bad("Permission denied: export", 403);
    return new Response(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="garmentflow-${resource}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  return ok(ser(rows));
}

function canExport(user: { permissions: string[] }): boolean {
  return user.permissions.includes("*") || user.permissions.includes("export");
}

