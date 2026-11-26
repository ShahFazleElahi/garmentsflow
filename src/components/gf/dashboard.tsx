"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtMoney, fmtNum, fmtDate, fmtDateTime, statusLabel } from "@/lib/gf-api";
import { PageHeader, StatCard, StatusBadge, ErrorText, DataTable, type Column } from "./ui-bits";
import type { ViewProps } from "./shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area,
} from "recharts";
import {
  ClipboardList, Layers, Factory, ShoppingBag, Banknote, Boxes, Scissors, Landmark,
  PackageCheck, Truck, CircleDollarSign, TrendingUp, Wallet, ShieldCheck, CalendarDays, AlertTriangle,
} from "lucide-react";

const COLORS = ["#7c3aed", "#10b981", "#f59e0b", "#3b82f6", "#ef4444", "#64748b", "#ec4899", "#14b8a6"];

type Dash = {
  operationalOnly?: boolean;
  kpis: Record<string, number>;
  charts: {
    pipeline: { status: string; qty: number }[];
    dailyExpenses: { day: string; amount: number }[];
    plannedVsActual: { name: string; planned: number; actual: number }[];
    colorWise: { name: string; qty: number }[];
    sizeWise: { name: string; qty: number }[];
    locationWise: { name: string; qty: number }[];
    shipmentStatus: { name: string; count: number }[];
    vendorPerf: { name: string; fillRate: number; orders: number; delayed: number }[];
    revenueProfit: { month: string; revenue: number; cogs: number; profit: number }[];
  };
  calendar: { date: string; label: string; type: string; ref: string }[];
  overdue: { label: string; ref: string }[];
  recentActivity: { id: string; date: string; module: string; description: string; userName: string | null }[];
};

