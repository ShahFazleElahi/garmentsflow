"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiPost, fmtMoney, fmtNum, fmtDate, statusLabel, idem } from "@/lib/gf-api";
import { PageHeader, StatCard, StatusBadge, ErrorText, DataTable, type Column } from "./ui-bits";
import type { ViewProps } from "./shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Landmark, ReceiptText, Banknote, ArrowLeftRight, Calculator, Undo2 } from "lucide-react";

type Account = { id: string; code: string; name: string; type: string; currency: string; balance: number };
type JournalEntry = { id: string; entryNo: string; date: string; memo: string | null; refNo: string | null; reversedAt: string | null; lines: { id: string; account: { code: string; name: string }; debit: number; credit: number }[] };
type Expense = { id: string; code: string; date: string; category: string; description: string; amount: number; paymentStatus: string; partner: { name: string } | null };
type VendorInvoice = { id: string; invoiceNo: string; partner: { name: string; type: string }; date: string; amount: number; paidAmount: number; status: string; notes: string | null };
type Payment = { id: string; code: string; date: string; direction: string; amount: number; method: string; notes: string | null };
type ExpenseCategory = string;

const EXPENSE_CATEGORIES = ["Raw Material Purchase", "Sample Development", "Embroidery", "Tailoring", "Cutting", "Printing", "Washing", "Finishing", "Packaging", "Transportation", "Courier", "International Freight", "Customs", "Loading and Unloading", "Rent", "Office Expenses", "Employee Expenses", "Travel", "Meals", "Marketing", "Miscellaneous"];

export function FinanceView({ mode }: ViewProps & { mode: string }) {
  return (
    <div className="space-y-4">
      {mode === "finance-accounts" && <AccountsView />}
      {mode === "finance-expenses" && <ExpensesView />}
      {mode === "finance-invoices" && <VendorInvoicesView />}
      {mode === "finance-payments" && <PaymentsView />}
      {mode === "finance-journal" && <JournalView />}
      {mode === "finance-statements" && <StatementsView />}
      {mode === "costing" && <CostingView />}
    </div>
  );
}

