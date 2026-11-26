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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck, Wrench, Package2, ScanLine } from "lucide-react";

type Inspection = {
  id: string; code: string; inspectionDate: string; type: string; status: string; severity: string | null;
  inspectedQty: number; passedQty: number; reworkQty: number; rejectedQty: number; damagedQty: number;
  inspectorName: string | null; batch: { code: string; plan: { name: string } } | null;
  workOrderId: string | null; batchId: string | null; planId: string | null;
  workOrder: { code: string; partner: { name: string } } | null; reworkOrders: { id: string; code: string; qty: number; status: string }[];
};
type Reinspection = { inspection: Inspection; order: Inspection["reworkOrders"][number] };
type WorkOrderLite = { id: string; code: string; type: string; status: string; issuedQty: number; receivedQty: number; partner: { name: string }; batch: { code: string } };

export function QualityView({ can }: ViewProps) {
  const [rows, setRows] = useState<Inspection[]>([]);
  const [wos, setWos] = useState<WorkOrderLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reinspection, setReinspection] = useState<Reinspection | null>(null);

  const load = useCallback(() => {
    api<Inspection[]>("ops/inspections").then(setRows).catch((e) => setError(e.message));
    api<WorkOrderLite[]>("production/workorders").then((all) => setWos(all.filter((w) => ["AWAITING_QC", "REWORK_REQUIRED", "COMPLETED"].includes(w.status)))).catch(() => null);
  }, []);
  useEffect(() => { load(); }, [load]);

  const totalInspected = rows.reduce((a, r) => a + r.inspectedQty, 0);
  const totalRejected = rows.reduce((a, r) => a + r.rejectedQty + r.damagedQty, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quality Inspections & Rework"
        description="Configurable checkpoints: raw material, embroidery, tailoring, final production, pre-dispatch, destination receiving. Only passed products enter finished goods."
        actions={can("post") ? <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setOpen(true)}><ShieldCheck className="h-4 w-4 mr-1" />New Inspection</Button> : undefined}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Inspections" value={String(rows.length)} icon={<ShieldCheck className="h-4 w-4" />} />
        <StatCard title="Inspected" value={fmtNum(totalInspected)} />
        <StatCard title="Passed" value={fmtNum(rows.reduce((a, r) => a + r.passedQty, 0))} tone="good" />
        <StatCard title="Rejected / Damaged" value={fmtNum(totalRejected)} tone={totalRejected > 0 ? "bad" : "default"} />
      </div>
      <ErrorText error={error} />
      <DataTable<Inspection>
        columns={[
          { key: "code", header: "Inspection" },
          { key: "inspectionDate", header: "Date", render: (r) => fmtDate(r.inspectionDate) },
          { key: "type", header: "Type", render: (r) => <span className="text-xs">{statusLabel(r.type)}</span> },
          { key: "batch", header: "Batch", value: (r) => r.batch?.code ?? "" },
          { key: "vendor", header: "Vendor", value: (r) => r.workOrder?.partner?.name ?? "" },
          { key: "inspectedQty", header: "Insp." },
          { key: "passedQty", header: "Passed", render: (r) => <span className="text-emerald-600">{r.passedQty}</span> },
          { key: "reworkQty", header: "Rework", render: (r) => r.reworkQty > 0 ? <span className="text-amber-600">{r.reworkQty}</span> : 0 },
          { key: "rejectedQty", header: "Rej./Dmg.", render: (r) => `${r.rejectedQty}/${r.damagedQty}` },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "rework", header: "Rework orders", render: (r) => r.reworkOrders.length > 0 ? (
            <div className="flex gap-1">
              {r.reworkOrders.map((rw) => can("post") && r.status === "REWORK_REQUIRED" && ["OPEN", "IN_PROGRESS", "DONE"].includes(rw.status) ? (
                <button key={rw.id} className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200"
                  onClick={async () => {
                    if (rw.status !== "OPEN") {
                      setReinspection({ inspection: r, order: rw });
                      setOpen(true);
                      return;
                    }
                    try { await apiPost("ops/inspections/rework-status", { id: rw.id, status: "IN_PROGRESS" }); load(); }
                    catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
                  }}>{rw.status === "OPEN" ? "Start" : "Reinspect"} {rw.code}</button>
              ) : <span key={rw.id} className="text-[11px]">{rw.code}: {statusLabel(rw.status)}</span>)}
            </div>
          ) : "—" },
        ]}
        rows={rows}
      />
      {open && <NewInspectionDialog wos={wos} reinspection={reinspection} onClose={(done) => { setOpen(false); setReinspection(null); if (done) load(); }} />}
    </div>
  );
}

