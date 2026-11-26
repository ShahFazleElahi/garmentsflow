"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { Plus, Send, PackageOpen, Factory, Scissors, Printer, Waves, Sparkles } from "lucide-react";

type Batch = {
  id: string; code: string; plannedQty: number; status: string; startDate: string | null;
  expectedCompletionDate: string | null; priority: string; estBudget: number; notes: string | null;
  plan: { id: string; code: string; name: string; unit: string };
  variants: { id: string; variant: { sku: string; colorName: string; sizeName: string }; plannedQty: number; completedQty: number }[];
  workOrders: { id: string; code: string; type: string; status: string; issuedQty: number; acceptedQty: number; partner: { name: string } }[];
};
type WorkOrder = {
  id: string; code: string; type: string; status: string; issuedQty: number; receivedQty: number; acceptedQty: number;
  rejectedQty: number; damagedQty: number; missingQty: number; estServiceCost: number; actualServiceCost: number;
  paidAmount: number; dispatchDate: string | null; expectedDate: string | null; instructions: string | null;
  partner: { id: string; name: string; type: string };
  batch: { id: string; code: string; plan: { code: string; name: string } };
  materials: { id: string; material: { id: string; name: string; sku: string; baseUnit: string }; issuedQty: number; consumedQty: number; returnedQty: number; wastedQty: number; remainingQty: number }[];
  receipts: { id: string; code: string; receiptDate: string; receivedQty: number; acceptedQty: number; rejectedQty: number; damagedQty: number; missingQty: number; serviceCharge: number }[];
};
type MaterialStock = { id: string; qty: number; reservedQty: number; avgCost: number; material: { id: string; name: string; baseUnit: string }; warehouse: { id: string; name: string; type: string } };

const WO_TYPES = ["EMBROIDERY", "TAILORING", "CUTTING", "PRINTING", "WASHING", "FINISHING", "OTHER"];
const TYPE_ICON: Record<string, React.ElementType> = { EMBROIDERY: Factory, TAILORING: Scissors, CUTTING: Scissors, PRINTING: Printer, WASHING: Waves, FINISHING: Sparkles, OTHER: PackageOpen };

