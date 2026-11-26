"use client";

import { useState } from "react";
import { api, downloadCsv } from "@/lib/gf-api";
import { PageHeader, ErrorText, DataTable, type Column } from "./ui-bits";
import type { ViewProps } from "./shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { BarChart3, Download } from "lucide-react";

const REPORTS: { id: string; group: string; name: string; description: string; financial?: boolean }[] = [
  { id: "plan-summary", group: "Product Planning", name: "Plan summary", description: "Plans with planned vs produced quantities and budgets" },
  { id: "procurement", group: "Procurement", name: "Purchase history", description: "All purchase orders with supplier, totals and payment state" },
  { id: "inventory-valuation", group: "Inventory", name: "Inventory valuation", description: "Stock per material/warehouse with weighted-average value" },
  { id: "material-consumption", group: "Inventory", name: "Material consumption & wastage", description: "Consumed and wasted materials at vendors" },
  { id: "vendor-custody", group: "Inventory", name: "Materials held by vendors", description: "Business materials currently in vendor custody" },
  { id: "production", group: "Production", name: "Batch production", description: "Batches with completed quantities and service costs" },
  { id: "quality", group: "Quality", name: "Inspection summary", description: "Inspections with pass/rework/reject rates" },
  { id: "vendor-performance", group: "Business Partners", name: "Vendor performance", description: "Fill rate, on-time %, rejections and service cost per vendor" },
  { id: "logistics", group: "Logistics", name: "Shipments", description: "Local & international shipments with boxes, pieces and discrepancies" },
  { id: "financial-daily-expenses", group: "Financial", name: "Expense register", description: "All recorded expenses by category", financial: true },
  { id: "financial-payables", group: "Financial", name: "Outstanding payables", description: "Open vendor invoices", financial: true },
  { id: "costing-variants", group: "Costing", name: "Variant-wise cost", description: "Material, service, transport, landed cost per variant", financial: true },
  { id: "profitability", group: "Costing", name: "Product profitability", description: "Revenue, COGS, gross profit and margin per plan", financial: true },
];

export function ReportsView({ can }: ViewProps) {
  const [active, setActive] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const openReport = async (id: string) => {
    setActive(id);
    setLoading(true); setError(null);
    try { setRows(await api<Record<string, unknown>[]>(`reports/${id}`)); }
    catch (e) { setError((e as Error).message); setRows([]); }
    finally { setLoading(false); }
  };

  const columns: Column<Record<string, unknown>>[] = rows.length > 0
    ? Object.keys(rows[0]).map((k) => ({
        key: k, header: k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
        value: (r) => (typeof r[k] === "number" ? r[k] as number : String(r[k] ?? "")),
        render: (r) => typeof r[k] === "number" ? (r[k] as number).toLocaleString() : String(r[k] ?? "—"),
      }))
    : [];

  return (
    <div className="space-y-4">
      <PageHeader title="Reports & Analytics" description="Filterable, exportable business reports across planning, procurement, inventory, production, quality, logistics, finance and costing." />
      <ErrorText error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {REPORTS.map((r) => (
          <Card key={r.id} className={`py-3 cursor-pointer transition-colors hover:border-violet-400 ${active === r.id ? "border-violet-500" : ""}`}
            onClick={() => openReport(r.id)}>
            <CardContent className="px-4">
              <div className="flex items-start gap-2.5">
                <BarChart3 className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{r.description}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">{r.group}{r.financial ? " · financial" : ""}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {active && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {REPORTS.find((r) => r.id === active)?.name}
              {can("export") && (
                <Button size="sm" variant="outline" className="ml-auto h-7 text-xs"
                  onClick={() => { downloadCsv(`/api/data/reports/${active}?format=csv`); toast({ title: "CSV exported" }); }}>
                  <Download className="h-3 w-3 mr-1" />Export CSV
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p> : (
              <DataTable columns={columns} rows={rows} pageSize={12} searchable={false} emptyText="No data for this report yet." />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
