"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiPost, fmtMoney, fmtNum, fmtDate, statusLabel, idem } from "@/lib/gf-api";
import { PageHeader, StatCard, StatusBadge, ErrorText, DataTable, type Column } from "./ui-bits";
import type { ViewProps } from "./shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Store, TrendingUp } from "lucide-react";

type SalesInvoice = {
  id: string; code: string; type: string; invoiceDate: string; currency: string; exchangeRate: number; subtotal: number;
  discountAmount: number; total: number; paidAmount: number; cogs: number; status: string;
  customer: { id: string; name: string; type: string };
  items: { id: string; qty: number; unitPrice: number; lineTotal: number; variant: { sku: string; colorName: string; sizeName: string } }[];
};
type FGStock = { id: string; qty: number; unitCost: number; variant: { id: string; sku: string; colorName: string; sizeName: string }; warehouse: { id: string; name: string; type: string; location: { name: string } } };
type Partner = { id: string; name: string; type: string };
type Account = { id: string; code: string; name: string; type: string };

export function SalesView({ can }: ViewProps) {
  const [rows, setRows] = useState<SalesInvoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [payFor, setPayFor] = useState<SalesInvoice | null>(null);

  const load = useCallback(() => {
    api<SalesInvoice[]>("finance/sales").then(setRows).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const revenue = rows.filter(r => r.status !== "CANCELLED").reduce((a, r) => a + Number(r.total) * Number(r.exchangeRate), 0);
  const cogs = rows.filter(r => r.status !== "CANCELLED").reduce((a, r) => a + Number(r.cogs), 0);
  const outstanding = rows.filter((r) => ["CONFIRMED", "PARTIAL"].includes(r.status)).reduce((a, r) => a + (Number(r.total) - Number(r.paidAmount)) * Number(r.exchangeRate), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales Invoices"
        description="Wholesale & retail sales from Dhaka, Sylhet and the UK. Revenue and COGS post per accounting policy — stock transfers never count as sales."
        actions={can("create") ? <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />New Sale</Button> : undefined}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Revenue" value={fmtMoney(revenue)} tone="good" icon={<Store className="h-4 w-4" />} />
        <StatCard title="COGS" value={fmtMoney(cogs)} />
        <StatCard title="Gross profit" value={fmtMoney(revenue - cogs)} tone={revenue - cogs >= 0 ? "good" : "bad"} sub={revenue > 0 ? `${Math.round(((revenue - cogs) / revenue) * 100)}% margin` : ""} icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard title="Receivable" value={fmtMoney(outstanding)} tone={outstanding > 0 ? "warn" : "default"} />
      </div>
      <ErrorText error={error} />
      <DataTable<SalesInvoice>
        columns={[
          { key: "code", header: "Invoice" },
          { key: "invoiceDate", header: "Date", render: (r) => fmtDate(r.invoiceDate) },
          { key: "customer", header: "Customer", value: (r) => String((r.customer as { name: string })?.name ?? "") },
          { key: "type", header: "Type", render: (r) => <span className="text-xs">{statusLabel(String(r.type))}</span> },
          { key: "currency", header: "Cur." },
          { key: "total", header: "Total", render: (r) => fmtMoney(Number(r.total), String(r.currency)) },
          { key: "cogs", header: "COGS", render: (r) => fmtMoney(Number(r.cogs)) },
          { key: "gp", header: "Gross profit", value: (r) => Number(r.total) * Number(r.exchangeRate) - Number(r.cogs), render: (r) => {
            const gp = Number(r.total) * Number(r.exchangeRate) - Number(r.cogs);
            return <span className={gp >= 0 ? "text-emerald-600" : "text-red-600"}>{fmtMoney(gp)}</span>;
          } },
          { key: "paidAmount", header: "Paid", render: (r) => fmtMoney(Number(r.paidAmount), String(r.currency)) },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "actions", header: "", searchable: false, render: (r) => (
            ["CONFIRMED", "PARTIAL"].includes(String(r.status)) ? <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPayFor(r as unknown as SalesInvoice)}>Receive payment</Button> : null
          ) },
        ]}
        rows={rows}
        pageSize={12}
      />
      {createOpen && <NewSaleDialog onClose={(d) => { setCreateOpen(false); if (d) load(); }} />}
      {payFor && <ReceivePaymentDialog invoice={payFor} onClose={(d) => { setPayFor(null); if (d) load(); }} />}
    </div>
  );
}

