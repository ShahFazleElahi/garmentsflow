"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiPost, fmtMoney, fmtNum, fmtDate, idem } from "@/lib/gf-api";
import { PageHeader, StatCard, StatusBadge, ErrorText, DataTable, type Column } from "./ui-bits";
import type { ViewProps } from "./shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import JsBarcode from "jsbarcode";
import { QRCodeSVG } from "qrcode.react";
import { Boxes, Printer, Undo2 } from "lucide-react";

type Pkg = {
  id: string; code: string; boxNo: string; barcode: string | null; status: string; packingDate: string;
  sourceWarehouse: { name: string }; destLocationId: string | null; netWeight: number; grossWeight: number;
  packagingCost: number; items: { id: string; qty: number; variant: { sku: string; colorName: string; sizeName: string; plan: { code: string } } }[];
};
type FGStock = { id: string; qty: number; reservedQty: number; variant: { id: string; sku: string; colorName: string; sizeName: string }; warehouse: { id: string; name: string; type: string } };
type Location = { id: string; name: string; code: string; type?: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX { interface IntrinsicElements { "jsbarcode-element"?: Record<string, string> } }
}

export function PackagingView({ can }: ViewProps) {
  const [rows, setRows] = useState<Pkg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [labelFor, setLabelFor] = useState<Pkg | null>(null);

  const load = useCallback(() => {
    api<Pkg[]>("ops/packages").then(setRows).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const packedUnits = rows.filter((r) => ["PACKED", "DISPATCHED", "IN_TRANSIT"].includes(r.status)).reduce((a, r) => a + r.items.reduce((x, i) => x + i.qty, 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Boxes & Packing"
        description="Allocate finished products into boxes. Packing reserves stock into a packed state — no duplicate inventory. Each box gets a barcode and QR label."
        actions={can("create") ? <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setCreateOpen(true)}><Boxes className="h-4 w-4 mr-1" />Create Package</Button> : undefined}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Boxes" value={String(rows.length)} />
        <StatCard title="Units packed" value={fmtNum(packedUnits)} tone="info" />
        <StatCard title="Packed / awaiting dispatch" value={String(rows.filter((r) => r.status === "PACKED").length)} tone="warn" />
        <StatCard title="Packaging cost" value={fmtMoney(rows.reduce((a, r) => a + Number(r.packagingCost), 0))} />
      </div>
      <ErrorText error={error} />
      <DataTable
        columns={[
          { key: "code", header: "Package", render: (r) => <span className="font-medium">{String(r.code)}</span> },
          { key: "boxNo", header: "Box" },
          { key: "packingDate", header: "Packed", render: (r) => fmtDate(r.packingDate) },
          { key: "warehouse", header: "From", value: (r) => String((r.sourceWarehouse as { name: string })?.name ?? "") },
          { key: "units", header: "Units", value: (r) => ((r.items as { qty: number }[])?.reduce((a, i) => a + i.qty, 0) ?? 0) },
          { key: "grossWeight", header: "Gross wt (kg)", render: (r) => fmtNum(Number(r.grossWeight), 1) },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
          { key: "actions", header: "", searchable: false, render: (r) => (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLabelFor(r as unknown as Pkg)}><Printer className="h-3 w-3 mr-1" />Label</Button>
              {can("post") && ["PACKED"].includes(String(r.status)) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={async () => {
                  if (!window.confirm(`Unpack ${String(r.code)}? Items return to available stock.`)) return;
                  try { await apiPost("ops/packages/unpack", { id: r.id }); toast({ title: "Package unpacked" }); load(); }
                  catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
                }}><Undo2 className="h-3 w-3 mr-1" />Unpack</Button>
              )}
            </div>
          ) },
        ]}
        rows={rows}
      />
      {createOpen && <CreatePackageDialog onClose={(d) => { setCreateOpen(false); if (d) load(); }} />}
      {labelFor && <LabelDialog pkg={labelFor} onClose={() => setLabelFor(null)} />}
    </div>
  );
}

