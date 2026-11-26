"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiPost, fmtMoney, fmtNum, fmtDate, idem } from "@/lib/gf-api";
import { PageHeader, StatCard, StatusBadge, ErrorText, DataTable, type Column } from "./ui-bits";
import type { ViewProps } from "./shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { ArrowLeftRight, Scale, ClipboardCheck, Warehouse } from "lucide-react";

type Stock = {
  id: string; qty: number; reservedQty: number; avgCost: number;
  material: { id: string; name: string; sku: string; baseUnit: string; category: { name: string } | null };
  warehouse: { id: string; name: string; type: string; location: { name: string } };
};
type Movement = {
  id: string; movementDate: string; type: string; qty: number; unitCost: number; value: number;
  material: { name: string; sku: string }; from: { name: string; location: { name: string } } | null;
  to: { name: string; location: { name: string } } | null; refNo: string | null; userName: string | null; note: string | null;
};

export function InventoryView({ mode }: ViewProps & { mode: "inventory-stocks" | "inventory-ledger" | "inventory-custody" | "inventory-counts" }) {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [valuation, setValuation] = useState<{ totalValue: number; totalQty: number; byCategory: { name: string; qty: number; value: number }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, unknown>[]>([]);

  const load = useCallback(() => {
    if (mode === "inventory-stocks") {
      api<Stock[]>("inventory/stocks").then(setStocks).catch((e) => setError(e.message));
      api<{ totalValue: number; totalQty: number; byCategory: { name: string; qty: number; value: number }[] }>("inventory/valuation").then(setValuation).catch(() => null);
    }
    if (mode === "inventory-ledger") api<Movement[]>("inventory/ledger").then(setMovements).catch((e) => setError(e.message));
    if (mode === "inventory-custody") api<Stock[]>("inventory/custody").then(setStocks).catch((e) => setError(e.message));
    if (mode === "inventory-counts") {
      api<Record<string, unknown>[]>("inventory/counts").then(setCounts).catch(() => null);
      api<Stock[]>("inventory/stocks").then(setStocks).catch(() => null);
    }
  }, [mode]);
  useEffect(() => { load(); }, [load]);

  const warehouses = [...new Map(stocks.map((s) => [s.warehouse.id, s.warehouse])).values()];
  const mainStocks = stocks.filter((s) => s.warehouse.type === "MAIN");

  return (
    <div className="space-y-4">
      {mode === "inventory-stocks" && (
        <>
          <PageHeader
            title="Inventory Overview"
            description="Multi-location raw material stock with weighted-average costing. Materials at vendor custody appear in their own tab."
            actions={(
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setTransferOpen(true)}><ArrowLeftRight className="h-4 w-4 mr-1" />Transfer</Button>
                <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}><Scale className="h-4 w-4 mr-1" />Adjust</Button>
              </div>
            )}
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="Inventory Value" value={fmtMoney(valuation?.totalValue ?? 0)} icon={<Warehouse className="h-4 w-4" />} />
            <StatCard title="Total Quantity" value={fmtNum(valuation?.totalQty ?? 0, 0)} />
            <StatCard title="Reserved" value={fmtNum(mainStocks.reduce((a, s) => a + Number(s.reservedQty), 0), 0)} tone="warn" />
            <StatCard title="Warehouses" value={String(warehouses.length)} />
          </div>
          <ErrorText error={error} />
          <DataTable
            columns={[
              { key: "material", header: "Material", value: (r) => String((r.material as { name: string }).name) },
              { key: "sku", header: "SKU", value: (r) => String((r.material as { sku: string }).sku) },
              { key: "category", header: "Category", value: (r) => String((r.material as { category?: { name: string } })?.category?.name ?? "") },
              { key: "warehouse", header: "Warehouse", value: (r) => String((r.warehouse as { name: string }).name) },
              { key: "location", header: "Location", value: (r) => String((r.warehouse as { location: { name: string } }).location?.name ?? "") },
              { key: "qty", header: "Qty", render: (r) => fmtNum(Number(r.qty), 1) },
              { key: "reservedQty", header: "Reserved", render: (r) => fmtNum(Number(r.reservedQty), 1) },
              { key: "avgCost", header: "Avg cost", render: (r) => fmtMoney(Number(r.avgCost)) },
              { key: "value", header: "Value", render: (r) => fmtMoney(Number(r.qty) * Number(r.avgCost)) },
            ]}
            rows={stocks}
            pageSize={14}
          />
        </>
      )}

      {mode === "inventory-ledger" && (
        <>
          <PageHeader title="Stock Ledger" description="Immutable movement history — every posting has source, destination, quantity, cost, reference and user." />
          <ErrorText error={error} />
          <DataTable
            columns={[
              { key: "movementDate", header: "Date", render: (r) => fmtDate(String(r.movementDate)) },
              { key: "material", header: "Material", value: (r) => String((r.material as { name: string })?.name ?? "") },
              { key: "type", header: "Type", render: (r) => <StatusBadge status={String(r.type)} /> },
              { key: "from", header: "From", value: (r) => String((r.from as { name: string } | null)?.name ?? ""), render: (r) => String((r.from as { name: string } | null)?.name ?? "—") },
              { key: "to", header: "To", value: (r) => String((r.to as { name: string } | null)?.name ?? ""), render: (r) => String((r.to as { name: string } | null)?.name ?? "—") },
              { key: "qty", header: "Qty", render: (r) => fmtNum(Number(r.qty), 1) },
              { key: "unitCost", header: "Unit cost", render: (r) => fmtMoney(Number(r.unitCost)) },
              { key: "value", header: "Value", render: (r) => fmtMoney(Number(r.value)) },
              { key: "refNo", header: "Ref", render: (r) => <span className="text-xs">{String(r.refNo ?? "—")}</span> },
              { key: "userName", header: "User" },
            ]}
            rows={movements}
            pageSize={15}
          />
        </>
      )}

      {mode === "inventory-custody" && (
        <>
          <PageHeader title="Materials Held by Vendors" description="Business-owned materials in factory/tailor custody (virtual vendor locations). Reconciled on work order collection." />
          <ErrorText error={error} />
          <DataTable
            columns={[
              { key: "vendor", header: "Vendor custody", value: (r) => String((r.warehouse as { name: string }).name) },
              { key: "material", header: "Material", value: (r) => String((r.material as { name: string }).name) },
              { key: "sku", header: "SKU", value: (r) => String((r.material as { sku: string }).sku) },
              { key: "qty", header: "Qty at vendor", render: (r) => fmtNum(Number(r.qty), 1) },
              { key: "avgCost", header: "Avg cost", render: (r) => fmtMoney(Number(r.avgCost)) },
              { key: "value", header: "Value", render: (r) => fmtMoney(Number(r.qty) * Number(r.avgCost)) },
            ]}
            rows={stocks}
            emptyText="No materials currently at vendors."
          />
        </>
      )}

      {mode === "inventory-counts" && (
        <>
          <PageHeader
            title="Stock Count & Adjustments"
            description="Physical count reconciliation and controlled stock adjustments (posted as ledger movements, never deletions)."
            actions={<Button size="sm" variant="outline" onClick={() => setCountOpen(true)}><ClipboardCheck className="h-4 w-4 mr-1" />New physical count</Button>}
          />
          <ErrorText error={error} />
          <DataTable
            columns={[
              { key: "code", header: "Count" },
              { key: "date", header: "Date", render: (r) => fmtDate(String(r.date)) },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
              { key: "notes", header: "Notes" },
            ]}
            rows={counts}
            searchable={false}
          />
        </>
      )}

      <TransferDialog open={transferOpen} onClose={(d) => { setTransferOpen(false); if (d) load(); }}
        warehouses={warehouses} stocks={mainStocks} />
      <AdjustDialog open={adjustOpen} onClose={(d) => { setAdjustOpen(false); if (d) load(); }} stocks={mainStocks} />
      <CountDialog open={countOpen} onClose={(d) => { setCountOpen(false); if (d) load(); }} stocks={mainStocks} />
    </div>
  );
}

