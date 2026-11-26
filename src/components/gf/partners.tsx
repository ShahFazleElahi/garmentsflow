"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiPost, fmtMoney, fmtDate, statusLabel } from "@/lib/gf-api";
import { PageHeader, StatCard, StatusBadge, ErrorText, DataTable, type Column } from "./ui-bits";
import type { ViewProps } from "./shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Star, Phone, Mail } from "lucide-react";

type Partner = {
  id: string; code: string; name: string; type: string; phone: string | null; email: string | null;
  area: string | null; district: string | null; country: string; paymentTerms: string | null; rating: number;
  isActive: boolean; payable: number; receivable: number; notes: string | null; bankInfo?: string | null;
};
const PARTNER_TYPES = ["SUPPLIER", "EMBROIDERY_FACTORY", "TAILOR", "TRANSPORT", "COURIER", "FREIGHT_FORWARDER", "PROCESSING", "CUSTOMER"];

export function PartnersView({ can }: ViewProps) {
  const [rows, setRows] = useState<Partner[]>([]);
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Partner | null>(null);

  const load = useCallback(() => {
    api<Partner[]>("master/partners").then(setRows).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = typeFilter === "ALL" ? rows : rows.filter((r) => r.type === typeFilter);
  const totalPayable = rows.reduce((a, r) => a + r.payable, 0);
  const totalReceivable = rows.reduce((a, r) => a + r.receivable, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Business Partners"
        description="Suppliers, embroidery factories, tailors, transport, couriers, freight forwarders and customers — created once, selectable everywhere."
        actions={can("create") ? <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />New Partner</Button> : undefined}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Partners" value={String(rows.length)} />
        <StatCard title="Active" value={String(rows.filter((r) => r.isActive).length)} tone="good" />
        <StatCard title="Total payable" value={fmtMoney(totalPayable)} tone={totalPayable > 0 ? "warn" : "default"} />
        <StatCard title="Total receivable" value={fmtMoney(totalReceivable)} tone="info" />
      </div>
      <ErrorText error={error} />
      <div className="flex flex-wrap gap-1.5">
        {["ALL", ...PARTNER_TYPES].map((t) => (
          <button key={t} onClick={() => setTypeFilter(t)}
            className={`text-[11px] px-2.5 py-1 rounded-full border ${typeFilter === t ? "bg-violet-600 text-white border-violet-600" : "bg-white hover:bg-muted"}`}>
            {t === "ALL" ? "All" : statusLabel(t)}
          </button>
        ))}
      </div>
      <DataTable
        columns={[
          { key: "code", header: "Code" },
          { key: "name", header: "Business name", render: (r) => (
            <button className="font-medium text-violet-700 hover:underline" onClick={() => setDetail(r)}>{String(r.name)}</button>
          ) },
          { key: "type", header: "Type", render: (r) => <span className="text-xs">{statusLabel(String(r.type))}</span> },
          { key: "phone", header: "Phone", render: (r) => r.phone ? <a href={`tel:${r.phone}`} className="text-xs flex items-center gap-1"><Phone className="h-3 w-3" />{r.phone}</a> : "—" },
          { key: "area", header: "Area", render: (r) => <span className="text-xs">{r.area ?? r.district ?? "—"}</span> },
          { key: "paymentTerms", header: "Terms" },
          { key: "rating", header: "Rating", render: (r) => <span className="inline-flex">{Array.from({ length: 5 }, (_, i) => <Star key={i} className={`h-3 w-3 ${i < Number(r.rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />)}</span> },
          { key: "payable", header: "Payable", render: (r) => Number(r.payable) > 0 ? <span className="text-amber-600">{fmtMoney(Number(r.payable))}</span> : "—" },
          { key: "receivable", header: "Receivable", render: (r) => Number(r.receivable) > 0 ? <span className="text-emerald-600">{fmtMoney(Number(r.receivable))}</span> : "—" },
          { key: "isActive", header: "Status", render: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "CANCELLED"} /> },
        ]}
        rows={filtered}
        pageSize={12}
      />
      {createOpen && <PartnerDialog onClose={(d) => { setCreateOpen(false); if (d) load(); }} />}
      {detail && <PartnerDetailDialog partner={detail} onClose={() => setDetail(null)} canViewFinancial={can("view_financial")} />}
    </div>
  );
}

function PartnerDialog({ onClose }: { onClose: (done: boolean) => void }) {
  const [form, setForm] = useState({
    name: "", type: "SUPPLIER", ownerName: "", contactPerson: "", phone: "", whatsapp: "", email: "",
    country: "Bangladesh", division: "", district: "", area: "", marketName: "", shopNo: "", address: "",
    paymentTerms: "Net 30", rating: 4, bankInfo: "", notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await apiPost("master/partners/create", { ...form, services: [form.type], bankInfo: form.bankInfo || undefined });
      toast({ title: "Partner created", description: form.name });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Business Partner</DialogTitle><DialogDescription>Banks details are restricted to users with financial visibility.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Business name *</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="space-y-1"><Label>Type *</Label>
            <Select value={form.type} onValueChange={(v) => set("type", v)}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PARTNER_TYPES.map((t) => <SelectItem key={t} value={t}>{statusLabel(t)}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Owner name</Label><Input value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></div>
          <div className="space-y-1"><Label>Contact person</Label><Input value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} /></div>
          <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="space-y-1"><Label>WhatsApp</Label><Input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
          <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div className="space-y-1"><Label>Country</Label><Input value={form.country} onChange={(e) => set("country", e.target.value)} /></div>
          <div className="space-y-1"><Label>Division</Label><Input value={form.division} onChange={(e) => set("division", e.target.value)} /></div>
          <div className="space-y-1"><Label>District</Label><Input value={form.district} onChange={(e) => set("district", e.target.value)} /></div>
          <div className="space-y-1"><Label>Area</Label><Input value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="Islampur" /></div>
          <div className="space-y-1"><Label>Market name</Label><Input value={form.marketName} onChange={(e) => set("marketName", e.target.value)} /></div>
          <div className="space-y-1"><Label>Shop no.</Label><Input value={form.shopNo} onChange={(e) => set("shopNo", e.target.value)} /></div>
          <div className="space-y-1"><Label>Payment terms</Label><Input value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} /></div>
          <div className="col-span-2 space-y-1"><Label>Full address</Label><Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} /></div>
          <div className="space-y-1"><Label>Bank / payment info (restricted)</Label><Input value={form.bankInfo} onChange={(e) => set("bankInfo", e.target.value)} /></div>
          <div className="space-y-1"><Label>Rating (0-5)</Label><Input type="number" min={0} max={5} value={form.rating} onChange={(e) => set("rating", Number(e.target.value))} /></div>
          <div className="col-span-2 space-y-1"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.name} className="bg-violet-600 hover:bg-violet-700">Create partner</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartnerDetailDialog({ partner, onClose, canViewFinancial }: { partner: Partner; onClose: () => void; canViewFinancial: boolean }) {
  const [perf, setPerf] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    api<Record<string, unknown>[]>("reports/vendor-performance").then((rows) => {
      setPerf(rows.find((r) => r.vendor === partner.name) ?? null);
    }).catch(() => null);
  }, [partner.name]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{partner.name}</DialogTitle>
          <DialogDescription>{partner.code} · {statusLabel(partner.type)} · {partner.area ?? partner.district ?? partner.country}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{partner.phone ?? "—"}</div>
          <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{partner.email ?? "—"}</div>
          <div><p className="text-xs text-muted-foreground">Payment terms</p>{partner.paymentTerms ?? "—"}</div>
          <div><p className="text-xs text-muted-foreground">Rating</p><span className="inline-flex">{Array.from({ length: 5 }, (_, i) => <Star key={i} className={`h-3 w-3 ${i < partner.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />)}</span></div>
          {canViewFinancial && (
            <>
              <div><p className="text-xs text-muted-foreground">Payable</p>{fmtMoney(partner.payable)}</div>
              <div><p className="text-xs text-muted-foreground">Receivable</p>{fmtMoney(partner.receivable)}</div>
            </>
          )}
        </div>
        {perf && (
          <div className="rounded-lg border divide-y text-sm">
            <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/40">Performance</p>
            {([["orders", "Orders"], ["fillRate", "Fill rate %"], ["onTimeRate", "On-time %"], ["rejected", "Rejected"], ["damaged", "Damaged"], ["missing", "Missing"], ["delayed", "Delayed"], ["serviceCost", "Service cost"]] as const).map(([k, label]) => (
              <div key={k} className="flex justify-between px-3 py-1.5">
                <span className="text-muted-foreground">{label}</span>
                <span className="tabular-nums">{k === "serviceCost" ? fmtMoney(Number((perf as Record<string, number>)[k] ?? 0)) : String((perf as Record<string, number>)[k] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
        {canViewFinancial && partner.bankInfo ? (
          <p className="text-xs text-muted-foreground">Bank: {partner.bankInfo}</p>
        ) : null}
        {partner.notes ? <p className="text-xs text-muted-foreground">{partner.notes}</p> : null}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