function CreatePackageDialog({ onClose }: { onClose: (done: boolean) => void }) {
  const [stocks, setStocks] = useState<FGStock[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [destLocationId, setDestLocationId] = useState("");
  const [lines, setLines] = useState<{ variantId: string; qty: number }[]>([{ variantId: "", qty: 0 }]);
  const [packagingCost, setPackagingCost] = useState(150);
  const [grossWeight, setGrossWeight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<FGStock[]>("ops/finished-stocks").then((all) => {
      const avail = all.filter((s) => s.warehouse.type === "MAIN" && s.qty - s.reservedQty > 0);
      setStocks(avail);
      if (avail[0]) setWarehouseId(avail[0].warehouse.id);
    }).catch((e) => setError(e.message));
    api<Location[]>("master/locations").then((ls) => setLocations(ls.filter((l) => l.type === "BUSINESS"))).catch(() => null);
  }, []);

  const totalQty = lines.reduce((a, l) => a + l.qty, 0);
  const availFor = (variantId: string, warehouseId: string) => {
    const s = stocks.find((x) => x.variant.id === variantId && x.warehouse.id === warehouseId);
    return s ? s.qty - s.reservedQty : 0;
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await apiPost("ops/packages/create", {
        sourceWarehouseId: warehouseId, destLocationId: destLocationId || null,
        items: lines.filter((l) => l.variantId && l.qty > 0),
        packagingCost, grossWeight, idempotencyKey: idem(),
      });
      toast({ title: "Package created", description: `${totalQty} pc packed — stock moved to packed state` });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Package (Box)</DialogTitle><DialogDescription>Multiple designs can go in one box. Same inventory cannot be assigned to two packages.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="space-y-1"><Label>Source warehouse *</Label>
          <Select value={warehouseId} onValueChange={(v) => { setWarehouseId(v); setLines([{ variantId: "", qty: 0 }]); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[...new Map(stocks.map((s) => [s.warehouse.id, s.warehouse])).values()].map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Planned destination (optional)</Label>
          <Select value={destLocationId} onValueChange={setDestLocationId}>
            <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Not set</SelectItem>{locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Products</Label>
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Select value={l.variantId} onValueChange={(v) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, variantId: v } : x))}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Select finished product" /></SelectTrigger>
                <SelectContent>
                  {stocks.filter((s) => s.warehouse.id === warehouseId).map((s) => (
                    <SelectItem key={s.id} value={s.variant.id}>{s.variant.sku} — {s.variant.colorName}/{s.variant.sizeName} · {s.qty - s.reservedQty} free</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="number" min={0} max={l.variantId ? availFor(l.variantId, warehouseId) : undefined} className="w-24"
                value={l.qty || ""} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} />
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setLines((l) => [...l, { variantId: "", qty: 0 }])}>Add product</Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1"><Label>Packaging cost (৳)</Label><Input type="number" value={packagingCost} onChange={(e) => setPackagingCost(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Gross weight (kg)</Label><Input type="number" step="0.1" value={grossWeight} onChange={(e) => setGrossWeight(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Total units</Label><p className="font-semibold h-9 flex items-center">{fmtNum(totalQty)}</p></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !warehouseId || totalQty <= 0} className="bg-violet-600 hover:bg-violet-700"><Boxes className="h-4 w-4 mr-1" />Pack box</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LabelDialog({ pkg, onClose }: { pkg: Pkg; onClose: () => void }) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (barcodeRef.current && pkg.barcode) {
      try {
        JsBarcode(barcodeRef.current, pkg.barcode, { format: "CODE128", height: 40, fontSize: 11, margin: 4 });
      } catch { /* ignore invalid barcode */ }
    }
  }, [pkg.barcode]);
  const totalUnits = pkg.items.reduce((a, i) => a + i.qty, 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Box Label — {pkg.boxNo}</DialogTitle><DialogDescription>Printable barcode and QR label for box-by-box verification.</DialogDescription></DialogHeader>
        <div className="rounded-lg border p-4 space-y-2 bg-white text-center">
          <p className="font-semibold text-sm">GarmentFlow · {pkg.code}</p>
          <svg ref={barcodeRef} className="mx-auto" />
          {pkg.barcode ? null : <p className="text-xs text-muted-foreground">{pkg.code}</p>}
          <div className="flex justify-center"><QRCodeSVG value={pkg.barcode ?? pkg.code} size={96} /></div>
          <div className="text-xs text-muted-foreground">
            <p>Box {pkg.boxNo} · {totalUnits} pcs · {fmtNum(Number(pkg.grossWeight), 1)} kg</p>
            <p>{pkg.items.map((i) => `${i.variant.sku} ×${i.qty}`).join(", ").slice(0, 90)}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