function TransferDialog({ open, onClose, warehouses, stocks }: {
  open: boolean; onClose: (done: boolean) => void; warehouses: { id: string; name: string }[]; stocks: Stock[];
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lines, setLines] = useState<{ materialId: string; qty: number }[]>([{ materialId: "", qty: 0 }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fromStocks = stocks.filter((s) => !from || s.warehouse.id === from);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await apiPost("inventory/transfer", { fromWarehouseId: from, toWarehouseId: to, items: lines.filter((l) => l.materialId && l.qty > 0) });
      toast({ title: "Stock transferred" });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Transfer Stock</DialogTitle><DialogDescription>Move materials between warehouses with a full ledger trail.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>From</Label>
            <Select value={from} onValueChange={(v) => { setFrom(v); setLines([{ materialId: "", qty: 0 }]); }}>
              <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>To</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
              <SelectContent>{warehouses.filter((w) => w.id !== from).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Select value={l.materialId} onValueChange={(v) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, materialId: v } : x))}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Material" /></SelectTrigger>
              <SelectContent>{fromStocks.map((s) => <SelectItem key={s.id} value={s.material.id}>{s.material.name} ({fmtNum(Number(s.qty) - Number(s.reservedQty), 1)} free)</SelectItem>)}</SelectContent>
            </Select>
            <Input type="number" min={0} className="w-24" value={l.qty || ""} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} />
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setLines((l) => [...l, { materialId: "", qty: 0 }])}>Add line</Button>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !from || !to}>Transfer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ open, onClose, stocks }: { open: boolean; onClose: (done: boolean) => void; stocks: Stock[] }) {
  const [materialId, setMaterialId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [type, setType] = useState("INCREASE");
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await apiPost("inventory/adjust", { materialId, warehouseId, type, qty, reason, idempotencyKey: idem() });
      toast({ title: "Stock adjusted" });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const whOptions = [...new Map(stocks.filter((s) => s.material.id === materialId).map((s) => [s.warehouse.id, s.warehouse])).values()];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Stock Adjustment</DialogTitle><DialogDescription>Increases/decreases are posted as controlled adjustment movements with audit trail.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="space-y-1"><Label>Material</Label>
          <Select value={materialId} onValueChange={(v) => { setMaterialId(v); setWarehouseId(""); }}>
            <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
            <SelectContent>{[...new Map(stocks.map((s) => [s.material.id, s.material])).values()].map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{whOptions.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Type</Label>
            <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="INCREASE">Increase</SelectItem><SelectItem value="DECREASE">Decrease</SelectItem></SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Quantity</Label><Input type="number" step="0.001" value={qty || ""} onChange={(e) => setQty(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Reason *</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged in storage" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !materialId || !warehouseId || !reason || qty <= 0}>Post adjustment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CountDialog({ open, onClose, stocks }: { open: boolean; onClose: (done: boolean) => void; stocks: Stock[] }) {
  const [warehouseId, setWarehouseId] = useState("");
  const [counted, setCounted] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const whStocks = stocks.filter((s) => !warehouseId || s.warehouse.id === warehouseId);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const items = Object.entries(counted).filter(([, v]) => v != null).map(([materialId, countedQty]) => ({ materialId, countedQty }));
      const res = await apiPost<{ adjustments: number }>("inventory/count", { warehouseId, items });
      toast({ title: "Stock count posted", description: `${res.adjustments} line(s) reconciled` });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const whOptions = [...new Map(stocks.map((s) => [s.warehouse.id, s.warehouse])).values()];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Physical Stock Count</DialogTitle><DialogDescription>Differences are posted as reconciliation movements automatically.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="space-y-1"><Label>Warehouse</Label>
          <Select value={warehouseId} onValueChange={(v) => { setWarehouseId(v); setCounted({}); }}>
            <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
            <SelectContent>{whOptions.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="rounded-lg border divide-y max-h-80 overflow-y-auto">
          {whStocks.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 truncate">{s.material.name}</span>
              <span className="text-xs text-muted-foreground">system {fmtNum(Number(s.qty), 1)}</span>
              <Input type="number" step="0.001" placeholder="Counted" className="w-28 h-8" value={counted[s.material.id] ?? ""} onChange={(e) => setCounted((c) => ({ ...c, [s.material.id]: Number(e.target.value) }))} />
            </div>
          ))}
          {whStocks.length === 0 && <p className="text-xs text-muted-foreground p-3">Select a warehouse.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !warehouseId || Object.keys(counted).length === 0}>Post count</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