export function DashboardView({ mode, navigate }: ViewProps & { mode: "exec" | "daily" }) {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opsDate, setOpsDate] = useState(new Date().toISOString().slice(0, 10));
  const [ops, setOps] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (mode !== "exec") return;
    api<Dash>("dashboard/dashboard").then(setData).catch((e) => setError(e.message));
  }, [mode]);

  const loadOps = useCallback(() => {
    api<Record<string, unknown>>(`dashboard/daily-ops?date=${opsDate}`).then(setOps).catch((e) => setError(e.message));
  }, [opsDate]);
  useEffect(() => { if (mode === "daily") loadOps(); }, [mode, loadOps]);

  if (error) return <ErrorText error={error} />;
  if (!data && mode === "exec") return <p className="text-sm text-muted-foreground py-20 text-center">Loading dashboard…</p>;

  if (mode === "daily") {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Daily Operations Center"
          description="Review everything that happened on a selected day — purchases, dispatches, receipts, QC, shipments, payments and sales."
          actions={
            <div className="flex items-center gap-2">
              <Input type="date" value={opsDate} onChange={(e) => setOpsDate(e.target.value)} className="h-9 w-40" />
              <Button size="sm" variant="outline" onClick={loadOps}>Refresh</Button>
            </div>
          }
        />
        {ops ? <DailyOpsView ops={ops} /> : <p className="text-sm text-muted-foreground py-16 text-center">Loading…</p>}
      </div>
    );
  }

  if (data?.operationalOnly) {
    return (
      <div className="space-y-4">
        <PageHeader title="Operations Dashboard" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard title="Raw Material Available" value={fmtNum(data.kpis.availableMaterial)} />
          <StatCard title="Reserved Material" value={fmtNum(data.kpis.reservedMaterial)} />
          <StatCard title="Finished Goods Available" value={fmtNum(data.kpis.finishedProducts)} />
          <StatCard title="Packed Products" value={fmtNum(data.kpis.packedProducts)} />
          <StatCard title="Shipments In Transit" value={fmtNum(data.kpis.inTransit)} />
        </div>
      </div>
    );
  }

  const k = data!.kpis;
  const c = data!.charts;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Executive Dashboard"
        description="Real-time business overview — every figure comes from live transactions."
        actions={<Button size="sm" variant="outline" onClick={() => navigate("daily-ops")}><CalendarDays className="h-4 w-4 mr-1.5" />Daily Operations</Button>}
      />

      {data!.overdue.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-1">
          <p className="text-sm font-medium text-red-700 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Overdue attention ({data!.overdue.length})</p>
          {data!.overdue.slice(0, 4).map((o, i) => (
            <p key={i} className="text-xs text-red-600">{o.label}</p>
          ))}
        </div>
      )}

      {/* KPI row 1: planning & production */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard title="Active Product Plans" value={fmtNum(k.activePlans)} icon={<ClipboardList className="h-4 w-4" />} />
        <StatCard title="Planned Quantity" value={fmtNum(k.plannedQty)} sub="pieces / sets" />
        <StatCard title="Production Batches" value={fmtNum(k.productionBatches)} icon={<Factory className="h-4 w-4" />} />
        <StatCard title="Under Embroidery" value={fmtNum(k.underEmbroidery)} sub="pieces at factories" tone="info" />
        <StatCard title="Under Tailoring" value={fmtNum(k.underTailoring)} sub="pieces at tailors" tone="info" />
        <StatCard title="Awaiting QC" value={fmtNum(k.awaitingQC)} tone={k.awaitingQC > 0 ? "warn" : "default"} icon={<ShieldCheck className="h-4 w-4" />} />
      </div>

      {/* KPI row 2: materials & stock */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard title="Raw Material Available" value={fmtNum(k.availableMaterial, 0)} sub="units in stock" icon={<Boxes className="h-4 w-4" />} />
        <StatCard title="Material Valuation" value={fmtMoney(k.materialValuation)} sub="weighted average cost" />
        <StatCard title="Reserved Material" value={fmtNum(k.reservedMaterial, 0)} sub="for production" tone="warn" />
        <StatCard title="At Factories" value={fmtNum(k.materialsAtFactories, 0)} sub="vendor custody" tone="info" />
        <StatCard title="At Tailors" value={fmtNum(k.materialsAtTailors, 0)} sub="vendor custody" tone="info" />
        <StatCard title="Rework Required" value={fmtNum(k.reworkRequired)} tone={k.reworkRequired > 0 ? "warn" : "default"} />
      </div>

      {/* KPI row 3: finished goods & logistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard title="Finished Products" value={fmtNum(k.finishedProducts)} tone="good" icon={<PackageCheck className="h-4 w-4" />} />
        <StatCard title="Ready for Dispatch" value={fmtNum(k.readyForDispatch)} tone="good" />
        <StatCard title="Packed" value={fmtNum(k.packedProducts)} />
        <StatCard title="Shipments In Transit" value={fmtNum(k.inTransit)} tone="info" icon={<Truck className="h-4 w-4" />} />
        <StatCard title="Dhaka Stock" value={fmtNum(k.dhakaStock)} />
        <StatCard title="Sylhet / UK Stock" value={`${fmtNum(k.sylhetStock)} / ${fmtNum(k.ukStock)}`} />
      </div>

      {/* KPI row 4: money */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard title="Today's Purchases" value={fmtMoney(k.todayPurchases)} icon={<ShoppingBag className="h-4 w-4" />} />
        <StatCard title="Today's Expenses" value={fmtMoney(k.todayExpenses)} icon={<Banknote className="h-4 w-4" />} />
        <StatCard title="Monthly Expenses" value={fmtMoney(k.monthExpenses)} />
        <StatCard title="Cash & Bank" value={fmtMoney(k.cashBank)} tone="good" icon={<Landmark className="h-4 w-4" />} />
        <StatCard title="Outstanding Payables" value={fmtMoney(k.outstandingSupplier)} sub={`factories ${fmtMoney(k.outstandingFactories)} · tailors ${fmtMoney(k.outstandingTailors)}`} tone={k.outstandingSupplier > 0 ? "warn" : "default"} />
        <StatCard title="Avg Cost / Product" value={fmtMoney(k.avgCostPerProduct)} icon={<CircleDollarSign className="h-4 w-4" />} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard title="Estimated Budget" value={fmtMoney(k.estimatedBudget)} sub="all active plans" />
        <StatCard title="Sales Revenue" value={fmtMoney(k.salesRevenue)} tone="good" icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard title="Gross Profit" value={fmtMoney(k.grossProfit)} tone={k.grossProfit >= 0 ? "good" : "bad"} sub="revenue − COGS" />
        <StatCard title="Transport Expenses" value={fmtMoney(k.transportExpenses)} icon={<Truck className="h-4 w-4" />} />
        <StatCard title="Packed Products" value={fmtNum(k.packedProducts)} />
        <StatCard title="UK Warehouse Stock" value={fmtNum(k.ukStock)} tone="info" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard title="Production Pipeline (by status)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={c.pipeline} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="status" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={54} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmtNum(Number(v))} />
              <Bar dataKey="qty" name="Quantity" fill="#7c3aed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Planned vs Actual Production">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={c.plannedVsActual} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="planned" name="Planned" fill="#c4b5fd" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name="Actual" fill="#7c3aed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Daily Expenses (last 14 days)">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={c.dailyExpenses} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmtMoney(Number(v))} />
              <Area dataKey="amount" name="Expenses" stroke="#10b981" fill="#d1fae5" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Color-wise Production">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={c.colorWise} dataKey="qty" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {c.colorWise.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => fmtNum(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Size-wise Production">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={c.sizeWise} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmtNum(Number(v))} />
              <Bar dataKey="qty" name="Produced" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Location-wise Finished Inventory">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={c.locationWise} dataKey="qty" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {c.locationWise.map((_, i) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => fmtNum(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Vendor Performance (fill rate %)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={c.vendorPerf} layout="vertical" margin={{ top: 4, right: 16, left: 40, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
              <Tooltip />
              <Bar dataKey="fillRate" name="Fill rate %" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Revenue vs COGS vs Profit">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={c.revenueProfit} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => fmtMoney(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="revenue" name="Revenue" stroke="#7c3aed" strokeWidth={2} />
              <Line dataKey="cogs" name="COGS" stroke="#f59e0b" strokeWidth={2} />
              <Line dataKey="profit" name="Gross profit" stroke="#10b981" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Shipment Status">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={c.shipmentStatus} dataKey="count" nameKey="name" innerRadius={50} outerRadius={85}>
                {c.shipmentStatus.map((_, i) => <Cell key={i} fill={COLORS[(i + 1) % COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Delivery Calendar — upcoming deadlines">
          <div className="max-h-56 overflow-y-auto divide-y text-sm gf-scroll">
            {data!.calendar.slice(0, 12).map((ev, i) => (
              <div key={i} className="flex items-center gap-3 py-2 px-1">
                <span className="text-xs text-muted-foreground w-20 shrink-0">{fmtDate(ev.date)}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">{ev.type.replaceAll("_", " ")}</span>
                <span className="truncate text-[13px]">{ev.label}</span>
              </div>
            ))}
            {data!.calendar.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No upcoming deadlines.</p>}
          </div>
        </ChartCard>
      </div>

      {/* Activity feed */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Activity</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2.5">
            {data!.recentActivity.map((a) => (
              <div key={a.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[13px] leading-snug">{a.description}</p>
                  <p className="text-[11px] text-muted-foreground">{fmtDateTime(a.date)} · {a.module} {a.userName ? `· ${a.userName}` : ""}</p>
                </div>
              </div>
            ))}
            {data!.recentActivity.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

function DailyOpsView({ ops }: { ops: Record<string, unknown> }) {
  const list = (key: string): Record<string, unknown>[] => (ops[key] as Record<string, unknown>[]) ?? [];
  const closing = ops.closing as { cashIn: number; cashOut: number; net: number; exceptionCount: number };
  const totals = ops.totals as { purchases: number; expenses: number; sales: number };
  const sections: { key: string; title: string; render: (r: Record<string, unknown>) => string }[] = [
    { key: "purchases", title: "Purchases", render: (r) => `${r.code} — ${r.supplier} · ${fmtMoney(Number(r.total))}` },
    { key: "expenses", title: "Expenses", render: (r) => `${r.code} — ${r.category} · ${fmtMoney(Number(r.amount))}` },
    { key: "materialReceipts", title: "Material Receipts", render: (r) => `${r.code} — ${r.items} line(s)` },
    { key: "factoryDispatches", title: "Factory Dispatches", render: (r) => `${r.code} → ${r.partner} · ${r.qty} pc` },
    { key: "factoryCollections", title: "Factory Collections", render: (r) => `${r.code} ← ${r.partner} · ${r.received} pc received` },
    { key: "tailoringDispatches", title: "Tailoring Dispatches", render: (r) => `${r.code} → ${r.partner} · ${r.qty} pc` },
    { key: "tailoringCollections", title: "Tailoring Collections", render: (r) => `${r.code} ← ${r.partner} · ${r.received} pc received` },
    { key: "inspections", title: "Quality Inspections", render: (r) => `${r.code} — ${statusLabel(String(r.status))} · ${r.passed} passed / ${r.rejected} rejected` },
    { key: "shipments", title: "Shipments Dispatched", render: (r) => `${r.code} — ${r.type} · ${statusLabel(String(r.status))}` },
    { key: "receivedShipments", title: "Shipments Received", render: (r) => `${r.code} — ${r.boxes} box(es)` },
    { key: "payments", title: "Payments", render: (r) => `${r.code} — ${r.direction === "OUT" ? "paid" : "received"} ${fmtMoney(Number(r.amount))} (${r.method})` },
    { key: "sales", title: "Sales", render: (r) => `${r.code} — ${r.customer} · ${fmtMoney(Number(r.total))}` },
  ];
  const activity = list("activity");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Purchases" value={fmtMoney(totals.purchases)} />
        <StatCard title="Expenses" value={fmtMoney(totals.expenses)} />
        <StatCard title="Sales" value={fmtMoney(totals.sales)} tone="good" />
        <StatCard title="Cash Movement (net)" value={fmtMoney(closing.net)} sub={`in ${fmtMoney(closing.cashIn)} · out ${fmtMoney(closing.cashOut)}`} tone={closing.net >= 0 ? "good" : "bad"} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sections.map((s) => {
          const rows = list(s.key);
          if (rows.length === 0) return null;
          return (
            <Card key={s.key}>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{s.title} ({rows.length})</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {rows.map((r, i) => (
                  <p key={i} className="text-[13px] text-muted-foreground">{s.render(r)}</p>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Day Timeline ({activity.length}) {closing.exceptionCount > 0 ? <span className="text-red-600">· {closing.exceptionCount} exception(s)</span> : null}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {activity.map((a) => (
              <div key={String(a.id)} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                <div>
                  <p className="text-[13px]">{String(a.description)}</p>
                  <p className="text-[11px] text-muted-foreground">{fmtDateTime(String(a.date))} · {String(a.module)}</p>
                </div>
              </div>
            ))}
            {activity.length === 0 && <p className="text-xs text-muted-foreground">No activity recorded for this day.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
