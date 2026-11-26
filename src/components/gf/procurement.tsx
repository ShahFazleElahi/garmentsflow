"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiPost, fmtMoney, fmtNum, fmtDate, statusLabel, idem } from "@/lib/gf-api";
import { PageHeader, StatCard, StatusBadge, ErrorText, DataTable, type Column } from "./ui-bits";
import type { ViewProps } from "./shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, PackageOpen, FileText, ShoppingCart } from "lucide-react";

type PO = {
  id: string; code: string; type: string; status: string; orderDate: string; expectedDate: string | null;
  supplier: { id: string; name: string }; plan: { code: string; name: string } | null;
  subtotal: number; transportCost: number; total: number; paidAmount: number; supplierInvoiceNo: string | null; warehouseId: string | null;
  items: { id: string; material: { id: string; name: string; sku: string; baseUnit: string }; qty: number; unitPrice: number; receivedQty: number }[];
  receipts: unknown[];
};
type Material = { id: string; name: string; sku: string; baseUnit: string; avgCost: number };
type Partner = { id: string; name: string; type: string };
type Warehouse = { id: string; name: string; code: string; type: string };
type PlanLite = { id: string; code: string; name: string; status: string };

export function ProcurementView({ mode, user, can }: ViewProps & { mode: "purchase-orders" | "requirements" | "receiving" }) {
  const [rows, setRows] = useState<PO[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Partner[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [reqs, setReqs] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [poOpen, setPoOpen] = useState(false);
  const [receiveFor, setReceiveFor] = useState<PO | null>(null);
  const [payFor, setPayFor] = useState<PO | null>(null);

  const load = useCallback(() => {
    api<PO[]>("procurement/orders").then(setRows).catch((e) => setError(e.message));
    api<Material[]>("master/materials").then(setMaterials).catch(() => null);
    api<Partner[]>("master/partners?type=SUPPLIER").then(setSuppliers).catch(() => null);
    api<Warehouse[]>("master/warehouses").then((w) => setWarehouses(w.filter((x) => x.type === "MAIN"))).catch(() => null);
    api<PlanLite[]>("plans/plans").then((p) => setPlans(p.filter((x) => ["APPROVED", "PROCUREMENT_IN_PROGRESS", "IN_PRODUCTION", "READY_FOR_PRODUCTION", "MATERIAL_PLANNING", "BUDGET_PLANNING"].includes(x.status)))).catch(() => null);
    if (mode === "requirements") api<Record<string, unknown>[]>("procurement/requirements").then(setReqs).catch((e) => setError(e.message));
  }, [mode]);
  useEffect(() => { load(); }, [load]);

  const outstanding = rows.reduce((a, p) => a + Number(p.total) - Number(p.paidAmount), 0);
  const totalValue = rows.reduce((a, p) => a + Number(p.total), 0);

  return (
    <div className="space-y-4">
      {mode === "purchase-orders" && (
        <>
          <PageHeader
            title="Purchase Orders"
            description="Plan purchases from suppliers (Islampur & beyond). Stock increases only when receiving is posted."
            actions={can("create") ? <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setPoOpen(true)}><Plus className="h-4 w-4 mr-1" />New Purchase</Button> : undefined}
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="Purchase Orders" value={String(rows.length)} icon={<ShoppingCart className="h-4 w-4" />} />
            <StatCard title="Total Value" value={fmtMoney(totalValue)} />
            <StatCard title="Outstanding Payable" value={fmtMoney(outstanding)} tone={outstanding > 0 ? "warn" : "good"} />
            <StatCard title="Received in Full" value={String(rows.filter((r) => r.status === "RECEIVED").length)} tone="good" />
          </div>
          <ErrorText error={error} />
          <DataTable
            columns={[
              { key: "code", header: "PO No.", render: (r) => <span className="font-medium">{String(r.code)}</span> },
              { key: "supplier", header: "Supplier", value: (r) => String((r.supplier as { name: string })?.name ?? "") },
              { key: "type", header: "Type" },
              { key: "orderDate", header: "Date", render: (r) => fmtDate(String(r.orderDate)) },
              { key: "lines", header: "Lines", value: (r) => ((r.items as unknown[])?.length ?? 0) },
              { key: "total", header: "Total", render: (r) => fmtMoney(Number(r.total)) },
              { key: "paidAmount", header: "Paid", render: (r) => fmtMoney(Number(r.paidAmount)) },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
              { key: "actions", header: "", searchable: false, render: (r) => (
                <div className="flex gap-1.5">
                  {can("post") && r.status !== "RECEIVED" && r.status !== "CANCELLED" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReceiveFor(r as unknown as PO)}>Receive</Button>
                  )}
                  {can("post") && Number(r.total) - Number(r.paidAmount) > 0.01 && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPayFor(r as unknown as PO)}>Pay</Button>
                  )}
                </div>
              ) },
            ]}
            rows={rows}
          />
        </>
      )}

      {mode === "requirements" && (
        <>
          <PageHeader title="Purchase Requirements" description="Material shortages from MRP — gross requirement vs available stock and confirmed incoming." />
          <ErrorText error={error} />
          <DataTable
            columns={[
              { key: "plan", header: "Plan", render: (r) => String((r.plan as { code: string })?.code ?? "") },
              { key: "material", header: "Material", render: (r) => String((r.material as { name: string })?.name ?? "") },
              { key: "grossQty", header: "Gross req.", render: (r) => fmtNum(Number(r.grossQty), 1) },
              { key: "stockQty", header: "In stock", render: (r) => fmtNum(Number(r.stockQty), 1) },
              { key: "incomingQty", header: "Incoming", render: (r) => fmtNum(Number(r.incomingQty), 1) },
              { key: "shortageQty", header: "Shortage", render: (r) => <span className={Number(r.shortageQty) > 0 ? "text-red-600 font-medium" : ""}>{fmtNum(Number(r.shortageQty), 1)}</span> },
              { key: "suggestedQty", header: "Suggested", render: (r) => fmtNum(Number(r.suggestedQty), 1) },
              { key: "estCost", header: "Est. cost", render: (r) => fmtMoney(Number(r.estCost)) },
            ]}
            rows={reqs}
            searchable={false}
            emptyText="No open shortages — everything is covered."
          />
        </>
      )}

      {mode === "receiving" && (
        <>
          <PageHeader title="Material Receiving" description="Goods received notes (GRN). Every receipt posts inventory movements, weighted-average costing and a supplier invoice." />
          <ReceivingList />
        </>
      )}

      <NewPODialog open={poOpen} onClose={(created) => { setPoOpen(false); if (created) load(); }}
        materials={materials} suppliers={suppliers} warehouses={warehouses} plans={plans} />
      {receiveFor && (
        <ReceiveDialog po={receiveFor} warehouses={warehouses} onClose={(done) => { setReceiveFor(null); if (done) load(); }} />
      )}
      {payFor && (
        <PayDialog po={payFor} onClose={(done) => { setPayFor(null); if (done) load(); }} />
      )}
    </div>
  );
}