export function ProductionView({ mode, can }: ViewProps & { mode: "batches" | "workorders" }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [wos, setWos] = useState<WorkOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [woDetail, setWoDetail] = useState<WorkOrder | null>(null);
  const [newWo, setNewWo] = useState<Batch | null>(null);
  const [issueFor, setIssueFor] = useState<WorkOrder | null>(null);
  const [tab, setTab] = useState("ALL");

  const load = useCallback(() => {
    if (mode === "batches") api<Batch[]>("production/batches").then(setBatches).catch((e) => setError(e.message));
    else api<WorkOrder[]>("production/workorders").then(setWos).catch((e) => setError(e.message));
  }, [mode]);
  useEffect(() => { load(); }, [load]);

  const planned = batches.reduce((a, b) => a + b.plannedQty, 0);
  const completed = batches.reduce((a, b) => a + b.variants.reduce((x, v) => x + v.completedQty, 0), 0);

  return (
    <div className="space-y-4">
      {mode === "batches" ? (
        <>
          <PageHeader title="Production Batches" description="Batches are created from approved plans; quantities cannot exceed the approved plan." />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="Batches" value={String(batches.length)} />
            <StatCard title="Planned" value={fmtNum(planned)} />
            <StatCard title="Completed" value={fmtNum(completed)} tone="good" />
            <StatCard title="In Progress" value={String(batches.filter((b) => ["IN_PROGRESS", "PARTIAL", "MATERIAL_RESERVED"].includes(b.status)).length)} tone="info" />
          </div>
          <ErrorText error={error} />
          <div className="space-y-2">
            {batches.map((b) => {
              const done = b.variants.reduce((a, v) => a + v.completedQty, 0);
              return (
                <div key={b.id} className="rounded-lg border bg-white p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm">{b.code}</span>
                    <StatusBadge status={b.status} />
                    <span className="text-xs text-muted-foreground">{b.plan.code} — {b.plan.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">due {fmtDate(b.expectedCompletionDate)}</span>
                  </div>
                  <Progress value={b.plannedQty > 0 ? (done / b.plannedQty) * 100 : 0} className="h-2" />
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">{fmtNum(done)}/{fmtNum(b.plannedQty)} completed ·</span>
                    {b.workOrders.map((w) => (
                      <button key={w.id} className="px-1.5 py-0.5 rounded bg-muted hover:bg-violet-100" onClick={() => api<WorkOrder>(`production/workorders/${w.id}`).then(setWoDetail)}>
                        {w.type} · {w.partner.name} · {w.acceptedQty}/{w.issuedQty}
                      </button>
                    ))}
                    {can("create") && <Button size="sm" variant="outline" className="h-6 text-[11px] ml-1" onClick={() => setNewWo(b)}><Plus className="h-3 w-3 mr-0.5" />Work order</Button>}
                  </div>
                </div>
              );
            })}
            {batches.length === 0 && <p className="text-sm text-muted-foreground py-10 text-center">No batches — create one from an approved product plan.</p>}
          </div>
        </>
      ) : (
        <>
          <PageHeader title="Work Orders" description="Outsourced processing: embroidery, tailoring, cutting, printing, washing, finishing. Issue materials → vendor custody → partial collection with reconciliation." />
          <ErrorText error={error} />
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="ALL" className="text-xs">All ({wos.length})</TabsTrigger>
              {WO_TYPES.map((t) => (
                <TabsTrigger key={t} value={t} className="text-xs">{t} ({wos.filter((w) => w.type === t).length})</TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={tab} className="mt-3">
              <DataTable
                columns={[
                  { key: "code", header: "WO", render: (r) => (
                    <button className="font-medium text-violet-700 hover:underline" onClick={() => setWoDetail(wos.find((w) => w.id === r.id) ?? null)}>{String(r.code)}</button>
                  ) },
                  { key: "type", header: "Type", render: (r) => <StatusBadge status={String(r.type)} /> },
                  { key: "partner", header: "Vendor", value: (r) => String((r.partner as { name: string })?.name ?? "") },
                  { key: "batch", header: "Batch", value: (r) => String((r.batch as { code: string })?.code ?? "") },
                  { key: "issuedQty", header: "Issued", render: (r) => fmtNum(Number(r.issuedQty)) },
                  { key: "acceptedQty", header: "Accepted", render: (r) => fmtNum(Number(r.acceptedQty)) },
                  { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
                  { key: "expectedDate", header: "Due", render: (r) => fmtDate(r.expectedDate ? String(r.expectedDate) : null) },
                  { key: "actions", header: "", searchable: false, render: (r) => (
                    <div className="flex gap-1.5">
                      {can("post") && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setIssueFor(wos.find((w) => w.id === r.id) ?? null)}>Issue / Collect</Button>}
                    </div>
                  ) },
                ]}
                rows={(tab === "ALL" ? wos : wos.filter((w) => w.type === tab))}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      {woDetail && <WorkOrderDetail wo={woDetail} onClose={() => setWoDetail(null)} />}
      {newWo && <NewWorkOrderDialog batch={newWo} onClose={(done) => { setNewWo(null); if (done) load(); }} />}
      {issueFor && <IssueCollectDialog wo={issueFor} onClose={(done) => { setIssueFor(null); if (done) { load(); } }} />}
    </div>
  );
}

function WorkOrderDetail({ wo, onClose }: { wo: WorkOrder; onClose: () => void }) {
  const Icon = TYPE_ICON[wo.type] ?? PackageOpen;
  const issuedTotal = wo.materials.reduce((a, m) => a + Number(m.issuedQty), 0);
  const reconciled = wo.materials.every((m) => Math.abs(Number(m.issuedQty) - Number(m.consumedQty) - Number(m.returnedQty) - Number(m.wastedQty) - Number(m.remainingQty)) < 0.001);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Icon className="h-5 w-5 text-violet-500" />{wo.code} — {wo.type} <StatusBadge status={wo.status} /></DialogTitle>
          <DialogDescription>{wo.batch.plan.code} · {wo.batch.code} · {wo.partner.name}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Issued qty</p><p className="font-medium">{fmtNum(wo.issuedQty)}</p></div>
          <div><p className="text-xs text-muted-foreground">Received / Accepted</p><p className="font-medium">{fmtNum(wo.receivedQty)} / {fmtNum(wo.acceptedQty)}</p></div>
          <div><p className="text-xs text-muted-foreground">Rejected / Damaged / Missing</p><p className="font-medium">{wo.rejectedQty} / {wo.damagedQty} / {wo.missingQty}</p></div>
          <div><p className="text-xs text-muted-foreground">Service cost</p><p className="font-medium">{fmtMoney(wo.actualServiceCost)} <span className="text-xs text-muted-foreground">/ est {fmtMoney(wo.estServiceCost)}</span></p></div>
        </div>
        {wo.instructions ? <p className="text-xs text-muted-foreground border-l-2 border-violet-300 pl-2">{wo.instructions}</p> : null}

        <div>
          <p className="text-sm font-medium mb-1.5">Material reconciliation <span className={reconciled ? "text-emerald-600 text-xs" : "text-amber-600 text-xs"}>{reconciled ? "✓ balanced" : "pending collection"}</span></p>
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-muted/50 text-left">
                <th className="px-2 py-1.5">Material</th><th className="px-2 py-1.5">Issued</th><th className="px-2 py-1.5">Consumed</th>
                <th className="px-2 py-1.5">Returned</th><th className="px-2 py-1.5">Wasted</th><th className="px-2 py-1.5">At vendor</th>
              </tr></thead>
              <tbody>
                {wo.materials.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="px-2 py-1.5">{m.material.name}</td>
                    <td className="px-2 py-1.5 tabular-nums">{fmtNum(Number(m.issuedQty), 1)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{fmtNum(Number(m.consumedQty), 1)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{fmtNum(Number(m.returnedQty), 1)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{fmtNum(Number(m.wastedQty), 1)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{fmtNum(Number(m.remainingQty), 1)}</td>
                  </tr>
                ))}
                {wo.materials.length === 0 && <tr><td colSpan={6} className="px-2 py-3 text-center text-muted-foreground">No materials issued yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium mb-1.5">Collection receipts ({wo.receipts.length})</p>
          <div className="space-y-1.5">
            {wo.receipts.filter((r) => r.receivedQty > 0).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs rounded border px-2.5 py-1.5">
                <span className="font-medium">{r.code}</span>
                <span className="text-muted-foreground">{fmtDate(r.receiptDate)}</span>
                <span>recv {r.receivedQty} · ok {r.acceptedQty} · rej {r.rejectedQty} · dmg {r.damagedQty} · miss {r.missingQty}</span>
                <span className="ml-auto">{fmtMoney(r.serviceCharge)}</span>
              </div>
            ))}
            {wo.receipts.filter((r) => r.receivedQty > 0).length === 0 && <p className="text-xs text-muted-foreground">No collections yet.</p>}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewWorkOrderDialog({ batch, onClose }: { batch: Batch; onClose: (done: boolean) => void }) {
  const [type, setType] = useState("EMBROIDERY");
  const [partnerId, setPartnerId] = useState("");
  const [partners, setPartners] = useState<{ id: string; name: string; type: string }[]>([]);
  const [issuedQty, setIssuedQty] = useState(batch.plannedQty);
  const [perPiece, setPerPiece] = useState(0);
  const [fixed, setFixed] = useState(0);
  const [transport, setTransport] = useState(0);
  const [expectedDate, setExpectedDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ id: string; name: string; type: string }[]>("master/partners").then((all) => {
      const relevant = all.filter((p) => ["EMBROIDERY_FACTORY", "TAILOR", "PROCESSING"].includes(p.type) ||
        (type === "EMBROIDERY" && p.type === "EMBROIDERY_FACTORY") || (type === "TAILORING" && p.type === "TAILOR"));
      setPartners(relevant);
    }).catch(() => null);
  }, [type]);

  const est = issuedQty * perPiece + fixed;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await apiPost("production/workorders/create", {
        batchId: batch.id, type, partnerId, issuedQty,
        pricing: { perPiece, fixed }, transportCost: transport,
        expectedDate: expectedDate || undefined, instructions: instructions || undefined,
      });
      toast({ title: "Work order created", description: "Issue materials to dispatch the vendor." });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New Work Order — {batch.code}</DialogTitle><DialogDescription>Outsource a production stage to a vendor. Issue materials afterwards to dispatch.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Stage type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{WO_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Vendor *</Label>
            <Select value={partnerId} onValueChange={setPartnerId}>
              <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>{partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.type.replaceAll("_", " ")})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Issued quantity (pc)</Label><Input type="number" min={1} max={batch.plannedQty} value={issuedQty} onChange={(e) => setIssuedQty(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Expected delivery</Label><Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></div>
          <div className="space-y-1"><Label>Service charge / pc (৳)</Label><Input type="number" value={perPiece} onChange={(e) => setPerPiece(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Fixed charge (৳)</Label><Input type="number" value={fixed} onChange={(e) => setFixed(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Transport cost (৳)</Label><Input type="number" value={transport} onChange={(e) => setTransport(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Estimated service cost</Label><p className="font-semibold h-9 flex items-center">{fmtMoney(est)}</p></div>
          <div className="col-span-2 space-y-1"><Label>Production instructions</Label><Textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Front panel embroidery per frozen design DSG-001" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !partnerId || issuedQty <= 0} className="bg-violet-600 hover:bg-violet-700"><Send className="h-4 w-4 mr-1" />Create work order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueCollectDialog({ wo, onClose }: { wo: WorkOrder; onClose: (done: boolean) => void }) {
  const [mode, setMode] = useState<"issue" | "collect">(["DRAFT", "MATERIALS_PREPARED"].includes(wo.status) ? "issue" : "collect");
  const [stocks, setStocks] = useState<MaterialStock[]>([]);
  const [mainWarehouseId, setMainWarehouseId] = useState("");
  const [issueLines, setIssueLines] = useState<{ materialId: string; qty: number }[]>([{ materialId: "", qty: 0 }]);
  // collect state
  const [received, setReceived] = useState(wo.issuedQty - wo.receivedQty - wo.missingQty);
  const [accepted, setAccepted] = useState(wo.issuedQty - wo.receivedQty - wo.missingQty);
  const [rejected, setRejected] = useState(0);
  const [damaged, setDamaged] = useState(0);
  const [missing, setMissing] = useState(0);
  const [pending, setPending] = useState(0);
  const [consumed, setConsumed] = useState<Record<string, number>>({});
  const [returned, setReturned] = useState<Record<string, number>>({});
  const [wasted, setWasted] = useState<Record<string, number>>({});
  const [serviceCharge, setServiceCharge] = useState(0);
  const [transportCost, setTransportCost] = useState(0);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collectionKey] = useState(idem);
  const submitting = useRef(false);

  useEffect(() => {
    api<MaterialStock[]>("inventory/stocks").then((all) => {
      const main = all.filter((s) => s.warehouse.type === "MAIN");
      setStocks(main);
      if (main[0]) setMainWarehouseId(main[0].warehouse.id);
    }).catch(() => null);
    // default service charge from pricing
    api<WorkOrder>(`production/workorders/${wo.id}`).then((fresh) => {
      try {
        const pricing = JSON.parse((fresh as unknown as { pricingJson: string }).pricingJson ?? "{}") as { perPiece?: number };
        const remaining = fresh.issuedQty - fresh.receivedQty - fresh.missingQty;
        setServiceCharge(Math.round(remaining * (pricing.perPiece ?? 0)));
      } catch { /* default 0 */ }
    }).catch(() => null);
  }, [wo.id, wo.issuedQty, wo.receivedQty]);

  const outstanding = wo.issuedQty - wo.receivedQty - wo.missingQty;

  const submitIssue = async () => {
    setBusy(true); setError(null);
    try {
      await apiPost("production/workorders/issue", {
        workOrderId: wo.id, fromWarehouseId: mainWarehouseId,
        items: issueLines.filter((l) => l.materialId && l.qty > 0),
      });
      toast({ title: "Materials issued to vendor custody" });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const submitCollect = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      await apiPost("production/workorders/receive", {
        workOrderId: wo.id, receivedQty: received, acceptedQty: accepted, rejectedQty: rejected,
        damagedQty: damaged, missingQty: missing, pendingQty: pending,
        consumed, returned, wasted, remaining: {},
        serviceCharge, transportCost, invoiceNo: invoiceNo || undefined, idempotencyKey: collectionKey,
      });
      toast({ title: "Collection recorded", description: "Materials reconciled and vendor invoiced." });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { submitting.current = false; setBusy(false); }
  };

  const accounted = accepted + rejected + damaged + missing + pending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{wo.code} — {mode === "issue" ? "Issue Materials" : "Collect from Vendor"}</DialogTitle>
          <DialogDescription>{wo.partner.name} · {statusLabel(wo.status)} · issued {wo.issuedQty}, collected {wo.receivedQty}</DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "issue" | "collect")}>
          <TabsList className="w-full"><TabsTrigger value="issue" className="flex-1 text-xs">1 · Issue materials</TabsTrigger><TabsTrigger value="collect" className="flex-1 text-xs">2 · Collect & reconcile</TabsTrigger></TabsList>

          <TabsContent value="issue" className="space-y-3 pt-2">
            <div className="space-y-2">
              {issueLines.map((l, i) => {
                const whStocks = stocks.filter((s) => s.warehouse.id === mainWarehouseId);
                return (
                  <div key={i} className="flex gap-2">
                    <Select value={l.materialId} onValueChange={(v) => setIssueLines((arr) => arr.map((x, j) => j === i ? { ...x, materialId: v } : x))}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Material" /></SelectTrigger>
                      <SelectContent>{whStocks.map((s) => <SelectItem key={s.id} value={s.material.id}>{s.material.name} — {fmtNum(Number(s.qty) - Number(s.reservedQty), 1)} {s.material.baseUnit} free</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" min={0} step="0.001" className="w-28" value={l.qty || ""} onChange={(e) => setIssueLines((arr) => arr.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} />
                  </div>
                );
              })}
              <Button size="sm" variant="outline" onClick={() => setIssueLines((l) => [...l, { materialId: "", qty: 0 }])}>Add line</Button>
            </div>
            <div className="space-y-1"><Label>Issue from warehouse</Label>
              <Select value={mainWarehouseId} onValueChange={setMainWarehouseId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[...new Map(stocks.map((s) => [s.warehouse.id, s.warehouse])).values()].map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">Materials move into the vendor&apos;s virtual custody location and remain business-owned until consumed / returned / reconciled.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
              <Button onClick={submitIssue} disabled={busy} className="bg-violet-600 hover:bg-violet-700"><Send className="h-4 w-4 mr-1" />Dispatch to vendor</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="collect" className="space-y-3 pt-2">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {([["received", setReceived, received, outstanding], ["accepted", setAccepted, accepted, received], ["rejected", setRejected, rejected, 9999], ["damaged", setDamaged, damaged, 9999], ["missing", setMissing, missing, 9999], ["pending", setPending, pending, 9999]] as const).map(([label, setter, val, max]) => (
                <div key={label} className="space-y-1">
                  <Label className="text-[11px] capitalize">{label}</Label>
                  <Input type="number" min={0} className="h-8" value={val} onChange={(e) => setter(Math.min(Number(e.target.value), Number(max)))} />
                </div>
              ))}
            </div>
            {accounted !== received && <p className="text-xs text-amber-600">Accepted + rejected + damaged + missing + pending ({accounted}) should equal received ({received}).</p>}
            {wo.materials.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Material reconciliation — issued must equal consumed + returned + wasted + remaining</p>
                {wo.materials.map((m) => {
                  const atVendor = Number(m.remainingQty);
                  return (
                    <div key={m.id} className="grid grid-cols-4 gap-2 items-center text-xs">
                      <span className="col-span-1 truncate">{m.material.name}</span>
                      <span className="text-[10px] text-muted-foreground">{fmtNum(atVendor, 1)} at vendor</span>
                      <div className="col-span-3 grid grid-cols-3 gap-1.5">
                        <Input type="number" min={0} step="0.001" placeholder="consumed" className="h-7 text-xs" value={consumed[m.material.id] ?? ""} onChange={(e) => setConsumed((c) => ({ ...c, [m.material.id]: Number(e.target.value) }))} />
                        <Input type="number" min={0} step="0.001" placeholder="returned" className="h-7 text-xs" value={returned[m.material.id] ?? ""} onChange={(e) => setReturned((c) => ({ ...c, [m.material.id]: Number(e.target.value) }))} />
                        <Input type="number" min={0} step="0.001" placeholder="wasted" className="h-7 text-xs" value={wasted[m.material.id] ?? ""} onChange={(e) => setWasted((c) => ({ ...c, [m.material.id]: Number(e.target.value) }))} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Service charge (৳)</Label><Input type="number" value={serviceCharge} onChange={(e) => setServiceCharge(Number(e.target.value))} /></div>
              <div className="space-y-1"><Label>Return transport (৳)</Label><Input type="number" value={transportCost} onChange={(e) => setTransportCost(Number(e.target.value))} /></div>
              <div className="space-y-1 col-span-2"><Label>Vendor invoice no.</Label><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
              <Button onClick={submitCollect} disabled={busy || received + missing <= 0 || received !== accepted + rejected + damaged || received + missing + pending > outstanding} className="bg-emerald-600 hover:bg-emerald-700"><PackageOpen className="h-4 w-4 mr-1" />Post collection</Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
        <ErrorText error={error} />
      </DialogContent>
    </Dialog>
  );
}
