"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiPost, fmtMoney, fmtNum, fmtDate } from "@/lib/gf-api";
import { PageHeader, StatCard, StatusBadge, ErrorText, DataTable, type Column } from "./ui-bits";
import type { ViewProps } from "./shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { ArrowLeftRight, CircleOff } from "lucide-react";

type FGStock = {
  id: string; qty: number; reservedQty: number; packedQty: number; unitCost: number;
  variant: { id: string; sku: string; colorName: string; sizeName: string; plan: { code: string; name: string } };
  warehouse: { id: string; name: string; type: string; location: { name: string } };
};
type FGMove = {
  id: string; movementDate: string; type: string; qty: number; unitCost: number; value: number;
  variant: { sku: string }; from: { name: string } | null; to: { name: string } | null; refNo: string | null; note: string | null;
};

export function FinishedView({ mode }: ViewProps & { mode: "finished" | "finished-movements" }) {
  const [stocks, setStocks] = useState<FGStock[]>([]);
  const [moves, setMoves] = useState<FGMove[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const load = useCallback(() => {
    if (mode === "finished") api<FGStock[]>("ops/finished-stocks").then(setStocks).catch((e) => setError(e.message));
    else api<FGMove[]>("ops/finished-movements").then(setMoves).catch((e) => setError(e.message));
  }, [mode]);
  useEffect(() => { load(); }, [load]);

  if (mode === "finished-movements") {
    return (
      <div className="space-y-4">
        <PageHeader title="Finished Goods Movements" description="Full traceability: production-in, packing, dispatch, receiving, sales and write-offs per variant." />
        <ErrorText error={error} />
        <DataTable<FGMove>
          columns={[
            { key: "movementDate", header: "Date", render: (r) => fmtDate(r.movementDate) },
            { key: "variant", header: "Variant", value: (r) => r.variant?.sku ?? "" },
            { key: "type", header: "Type", render: (r) => <StatusBadge status={r.type} /> },
            { key: "from", header: "From", render: (r) => r.from?.name ?? "—" },
            { key: "to", header: "To", render: (r) => r.to?.name ?? "—" },
            { key: "qty", header: "Qty" },
            { key: "unitCost", header: "Unit cost", render: (r) => fmtMoney(r.unitCost) },
            { key: "refNo", header: "Ref", render: (r) => <span className="text-xs">{r.refNo ?? "—"}</span> },
            { key: "note", header: "Note", render: (r) => <span className="text-xs text-muted-foreground line-clamp-1">{r.note ?? ""}</span> },
          ]}
          rows={moves}
          pageSize={15}
        />
      </div>
    );
  }

  const available = stocks.filter((s) => s.warehouse.type === "MAIN").reduce((a, s) => a + (s.qty - s.reservedQty), 0);
  const packed = stocks.reduce((a, s) => a + s.packedQty, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finished Goods Stock"
        description="Approved products by variant and warehouse, with traceable landed cost. Only QC-passed products appear here."
        actions={<Button size="sm" variant="outline" onClick={() => setTransferOpen(true)}><ArrowLeftRight className="h-4 w-4 mr-1" />Transfer stock</Button>}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Available (unreserved)" value={fmtNum(available)} tone="good" />
        <StatCard title="Packed (in boxes)" value={fmtNum(packed)} tone="info" />
        <StatCard title="Quarantine / damaged" value={fmtNum(stocks.filter((s) => s.warehouse.type === "QUARANTINE").reduce((a, s) => a + s.qty, 0))} tone="bad" />
        <StatCard title="Stock value" value={fmtMoney(stocks.reduce((a, s) => a + s.qty * Number(s.unitCost), 0))} />
      </div>
      <ErrorText error={error} />
      <DataTable
        columns={[
          { key: "sku", header: "Variant SKU", value: (r) => String((r.variant as { sku: string }).sku) },
          { key: "plan", header: "Plan", value: (r) => String((r.variant as { plan: { code: string } }).plan?.code ?? "") },
          { key: "colorName", header: "Color", value: (r) => String((r.variant as { colorName: string }).colorName) },
          { key: "sizeName", header: "Size", value: (r) => String((r.variant as { sizeName: string }).sizeName) },
          { key: "warehouse", header: "Warehouse", value: (r) => String((r.warehouse as { name: string }).name) },
          { key: "location", header: "Location", value: (r) => String((r.warehouse as { location: { name: string } }).location?.name ?? "") },
          { key: "qty", header: "On hand", render: (r) => fmtNum(Number(r.qty)) },
          { key: "packedQty", header: "Packed", render: (r) => fmtNum(Number(r.packedQty)) },
          { key: "unitCost", header: "Unit cost", render: (r) => fmtMoney(Number(r.unitCost)) },
        ]}
        rows={stocks}
        pageSize={14}
      />
      {transferOpen && <FGTransferDialog stocks={stocks} onClose={(d) => { setTransferOpen(false); if (d) load(); }} />}
    </div>
  );
}

function FGTransferDialog({ stocks, onClose }: { stocks: FGStock[]; onClose: (done: boolean) => void }) {
  const warehouses = [...new Map(stocks.filter((s) => s.warehouse.type === "MAIN").map((s) => [s.warehouse.id, s.warehouse])).values()];
  const [from, setFrom] = useState(warehouses[0]?.id ?? "");
  const [to, setTo] = useState(warehouses[1]?.id ?? "");
  const [lines, setLines] = useState<{ variantId: string; qty: number }[]>([{ variantId: "", qty: 0 }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await apiPost("finished/transfer", { fromWarehouseId: from, toWarehouseId: to, items: lines.filter((l) => l.variantId && l.qty > 0) });
      toast({ title: "Finished stock transferred" });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const fromStocks = stocks.filter((s) => s.warehouse.id === from);
  const toOptions = [...new Map(stocks.map((s) => [s.warehouse.id, s.warehouse])).values()].filter((w) => w.id !== from);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Transfer Finished Stock</DialogTitle><DialogDescription>Move finished products between warehouses (e.g. Dhaka → Sylhet) with full movement trace.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>From</Label>
            <Select value={from} onValueChange={(v) => { setFrom(v); setLines([{ variantId: "", qty: 0 }]); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>To</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{toOptions.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Select value={l.variantId} onValueChange={(v) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, variantId: v } : x))}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Variant" /></SelectTrigger>
              <SelectContent>{fromStocks.map((s) => <SelectItem key={s.id} value={s.variant.id}>{s.variant.sku} — {s.qty - s.reservedQty} free</SelectItem>)}</SelectContent>
            </Select>
            <Input type="number" min={0} className="w-24" value={l.qty || ""} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} />
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setLines((l) => [...l, { variantId: "", qty: 0 }])}>Add line</Button>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !from || !to}>Transfer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