function NewSaleDialog({ onClose }: { onClose: (d: boolean) => void }) {
  const [stocks, setStocks] = useState<FGStock[]>([]);
  const [customers, setCustomers] = useState<Partner[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [type, setType] = useState("WHOLESALE");
  const [currency, setCurrency] = useState("BDT");
  const [lines, setLines] = useState<{ variantId: string; qty: number; unitPrice: number }[]>([{ variantId: "", qty: 0, unitPrice: 0 }]);
  const [paidAmount, setPaidAmount] = useState(0);
  const [paymentAccountCode, setPaymentAccountCode] = useState("1010");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [idempotencyKey] = useState(() => idem());

  useEffect(() => {
    api<FGStock[]>("ops/finished-stocks").then((all) => setStocks(all.filter((s) => s.warehouse.type === "MAIN" && s.qty > 0))).catch((e) => setError(e.message));
    api<Partner[]>("master/partners?type=CUSTOMER").then(setCustomers).catch(() => null);
    api<Account[]>("master/accounts").then((a) => setAccounts(a.filter((x) => ["CASH", "BANK", "MOBILE_BANKING"].includes(x.type)))).catch(() => null);
  }, []);

  const whStocks = stocks.filter((s) => s.warehouse.id === warehouseId);
  const warehouses = [...new Map(stocks.map((s) => [s.warehouse.id, s.warehouse])).values()];
  const total = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const cogsEst = lines.reduce((a, l) => {
    const s = stocks.find((x) => x.variant.id === l.variantId && x.warehouse.id === warehouseId);
    return a + l.qty * Number(s?.unitCost ?? 0);
  }, 0);
  const [rates, setRates] = useState<Record<string, number>>({});
  useEffect(() => { api<{latest: Record<string,number>}>("master/exchange-rates").then(r => setRates(r.latest)).catch(() => null); }, []);
  const fx = currency === "BDT" ? 1 : rates[`${currency}_BDT`] ?? 0;

  const submit = async () => {
    if (submitting.current) return;
    if (fx <= 0) { setError("Configure the currency exchange rate in master settings before selling."); return; }
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      await apiPost("finance/sales/create", {
        customerId, type, warehouseId, currency, exchangeRate: fx,
        items: lines.filter((l) => l.variantId && l.qty > 0),
        paidAmount, paymentAccountCode, idempotencyKey,
      });
      toast({ title: "Sale recorded", description: `Revenue ${fmtMoney(total, currency)} · est. gross profit ${fmtMoney(total * fx - cogsEst)}` });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { submitting.current = false; setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting.current && onClose(false)}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Sale</DialogTitle><DialogDescription>Stock is deducted and COGS posted at weighted-average unit cost.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1"><Label>Customer *</Label>
            <Select value={customerId} onValueChange={setCustomerId}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Sale type</Label>
            <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="WHOLESALE">Wholesale</SelectItem><SelectItem value="RETAIL">Retail</SelectItem></SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Ship from warehouse</Label>
            <Select value={warehouseId} onValueChange={(v) => { setWarehouseId(v); setLines([{ variantId: "", qty: 0, unitPrice: 0 }]); }}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Currency</Label>
            <Select value={currency} onValueChange={setCurrency}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["BDT", "GBP", "USD"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Items</Label>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <Select value={l.variantId} onValueChange={(v) => {
                const s = stocks.find((x) => x.variant.id === v && x.warehouse.id === warehouseId);
                setLines((arr) => arr.map((x, j) => j === i ? { ...x, variantId: v, unitPrice: x.unitPrice || Math.round((Number(s?.unitCost ?? 0) * 1.5) / fx) } : x));
              }}>
                <SelectTrigger className="col-span-6"><SelectValue placeholder="Variant" /></SelectTrigger>
                <SelectContent>{whStocks.map((s) => <SelectItem key={s.id} value={s.variant.id}>{s.variant.sku} — {s.qty} available</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" min={0} placeholder="Qty" className="col-span-2" value={l.qty || ""} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} />
              <Input type="number" min={0} placeholder={`Price ${currency}`} className="col-span-3" value={l.unitPrice || ""} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, unitPrice: Number(e.target.value) } : x))} />
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setLines((l) => [...l, { variantId: "", qty: 0, unitPrice: 0 }])}>Add line</Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1"><Label>Total ({currency})</Label><p className="font-semibold h-9 flex items-center">{fmtMoney(total, currency)}</p></div>
          <div className="space-y-1"><Label>Received now ({currency})</Label><Input type="number" value={paidAmount || ""} onChange={(e) => setPaidAmount(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Receive in</Label>
            <Select value={paymentAccountCode} onValueChange={setPaymentAccountCode}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.code} value={a.code}>{a.name}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Est. COGS ৳{fmtNum(cogsEst)} · est. gross profit ৳{fmtNum(total * fx - cogsEst)}</p>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !customerId || !warehouseId || total <= 0} className="bg-violet-600 hover:bg-violet-700">Record sale</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceivePaymentDialog({ invoice, onClose }: { invoice: SalesInvoice; onClose: (d: boolean) => void }) {
  const [amount, setAmount] = useState(() => Number((Number(invoice.total) - Number(invoice.paidAmount)).toFixed(2)));
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountCode, setAccountCode] = useState("1010");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [idempotencyKey] = useState(() => idem());
  useEffect(() => {
    api<Account[]>("master/accounts").then((a) => setAccounts(a.filter((x) => ["CASH", "BANK", "MOBILE_BANKING"].includes(x.type)))).catch(() => null);
  }, []);
  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      await apiPost("finance/sales/payment", { invoiceId: invoice.id, amount, accountCode, method: "BANK", idempotencyKey });
      toast({ title: "Payment received", description: fmtMoney(amount, invoice.currency) });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { submitting.current = false; setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !submitting.current && onClose(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Receive Payment — {invoice.code}</DialogTitle><DialogDescription>{invoice.customer.name} — outstanding {fmtMoney(Number(invoice.total) - Number(invoice.paidAmount), invoice.currency)}</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="space-y-1"><Label>Amount ({invoice.currency})</Label><Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
        <div className="space-y-1"><Label>Into account</Label>
          <Select value={accountCode} onValueChange={setAccountCode}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{accounts.map((a) => <SelectItem key={a.code} value={a.code}>{a.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || amount <= 0}>Receive</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