function NewInspectionDialog({ wos, reinspection, onClose }: { wos: WorkOrderLite[]; reinspection: Reinspection | null; onClose: (done: boolean) => void }) {
  const [workOrderId, setWorkOrderId] = useState(reinspection?.inspection.workOrderId ?? "");
  const [type, setType] = useState(reinspection?.inspection.type ?? "FINAL_PRODUCTION");
  const [inspected, setInspected] = useState(reinspection?.order.qty ?? 0);
  const [passed, setPassed] = useState(reinspection?.order.qty ?? 0);
  const [rework, setRework] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [damaged, setDamaged] = useState(0);
  const [severity, setSeverity] = useState("MINOR");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const workOrder = wos.find(w => w.id === workOrderId);

  const sum = passed + rework + rejected + damaged;

  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      await apiPost("ops/inspections/create", {
        workOrderId, type, inspectedQty: inspected, passedQty: passed, reworkQty: rework,
        reworkOrderId: reinspection?.order.id, batchId: reinspection?.inspection.batchId,
        planId: reinspection?.inspection.planId,
        rejectedQty: rejected, damagedQty: damaged, severity, notes: notes || undefined, idempotencyKey: idem(),
      });
      toast({ title: "Inspection recorded", description: `${passed} pieces passed` });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { submitting.current = false; setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting.current && onClose(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Record Quality Inspection</DialogTitle><DialogDescription>Passed quantity automatically enters finished goods at the Dhaka warehouse. Rework creates a rework order and blocks dispatch.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        {reinspection ? <p>Rework order {reinspection.order.code} · {statusLabel(type)}</p> : <div className="space-y-1"><Label>Work order *</Label>
          <Select value={workOrderId} onValueChange={(v) => {
            setWorkOrderId(v);
            const wo = wos.find((w) => w.id === v);
            if (wo) {
              setInspected(wo.receivedQty);
              setPassed(wo.receivedQty);
              setType(wo.type === "EMBROIDERY" ? "EMBROIDERY" : wo.type === "TAILORING" ? "TAILORING" : "FINAL_PRODUCTION");
            }
          }}>
            <SelectTrigger><SelectValue placeholder="Select work order" /></SelectTrigger>
            <SelectContent>{wos.map((w) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.type} · {w.partner.name} · recv {w.receivedQty}/{w.issuedQty}</SelectItem>)}</SelectContent>
          </Select>
        </div>}
        {!reinspection && workOrder?.type === "TAILORING" && (
          <div className="space-y-1"><Label>Inspection stage</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TAILORING">Tailoring</SelectItem>
                <SelectItem value="FINAL_PRODUCTION">Final production</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {([["inspected", setInspected, inspected], ["passed", setPassed, passed], ["rework", setRework, rework], ["rejected", setRejected, rejected], ["damaged", setDamaged, damaged]] as const).map(([label, setter, val]) => (
            <div key={label} className="space-y-1">
              <Label className="text-[11px] capitalize">{label}</Label>
              <Input type="number" min={0} className="h-8" value={val} readOnly={Boolean(reinspection) && label === "inspected"} onChange={(e) => setter(Number(e.target.value))} />
            </div>
          ))}
        </div>
        {sum !== inspected && <p className="text-xs text-amber-600">Passed + rework + rejected + damaged ({sum}) must equal inspected ({inspected}).</p>}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["MINOR", "MAJOR", "CRITICAL"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Defects observed…" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (!reinspection && !workOrderId) || inspected <= 0 || sum !== inspected} className="bg-emerald-600 hover:bg-emerald-700">Record inspection</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