function AccountsView() {
  const [rows, setRows] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { api<Account[]>("master/accounts").then(setRows).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const cash = rows.filter((r) => ["CASH", "BANK", "MOBILE_BANKING"].includes(r.type));
  return (
    <div className="space-y-4">
      <PageHeader title="Cash & Bank Accounts" description="Cash, bank, mobile banking (bKash/Nagad/Rocket) balances maintained by double-entry journal postings."
        actions={<Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add Account</Button>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Cash & Bank total" value={fmtMoney(cash.reduce((a, c) => a + Number(c.balance), 0))} tone="good" icon={<Landmark className="h-4 w-4" />} />
        <StatCard title="Accounts Payable" value={fmtMoney(rows.filter((r) => r.type === "PAYABLE").reduce((a, c) => a - Number(c.balance), 0))} tone="warn" />
        <StatCard title="Accounts Receivable" value={fmtMoney(rows.filter((r) => r.type === "RECEIVABLE").reduce((a, c) => a + Number(c.balance), 0))} tone="info" />
        <StatCard title="Inventory on books" value={fmtMoney(rows.filter((r) => r.type === "INVENTORY").reduce((a, c) => a + Number(c.balance), 0))} />
      </div>
      <ErrorText error={error} />
      <DataTable
        columns={[
          { key: "code", header: "Code" },
          { key: "name", header: "Account" },
          { key: "type", header: "Type", render: (r) => <span className="text-xs">{statusLabel(String(r.type))}</span> },
          { key: "currency", header: "Cur." },
          { key: "balance", header: "Balance", render: (r) => fmtMoney(Number(r.balance), String(r.currency)) },
        ]}
        rows={rows}
        searchable={false}
      />
      {open && <NewAccountDialog onClose={(d) => { setOpen(false); if (d) load(); }} />}
    </div>
  );
}

function NewAccountDialog({ onClose }: { onClose: (d: boolean) => void }) {
  const [form, setForm] = useState({ code: "", name: "", type: "BANK", currency: "BDT" });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await apiPost("master/accounts/create", form); toast({ title: "Account created" }); onClose(true); }
    catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New Account</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Code *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div className="space-y-1"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["CASH", "BANK", "MOBILE_BANKING", "PAYABLE", "RECEIVABLE", "INVENTORY", "EXPENSE", "INCOME", "EQUITY", "ADVANCE"].map((t) => <SelectItem key={t} value={t}>{statusLabel(t)}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["BDT", "GBP", "USD"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.code || !form.name}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpensesView({ can }: { can?: (p: string) => boolean }) {
  const [rows, setRows] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { api<Expense[]>("finance/expenses").then(setRows).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const monthTotal = rows.filter((r) => new Date(r.date).getMonth() === new Date().getMonth()).reduce((a, r) => a + Number(r.amount), 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Daily Expenses" description="Vendor invoice payments are NOT expenses — paying a payable only settles the balance. Recorded here: production, logistics, office and operating costs."
        actions={<Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add Expense</Button>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="This month" value={fmtMoney(monthTotal)} tone="warn" icon={<ReceiptText className="h-4 w-4" />} />
        <StatCard title="All recorded" value={fmtMoney(rows.reduce((a, r) => a + Number(r.amount), 0))} />
        <StatCard title="Entries" value={String(rows.length)} />
        <StatCard title="Top category" value={Object.entries(rows.reduce<Record<string, number>>((m, r) => { m[r.category] = (m[r.category] ?? 0) + Number(r.amount); return m; }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"} />
      </div>
      <ErrorText error={error} />
      <DataTable<Expense>
        columns={[
          { key: "code", header: "ID" },
          { key: "date", header: "Date", render: (r) => fmtDate(r.date) },
          { key: "category", header: "Category" },
          { key: "description", header: "Description" },
          { key: "partner", header: "Vendor", render: (r) => r.partner?.name ?? "—" },
          { key: "amount", header: "Amount", render: (r) => fmtMoney(Number(r.amount)) },
          { key: "paymentStatus", header: "Payment", render: (r) => <StatusBadge status={r.paymentStatus} /> },
        ]}
        rows={rows}
        pageSize={14}
      />
      {open && <NewExpenseDialog onClose={(d) => { setOpen(false); if (d) load(); }} />}
    </div>
  );
}

function NewExpenseDialog({ onClose }: { onClose: (d: boolean) => void }) {
  const [form, setForm] = useState({ category: "Miscellaneous", description: "", amount: 0, date: new Date().toISOString().slice(0, 10), accountCode: "1010", planId: "", batchId: "" });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [plans, setPlans] = useState<{ id: string; code: string; name: string; status: string }[]>([]);
  const [batches, setBatches] = useState<{ id: string; code: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Account[]>("master/accounts").then((a) => setAccounts(a.filter((x) => ["CASH", "BANK", "MOBILE_BANKING"].includes(x.type)))).catch(() => null);
    api<{ id: string; code: string; name: string; status: string }[]>("plans/plans").then((p) => setPlans(p.filter((x) => !["COMPLETED", "CANCELLED", "DRAFT"].includes(x.status)))).catch(() => null);
    api<{ id: string; code: string }[]>("production/batches").then((b) => setBatches(b.filter((x) => x.code))).catch(() => null);
  }, []);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await apiPost("finance/expenses/create", {
        category: form.category, description: form.description, amount: form.amount, date: form.date,
        accountCode: form.accountCode, planId: form.planId || null, batchId: form.batchId || null, idempotencyKey: idem(),
      });
      toast({ title: "Expense recorded", description: fmtMoney(form.amount) });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Expense</DialogTitle><DialogDescription>Batch-linked expenses flow into variant costing automatically.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Category *</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Amount (৳) *</Label><Input type="number" min={1} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></div>
          <div className="col-span-2 space-y-1"><Label>Description *</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="space-y-1"><Label>Pay from</Label>
            <Select value={form.accountCode} onValueChange={(v) => setForm({ ...form, accountCode: v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.code} value={a.code}>{a.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Product plan (optional)</Label>
            <Select value={form.planId} onValueChange={(v) => setForm({ ...form, planId: v })}><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent><SelectItem value="none">None</SelectItem>{plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Batch (optional)</Label>
            <Select value={form.batchId} onValueChange={(v) => setForm({ ...form, batchId: v })}><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent><SelectItem value="none">None</SelectItem>{batches.map((b) => <SelectItem key={b.id} value={b.id}>{b.code}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.description || form.amount <= 0}>Record expense</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VendorInvoicesView() {
  const [rows, setRows] = useState<VendorInvoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<VendorInvoice | null>(null);
  const load = useCallback(() => { api<VendorInvoice[]>("finance/invoices").then(setRows).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const outstanding = rows.filter((r) => ["OPEN", "PARTIAL"].includes(r.status)).reduce((a, r) => a + Number(r.amount) - Number(r.paidAmount), 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Vendor Invoices (Payables)" description="Supplier, factory, tailor and logistics invoices. Payments reduce the payable — never double-counted as expenses." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Invoiced total" value={fmtMoney(rows.reduce((a, r) => a + Number(r.amount), 0))} />
        <StatCard title="Outstanding" value={fmtMoney(outstanding)} tone={outstanding > 0 ? "warn" : "good"} />
        <StatCard title="Open invoices" value={String(rows.filter((r) => ["OPEN", "PARTIAL"].includes(r.status)).length)} />
        <StatCard title="Paid" value={String(rows.filter((r) => r.status === "PAID").length)} tone="good" />
      </div>
      <ErrorText error={error} />
      <DataTable
        columns={[
          { key: "invoiceNo", header: "Invoice" },
          { key: "partner", header: "Vendor", value: (r) => String((r.partner as { name: string })?.name ?? "") },
          { key: "date", header: "Date", render: (r) => fmtDate(r.date) },
          { key: "amount", header: "Amount", render: (r) => fmtMoney(Number(r.amount)) },
          { key: "paidAmount", header: "Paid", render: (r) => fmtMoney(Number(r.paidAmount)) },
          { key: "outstanding", header: "Outstanding", value: (r) => Number(r.amount) - Number(r.paidAmount), render: (r) => (
            <span className={Number(r.amount) - Number(r.paidAmount) > 0.01 ? "text-amber-600 font-medium" : "text-muted-foreground"}>{fmtMoney(Number(r.amount) - Number(r.paidAmount))}</span>
          ) },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "actions", header: "", searchable: false, render: (r) => (
            ["OPEN", "PARTIAL"].includes(String(r.status)) ? <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPayFor(r as unknown as VendorInvoice)}>Pay</Button> : null
          ) },
        ]}
        rows={rows}
        pageSize={14}
      />
      {payFor && <PayVendorDialog invoice={payFor} onClose={(d) => { setPayFor(null); if (d) load(); }} />}
    </div>
  );
}

function PayVendorDialog({ invoice, onClose }: { invoice: VendorInvoice; onClose: (d: boolean) => void }) {
  const [amount, setAmount] = useState(Number(invoice.amount) - Number(invoice.paidAmount));
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountCode, setAccountCode] = useState("1010");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Account[]>("master/accounts").then((a) => setAccounts(a.filter((x) => ["CASH", "BANK", "MOBILE_BANKING"].includes(x.type)))).catch(() => null);
  }, []);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      // find invoice id — need id from list; invoice object carries id
      await apiPost("procurement/payments/pay", { invoiceId: (invoice as unknown as { id: string }).id, amount, accountCode, method: "CASH" });
      toast({ title: "Payment posted", description: fmtMoney(amount) });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Pay {invoice.partner.name}</DialogTitle><DialogDescription>{invoice.invoiceNo} — outstanding {fmtMoney(Number(invoice.amount) - Number(invoice.paidAmount))}</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="space-y-1"><Label>Amount (৳)</Label><Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
        <div className="space-y-1"><Label>Pay from</Label>
          <Select value={accountCode} onValueChange={setAccountCode}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{accounts.map((a) => <SelectItem key={a.code} value={a.code}>{a.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || amount <= 0}><Banknote className="h-4 w-4 mr-1" />Post payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentsView() {
  const [rows, setRows] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Payment[]>("finance/payments").then(setRows).catch((e) => setError(e.message)); }, []);
  const out = rows.filter((r) => r.direction === "OUT").reduce((a, r) => a + Number(r.amount), 0);
  const inc = rows.filter((r) => r.direction === "IN").reduce((a, r) => a + Number(r.amount), 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Payments" description="All money movements: payments to vendors (OUT) and receipts from customers (IN), with method (cash, bank, bKash, Nagad, Rocket, card, international transfer)." />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard title="Paid out" value={fmtMoney(out)} tone="warn" />
        <StatCard title="Received" value={fmtMoney(inc)} tone="good" />
        <StatCard title="Transactions" value={String(rows.length)} icon={<ArrowLeftRight className="h-4 w-4" />} />
      </div>
      <ErrorText error={error} />
      <DataTable
        columns={[
          { key: "code", header: "ID" },
          { key: "date", header: "Date", render: (r) => fmtDate(r.date) },
          { key: "direction", header: "Direction", render: (r) => <span className={r.direction === "OUT" ? "text-red-600" : "text-emerald-600"}>{r.direction === "OUT" ? "Paid out" : "Received"}</span> },
          { key: "amount", header: "Amount", render: (r) => fmtMoney(Number(r.amount)) },
          { key: "method", header: "Method", render: (r) => statusLabel(r.method) },
          { key: "notes", header: "Notes" },
        ]}
        rows={rows}
        pageSize={14}
      />
    </div>
  );
}

function JournalView() {
  const [rows, setRows] = useState<JournalEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reverseFor, setReverseFor] = useState<JournalEntry | null>(null);
  const load = useCallback(() => { api<JournalEntry[]>("finance/journal").then(setRows).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4">
      <PageHeader title="Journal & General Ledger" description="Double-entry postings — every transaction is balanced (debits = credits). Posted entries are protected: reversal entries only, never deletion." />
      <ErrorText error={error} />
      <div className="space-y-2">
        {rows.map((je) => (
          <div key={je.id} className="rounded-lg border bg-white overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/40 text-xs">
              <span className="font-medium">{je.entryNo}</span>
              <span className="text-muted-foreground">{fmtDate(je.date)}</span>
              <span className="truncate max-w-sm">{je.memo}</span>
              {je.refNo ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">{je.refNo}</span> : null}
              {je.reversedAt ? <span className="text-[10px] text-red-600">REVERSED</span> : null}
              <Button size="sm" variant="ghost" className="ml-auto h-6 text-[11px]" onClick={() => setReverseFor(je)} disabled={Boolean(je.reversedAt)}>
                <Undo2 className="h-3 w-3 mr-1" />Reverse
              </Button>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {je.lines.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-3 py-1.5">{l.account.code} — {l.account.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.debit) > 0 ? fmtMoney(Number(l.debit)) : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.credit) > 0 ? fmtMoney(Number(l.credit)) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground py-10 text-center">No journal entries yet.</p>}
      </div>
      {reverseFor && (
        <Dialog open onOpenChange={(o) => !o && setReverseFor(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Reverse {reverseFor.entryNo}</DialogTitle><DialogDescription>A contra entry is posted; the original stays for audit. Reason is recorded in the audit log.</DialogDescription></DialogHeader>
            <ReverseReason onSubmit={async (reason) => {
              try { await apiPost("finance/journal/reverse", { id: reverseFor.id, reason }); toast({ title: "Entry reversed" }); setReverseFor(null); load(); }
              catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
            }} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ReverseReason({ onSubmit }: { onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for reversal…" />
      <DialogFooter>
        <Button variant="destructive" disabled={!reason} onClick={() => onSubmit(reason)}>Post reversal</Button>
      </DialogFooter>
    </div>
  );
}

function StatementsView() {
  const [type, setType] = useState("trial");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Record<string, unknown>>(`finance/statements?type=${type}`).then(setData).catch((e) => setError(e.message));
  }, [type]);
  useEffect(() => { load(); }, [load]);

  const renderRows = (rows: Record<string, unknown>[], cols: [string, string][]) => (
    <div className="rounded-lg border divide-y max-w-2xl">
      {rows.map((r, i) => (
        <div key={i} className="flex justify-between px-3 py-1.5 text-[13px]">
          <span className="truncate">{String(r[cols[0][0]] ?? "")} <span className="text-muted-foreground text-xs">{cols[0][1] && cols[0][1] !== "name" ? String(r[cols[0][1]] ?? "") : ""}</span></span>
          <span className="tabular-nums font-medium">{fmtMoney(Number(r[cols[1][0]] ?? 0))}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="px-3 py-4 text-xs text-muted-foreground text-center">No data for this period.</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Financial Statements" description="Trial balance, income statement, balance sheet and cash flow — all built from posted journal entries." />
      <Tabs value={type} onValueChange={setType}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="trial" className="text-xs">Trial Balance</TabsTrigger>
          <TabsTrigger value="pl" className="text-xs">Income Statement</TabsTrigger>
          <TabsTrigger value="bs" className="text-xs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="cashflow" className="text-xs">Cash Flow</TabsTrigger>
        </TabsList>
      </Tabs>
      <ErrorText error={error} />
      {!data ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="space-y-2">
          {type === "trial" && (
            <>
              {renderRows((data.rows as Record<string, unknown>[]) ?? [], [["name", "code"], ["debit", ""]])}
              <div className="flex justify-between max-w-2xl text-sm font-medium border-t pt-2">
                <span>Totals</span><span>{fmtMoney(Number(data.totalDebit))} = {fmtMoney(Number(data.totalCredit))} {Number(data.totalDebit) === Number(data.totalCredit) ? "✓ balanced" : "⚠ imbalance"}</span>
              </div>
            </>
          )}
          {type === "pl" && (
            <>
              <p className="text-sm font-medium">Income</p>
              {renderRows((data.income as Record<string, unknown>[]) ?? [], [["name", "code"], ["amount", ""]])}
              <p className="text-sm font-medium pt-2">Expenses</p>
              {renderRows((data.expense as Record<string, unknown>[]) ?? [], [["name", "code"], ["amount", ""]])}
              <div className="flex justify-between max-w-2xl text-sm font-medium border-t pt-2">
                <span>Net profit</span><span className={Number(data.netProfit) >= 0 ? "text-emerald-600" : "text-red-600"}>{fmtMoney(Number(data.netProfit))}</span>
              </div>
            </>
          )}
          {type === "bs" && (
            <>
              <p className="text-sm font-medium">Assets</p>
              {renderRows((data.assets as Record<string, unknown>[]) ?? [], [["name", "code"], ["amount", ""]])}
              <p className="text-sm font-medium pt-2">Liabilities</p>
              {renderRows((data.liabilities as Record<string, unknown>[]) ?? [], [["name", "code"], ["amount", ""]])}
              <p className="text-sm font-medium pt-2">Equity</p>
              {renderRows((data.equity as Record<string, unknown>[]) ?? [], [["name", "code"], ["amount", ""]])}
              <div className="flex justify-between max-w-2xl text-sm font-medium border-t pt-2">
                <span>Assets = Liabilities + Equity</span>
                <span>{fmtMoney(Number(data.totalAssets))} = {fmtMoney(Number(data.totalLiabilities))} + {fmtMoney(Number(data.totalEquity))}</span>
              </div>
            </>
          )}
          {type === "cashflow" && (
            <>
              {renderRows((data.rows as Record<string, unknown>[]) ?? [], [["name", ""], ["net", ""]])}
              <div className="flex justify-between max-w-2xl text-sm font-medium border-t pt-2">
                <span>Net cash movement</span><span className={Number(data.net) >= 0 ? "text-emerald-600" : "text-red-600"}>{fmtMoney(Number(data.net))}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CostingView() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [plans, setPlans] = useState<{ id: string; code: string; name: string }[]>([]);
  const [planId, setPlanId] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Record<string, unknown>[]>(`finance/costing${planId !== "all" ? `?planId=${planId}` : ""}`).then(setRows).catch((e) => setError(e.message));
  }, [planId]);
  useEffect(() => {
    api<{ id: string; code: string; name: string }[]>("plans/plans").then(setPlans).catch(() => null);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Product Costing"
        description="Automatic costing engine: material consumption + service charges + transport + landed costs per variant. Finalized costs are locked; provisional costs update as transactions post."
        actions={(
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger className="w-56 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      />
      <ErrorText error={error} />
      <DataTable
        columns={[
          { key: "sku", header: "Variant", render: (r) => {
            const v = r.variant as { sku: string; colorName: string; sizeName: string } | undefined;
            return <span className="font-medium text-xs">{v?.sku ?? "—"}</span>;
          } },
          { key: "color", header: "Color", value: (r) => String((r.variant as { colorName: string } | undefined)?.colorName ?? "") },
          { key: "size", header: "Size", value: (r) => String((r.variant as { sizeName: string } | undefined)?.sizeName ?? "") },
          { key: "materialCost", header: "Material", render: (r) => fmtMoney(Number(r.materialCost)) },
          { key: "serviceCost", header: "Services", render: (r) => fmtMoney(Number(r.serviceCost)) },
          { key: "transportCost", header: "Transport", render: (r) => fmtMoney(Number(r.transportCost)) },
          { key: "otherCost", header: "Other landed", render: (r) => fmtMoney(Number(r.otherCost)) },
          { key: "mfgCost", header: "Mfg cost", render: (r) => <strong>{fmtMoney(Number(r.mfgCost))}</strong> },
          { key: "landedCostBdt", header: "Landed cost", render: (r) => fmtMoney(Number(r.landedCostBdt)) },
          { key: "finalized", header: "State", render: (r) => <StatusBadge status={r.finalized ? "COMPLETED" : "IN_PROGRESS"} /> },
        ]}
        rows={rows}
        pageSize={14}
        emptyText="No costing data yet — costs build from work order collections, shipments and batch expenses."
      />
      <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Calculator className="h-3 w-3" />Only actual consumed materials are costed. Unused returns remain in inventory. Abnormal waste is expensed, not capitalized.</p>
    </div>
  );
}