function ReceivingList() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => { api<Record<string, unknown>[]>("procurement/receipts").then(setRows).catch(() => null); }, []);
  return (
    <DataTable
      columns={[
        { key: "code", header: "GRN" },
        { key: "receiptDate", header: "Date", render: (r) => fmtDate(String(r.receiptDate)) },
        { key: "po", header: "PO", render: (r) => String((r.po as { code: string })?.code ?? "Direct") },
        { key: "warehouse", header: "Warehouse", render: (r) => String((r as { warehouse?: { name: string } }).warehouse?.name ?? "") },
        { key: "items", header: "Lines", value: (r) => ((r.items as unknown[])?.length ?? 0) },
        { key: "transportCost", header: "Transport", render: (r) => fmtMoney(Number(r.transportCost)) },
        { key: "notes", header: "Notes" },
      ]}
      rows={rows}
    />
  );
}

function NewPODialog({ open, onClose, materials, suppliers, warehouses, plans }: {
  open: boolean; onClose: (created: boolean) => void;
  materials: Material[]; suppliers: Partner[]; warehouses: Warehouse[]; plans: PlanLite[];
}) {
  const [supplierId, setSupplierId] = useState("");
  const [planId, setPlanId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [lines, setLines] = useState<{ materialId: string; qty: number; unitPrice: number }[]>([
    { materialId: "", qty: 0, unitPrice: 0 },
  ]);
  const [transport, setTransport] = useState(0);
  const [advance, setAdvance] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subtotal = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const total = subtotal + transport;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await apiPost("procurement/orders/create", {
        supplierId, planId: planId || null, warehouseId: warehouseId || null, expectedDate: expectedDate || undefined,
        items: lines.filter((l) => l.materialId && l.qty > 0),
        transportCost: transport, advanceAmount: advance, idempotencyKey: idem(),
      }, );
      toast({ title: "Purchase order created", description: fmtMoney(total) });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Purchase Order</DialogTitle><DialogDescription>Multiple materials per order; receive fully or partially later.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Supplier *</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Product plan (optional)</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent><SelectItem value="none">None</SelectItem>{plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Deliver to warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Expected delivery</Label><Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Materials</Label>
            <Button size="sm" variant="outline" onClick={() => setLines((l) => [...l, { materialId: "", qty: 0, unitPrice: 0 }])}><Plus className="h-3.5 w-3.5 mr-1" />Add line</Button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <Select value={l.materialId} onValueChange={(v) => {
                const mat = materials.find((m) => m.id === v);
                setLines((arr) => arr.map((x, j) => j === i ? { ...x, materialId: v, unitPrice: mat ? Number(mat.avgCost) || x.unitPrice : x.unitPrice } : x));
              }}>
                <SelectTrigger className="col-span-6"><SelectValue placeholder="Material" /></SelectTrigger>
                <SelectContent>{materials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" min={0} step="0.001" placeholder="Qty" className="col-span-2" value={l.qty || ""} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} />
              <Input type="number" min={0} step="0.01" placeholder="Unit ৳" className="col-span-3" value={l.unitPrice || ""} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, unitPrice: Number(e.target.value) } : x))} />
              <Button size="icon" variant="ghost" className="col-span-1" onClick={() => setLines((arr) => arr.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-red-500" /></Button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1"><Label>Transport cost (৳)</Label><Input type="number" value={transport} onChange={(e) => setTransport(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Advance payment (৳)</Label><Input type="number" value={advance} onChange={(e) => setAdvance(Number(e.target.value))} /></div>
          <div className="space-y-1">
            <Label>Total</Label>
            <p className="font-semibold h-9 flex items-center">{fmtMoney(total)}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !supplierId || lines.every((l) => !l.materialId)} className="bg-violet-600 hover:bg-violet-700">Create order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({ po, warehouses, onClose }: { po: PO; warehouses: Warehouse[]; onClose: (done: boolean) => void }) {
  const [lines, setLines] = useState(po.items.map((it) => ({ poItemId: it.id, materialId: it.material.name, qty: Number(it.qty) - Number(it.receivedQty), max: Number(it.qty) - Number(it.receivedQty), unitPrice: Number(it.unitPrice) })));
  const [warehouseId, setWarehouseId] = useState(po.warehouseId ?? warehouses[0]?.id ?? "");
  const [transport, setTransport] = useState(0);
  const [invoiceNo, setInvoiceNo] = useState(po.supplierInvoiceNo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(idem);
  const submitting = useRef(false);

  const value = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);

  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      await apiPost(`procurement/orders/receive`, {
        poId: po.id, warehouseId,
        items: lines.filter((l) => l.qty > 0).map((l) => ({ poItemId: l.poItemId, materialId: po.items.find((x) => x.id === l.poItemId)?.material.id ?? "", qty: l.qty, unitPrice: l.unitPrice })),
        transportCost: transport, supplierInvoiceNo: invoiceNo || undefined, idempotencyKey,
      });
      toast({ title: "Materials received", description: `GRN posted — stock updated, ৳${Math.round(value + transport).toLocaleString()} invoiced` });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { submitting.current = false; setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting.current && onClose(false)}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Receive Materials — {po.code}</DialogTitle><DialogDescription>Partial receiving supported. Transport cost is allocated into landed unit cost by value.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{l.materialId}</span>
              <span className="text-xs text-muted-foreground">outstanding {fmtNum(l.max, 1)}</span>
              <Input type="number" min={0} max={l.max} className="w-24 h-8" value={l.qty} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, qty: Math.min(Number(e.target.value), x.max) } : x))} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Supplier invoice no.</Label><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
          <div className="space-y-1"><Label>Transport / unloading (৳)</Label><Input type="number" value={transport} onChange={(e) => setTransport(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Receiving value</Label><p className="font-semibold h-9 flex items-center">{fmtMoney(value + transport)}</p></div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700"><PackageOpen className="h-4 w-4 mr-1" />Post receiving</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ po, onClose }: { po: PO; onClose: (done: boolean) => void }) {
  const [invoices, setInvoices] = useState<Record<string, unknown>[]>([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState(0);
  const [accountCode, setAccountCode] = useState("1010");
  const [accounts, setAccounts] = useState<{ code: string; name: string; type: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(idem);
  const submitting = useRef(false);

  useEffect(() => {
    api<Record<string, unknown>[]>("procurement/invoices").then((all) => {
      const mine = all.filter((i) => (i as { poId?: string }).poId === po.id && ["OPEN", "PARTIAL"].includes(String(i.status)));
      setInvoices(mine);
      if (mine[0]) {
        setInvoiceId(String(mine[0].id));
        setAmount(Number(mine[0].amount) - Number(mine[0].paidAmount));
      }
    }).catch((e) => setError(e.message));
    api<{ code: string; name: string; type: string }[]>("master/accounts").then((a) => setAccounts(a.filter((x) => ["CASH", "BANK", "MOBILE_BANKING"].includes(x.type)))).catch(() => null);
  }, [po.id]);

  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      await apiPost("procurement/payments/pay", { invoiceId, amount, accountCode, method: "CASH", idempotencyKey });
      toast({ title: "Payment posted", description: fmtMoney(amount) });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { submitting.current = false; setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting.current && onClose(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Pay Supplier — {po.supplier.name}</DialogTitle><DialogDescription>Paying an existing payable reduces the balance — no duplicate expense is created.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="space-y-1"><Label>Invoice</Label>
          <Select value={invoiceId} onValueChange={(v) => {
            setInvoiceId(v);
            const inv = invoices.find((i) => String(i.id) === v);
            if (inv) setAmount(Number(inv.amount) - Number(inv.paidAmount));
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{invoices.map((i) => <SelectItem key={String(i.id)} value={String(i.id)}>{String(i.invoiceNo)} — outstanding {fmtMoney(Number(i.amount) - Number(i.paidAmount))}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Amount (৳)</Label><Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
        <div className="space-y-1"><Label>Pay from account</Label>
          <Select value={accountCode} onValueChange={setAccountCode}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{accounts.map((a) => <SelectItem key={a.code} value={a.code}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !invoiceId || amount <= 0}><FileText className="h-4 w-4 mr-1" />Post payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
