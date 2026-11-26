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
import { Truck, Globe2, ClipboardList, Route } from "lucide-react";

type Shipment = {
  id: string; code: string; type: string; status: string; dispatchDate: string | null; expectedArrival: string | null;
  actualArrival: string | null; trackingId: string | null; awbNo: string | null; totalCost: number; currency: string;
  totalCostBdt: number; paidAmount: number; freightForwarderId: string | null; customsStatus: string | null; incoterms: string | null;
  originWarehouse: { name: string } | null; destWarehouse: { name: string } | null;
  packages: { id: string; package: { id: string; code: string; boxNo: string; items: { qty: number; variant?: { id: string; sku: string } }[] } }[];
  discrepancies: { id: string; status: string; variant: { sku: string }; damagedQty: number; missingQty: number; receivedQty: number; expectedQty: number }[];
  receipts: { id: string; code: string; receiptDate: string; boxesReceived: number }[];
};
type Pkg = { id: string; code: string; boxNo: string; status: string; sourceWarehouse: { name: string }; items: { qty: number; variant?: { id: string; sku: string } }[] };
type Location = { id: string; name: string; code: string; type: string };
type Warehouse = { id: string; name: string; locationId: string; type: string };
type Partner = { id: string; name: string; type: string };

export function LogisticsView({ mode, can }: ViewProps & { mode: "shipments" | "transport" }) {
  const [rows, setRows] = useState<Shipment[]>([]);
  const [transports, setTransports] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveFor, setReceiveFor] = useState<Shipment | null>(null);
  const [settleFor, setSettleFor] = useState<Shipment | null>(null);

  const load = useCallback(() => {
    if (mode === "shipments") api<Shipment[]>("ops/shipments").then(setRows).catch((e) => setError(e.message));
    else api<Record<string, unknown>[]>("ops/transport").then(setTransports).catch((e) => setError(e.message));
  }, [mode]);
  useEffect(() => { load(); }, [load]);

  if (mode === "transport") {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Transportation Ledger"
          description="Central transport expense ledger with allocation to batches and variants (by quantity/value)."
          actions={can("create") ? <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setCreateOpen(true)}><Truck className="h-4 w-4 mr-1" />Record Transport</Button> : undefined}
        />
        <ErrorText error={error} />
        <DataTable
          columns={[
            { key: "code", header: "ID" },
            { key: "date", header: "Date", render: (r) => fmtDate(String(r.date)) },
            { key: "origin", header: "Origin" },
            { key: "destination", header: "Destination" },
            { key: "purpose", header: "Purpose" },
            { key: "amount", header: "Amount", render: (r) => fmtMoney(Number(r.amount)) },
            { key: "paymentStatus", header: "Payment", render: (r) => <StatusBadge status={String(r.paymentStatus)} /> },
          ]}
          rows={transports}
        />
        {createOpen && <TransportDialog onClose={(d) => { setCreateOpen(false); if (d) load(); }} />}
      </div>
    );
  }

  const inTransit = rows.filter((r) => ["DISPATCHED", "IN_TRANSIT"].includes(r.status));
  const openDisc = rows.reduce((a, r) => a + r.discrepancies.filter((d) => d.status === "OPEN").length, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shipments"
        description="Local (Dhaka → Sylhet) and international (Sylhet → UK) dispatch. Stock moves to in-transit on dispatch and to destination only after verified receiving."
        actions={can("create") ? <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setCreateOpen(true)}><ClipboardList className="h-4 w-4 mr-1" />New Shipment</Button> : undefined}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Shipments" value={String(rows.length)} icon={<Truck className="h-4 w-4" />} />
        <StatCard title="In transit" value={String(inTransit.length)} tone="info" />
        <StatCard title="Delivered & verified" value={String(rows.filter((r) => r.status === "RECEIVED_VERIFIED").length)} tone="good" />
        <StatCard title="Open discrepancies" value={String(openDisc)} tone={openDisc > 0 ? "bad" : "default"} />
      </div>
      <ErrorText error={error} />
      <DataTable
        columns={[
          { key: "code", header: "Shipment", render: (r) => <span className="font-medium">{String(r.code)}</span> },
          { key: "type", header: "Type", render: (r) => (
            <span className="inline-flex items-center gap-1 text-xs">
              {String(r.type) === "INTERNATIONAL" ? <Globe2 className="h-3 w-3" /> : <Route className="h-3 w-3" />}
              {statusLabel(String(r.type))}
            </span>
          ) },
          { key: "route", header: "Route", value: (r) => `${(r.originWarehouse as { name: string } | null)?.name ?? ""}→${(r.destWarehouse as { name: string } | null)?.name ?? ""}`,
            render: (r) => <span className="text-xs">{String((r.originWarehouse as { name: string } | null)?.name ?? "—")} → {String((r.destWarehouse as { name: string } | null)?.name ?? "—")}</span> },
          { key: "boxes", header: "Boxes", value: (r) => ((r.packages as unknown[])?.length ?? 0) },
          { key: "dispatchDate", header: "Dispatched", render: (r) => fmtDate(r.dispatchDate) },
          { key: "expectedArrival", header: "Expected", render: (r) => fmtDate(r.expectedArrival) },
          { key: "totalCostBdt", header: "Cost", render: (r) => fmtMoney(Number(r.totalCostBdt)) },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
          { key: "actions", header: "", searchable: false, render: (r) => {
            const s = r as unknown as Shipment;
            return (
              <div className="flex flex-wrap gap-1.5">
                {can("post") && s.status === "DRAFT" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
                    try { await apiPost("ops/shipments/dispatch", { id: s.id }); toast({ title: "Shipment dispatched — stock now in transit" }); load(); }
                    catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
                  }}>Dispatch</Button>
                )}
                {can("post") && ["DISPATCHED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(s.status) && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReceiveFor(s)}>Receive</Button>
                )}
                {can("post") && can("view_financial") && s.type === "INTERNATIONAL" &&
                  s.status === "RECEIVED_VERIFIED" && s.freightForwarderId && s.totalCost > s.paidAmount && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSettleFor(s)}>Pay freight</Button>
                )}
                {s.discrepancies.some(d => d.status === "OPEN") && (
                  <span className="self-center text-xs text-amber-700">Discrepancy open</span>
                )}
              </div>
            );
          } },
        ]}
        rows={rows}
      />
      {createOpen && <CreateShipmentDialog onClose={(d) => { setCreateOpen(false); if (d) load(); }} />}
      {receiveFor && <ReceiveShipmentDialog shipment={receiveFor} onClose={(d) => { setReceiveFor(null); if (d) load(); }} />}
      {settleFor && <SettleShipmentDialog shipment={settleFor} onClose={(d) => { setSettleFor(null); if (d) load(); }} />}
    </div>
  );
}

function SettleShipmentDialog({ shipment, onClose }: { shipment: Shipment; onClose: (done: boolean) => void }) {
  const outstanding = Number((shipment.totalCost - shipment.paidAmount).toFixed(2));
  const [amount, setAmount] = useState(outstanding);
  const [accounts, setAccounts] = useState<{ id: string; name: string; currency: string; type: string; isActive: boolean }[]>([]);
  const [accountId, setAccountId] = useState("");
  const [idempotencyKey] = useState(idem);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<typeof accounts>("master/accounts")
      .then(rows => setAccounts(rows.filter(row => row.isActive && row.currency === "BDT" && ["CASH", "BANK", "MOBILE_BANKING"].includes(row.type))))
      .catch((err: Error) => setError(err.message));
  }, []);
  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await apiPost("finance/logistics-payments/pay", { shipmentId: shipment.id, accountId, amount, idempotencyKey });
      toast({ title: "Freight payment posted" });
      onClose(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={open => !open && !submitting.current && onClose(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pay freight for {shipment.code}</DialogTitle>
          <DialogDescription>Outstanding {fmtMoney(outstanding, shipment.currency)}</DialogDescription>
        </DialogHeader>
        <ErrorText error={error} />
        <div className="space-y-1">
          <Label>Amount ({shipment.currency})</Label>
          <Input type="number" min="0.01" max={outstanding} step="0.01" value={amount} onChange={e => setAmount(Number(e.target.value))} />
        </div>
        <div className="space-y-1">
          <Label>Payment account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="Select an account" /></SelectTrigger>
            <SelectContent>{accounts.map(row => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onClose(false)}>Cancel</Button>
          <Button disabled={busy || !accountId || amount <= 0 || amount > outstanding} onClick={submit}>Post payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateShipmentDialog({ onClose }: { onClose: (done: boolean) => void }) {
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [type, setType] = useState("LOCAL");
  const [selected, setSelected] = useState<string[]>([]);
  const [originLocationOverride, setOriginLocationId] = useState("");
  const [originWarehouseOverride, setOriginWarehouseId] = useState("");
  const [destLocationOverride, setDestLocationId] = useState("");
  const [destWarehouseOverride, setDestWarehouseId] = useState("");
  const [expectedArrival, setExpectedArrival] = useState("");
  const [transportOverride, setTransportMethod] = useState<string | null>(null);
  const [transportCompanyId, setTransportCompanyId] = useState("");
  const [freightForwarderId, setFreightForwarderId] = useState("");
  const [trackingId, setTrackingId] = useState("");
  const [awbNo, setAwbNo] = useState("");
  const [incoterms, setIncoterms] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [charges, setCharges] = useState({ freight: 0, insurance: 0, customs: 0, duties: 0, taxes: 0, docs: 0, handling: 0, lastMile: 0, other: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(idem);
  const submitting = useRef(false);

  useEffect(() => {
    api<Pkg[]>("ops/packages").then((all) => setPkgs(all.filter((p) => p.status === "PACKED"))).catch(() => null);
    api<Location[]>("master/locations")
      .then(setLocations)
      .catch(() => null);
    api<Warehouse[]>("master/warehouses").then(setWarehouses).catch(() => null);
    api<Partner[]>("master/partners").then((ps) => setPartners(ps.filter((p) => ["TRANSPORT", "COURIER", "FREIGHT_FORWARDER"].includes(p.type)))).catch(() => null);
  }, []);

  const defaultOrigin = locations.find(
    (l) => l.name === (type === "INTERNATIONAL" ? "Sylhet" : "Dhaka")
  )?.id ?? "";

  const defaultDestination = locations.find(
    (l) => l.name === (type === "INTERNATIONAL" ? "United Kingdom" : "Sylhet")
  )?.id ?? "";

  const originLocationId = originLocationOverride || defaultOrigin;
  const destLocationId = destLocationOverride || defaultDestination;

  const originWhs = warehouses.filter(
    (w) => w.locationId === originLocationId
  );

  const destWhs = warehouses.filter(
    (w) => w.locationId === destLocationId
  );

  const originWarehouseId =
    originWhs.find((w) => w.id === originWarehouseOverride)?.id ??
    originWhs.find((w) => w.type === "MAIN")?.id ??
    originWhs[0]?.id ?? "";

  const destWarehouseId =
    destWhs.find((w) => w.id === destWarehouseOverride)?.id ??
    destWhs.find((w) => w.type === "MAIN")?.id ??
    destWhs[0]?.id ?? "";

  const transportMethod =
    transportOverride ?? (type === "INTERNATIONAL" ? "Air Cargo" : "Truck");

  const total = Object.values(charges).reduce(
    (a, b) => a + Number(b || 0), 0
  );

  const selectedUnits = pkgs
    .filter((p) => selected.includes(p.id))
    .reduce((a, p) => a + p.items.reduce((x, i) => x + i.qty, 0), 0);

  const changeShipmentType = (value: string) => {
    setType(value);
    setOriginLocationId("");
    setDestLocationId("");
    setOriginWarehouseId("");
    setDestWarehouseId("");
    setTransportMethod(null);
  };

  const submit = async (dispatchNow: boolean) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      const shipment = await apiPost<{ id: string }>("ops/shipments/create", {
        type, packageIds: selected, originLocationId, originWarehouseId, destLocationId, destWarehouseId,
        expectedArrival: expectedArrival || undefined, transportMethod,
        transportCompanyId: transportCompanyId || null, freightForwarderId: freightForwarderId || null,
        trackingId: trackingId || undefined, awbNo: awbNo || undefined, incoterms: incoterms || undefined,
        hsCode: hsCode || undefined,
        freightCharge: charges.freight, insuranceCharge: charges.insurance, customsCharge: charges.customs,
        importDuties: charges.duties, taxesCharge: charges.taxes, docCharge: charges.docs,
        handlingCharge: charges.handling, lastMileCharge: charges.lastMile, otherCharge: charges.other,
        currency: "BDT", exchangeRate: 1, idempotencyKey,
      });
      if (dispatchNow) {
        await apiPost("ops/shipments/dispatch", { id: shipment.id });
        toast({ title: "Shipment created & dispatched", description: `${selected.length} box(es), ${selectedUnits} pc in transit` });
      } else {
        toast({ title: "Shipment created as draft" });
      }
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { submitting.current = false; setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting.current && onClose(false)}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Shipment</DialogTitle><DialogDescription>Select packed boxes. Dispatch moves stock into in-transit; destination stock updates only after verified receiving.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1"><Label>Type</Label>
            <Select value={type} onValueChange={changeShipmentType}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="LOCAL">Local</SelectItem><SelectItem value="INTERNATIONAL">International</SelectItem></SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Origin location</Label>
            <Select value={originLocationId} onValueChange={(value) => {
      setOriginLocationId(value);
      setOriginWarehouseId("");
    }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{locations.filter((l) => l.type === "BUSINESS").map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Origin warehouse</Label>
            <Select value={originWarehouseId} onValueChange={setOriginWarehouseId}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{originWhs.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Expected arrival</Label><Input type="date" value={expectedArrival} onChange={(e) => setExpectedArrival(e.target.value)} /></div>
          <div className="space-y-1"><Label>Destination location</Label>
            <Select value={destLocationId} onValueChange={(value) => {
      setDestLocationId(value);
      setDestWarehouseId("");
    }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{locations.filter((l) => l.type === "BUSINESS").map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Destination warehouse</Label>
            <Select value={destWarehouseId} onValueChange={setDestWarehouseId}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{destWhs.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>{type === "INTERNATIONAL" ? "Freight forwarder" : "Transport company"}</Label>
            <Select value={type === "INTERNATIONAL" ? freightForwarderId : transportCompanyId} onValueChange={type === "INTERNATIONAL" ? setFreightForwarderId : setTransportCompanyId}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{partners.filter((p) => type === "INTERNATIONAL" ? p.type === "FREIGHT_FORWARDER" : ["TRANSPORT", "COURIER"].includes(p.type)).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Transport method</Label><Input value={transportMethod} onChange={(e) => setTransportMethod(e.target.value)} /></div>
          {type === "INTERNATIONAL" && (
            <>
              <div className="space-y-1"><Label>Air waybill / tracking</Label><Input value={awbNo} onChange={(e) => setAwbNo(e.target.value)} placeholder="AWB no." /></div>
              <div className="space-y-1"><Label>Incoterms</Label><Input value={incoterms} onChange={(e) => setIncoterms(e.target.value)} placeholder="CIF London" /></div>
              <div className="space-y-1"><Label>HS code</Label><Input value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="6211" /></div>
            </>
          )}
        </div>
        <div>
          <Label className="mb-1.5 block">Packed boxes (select)</Label>
          <div className="rounded-lg border divide-y max-h-36 overflow-y-auto">
            {pkgs.map((p) => (
              <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50">
                <input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id))} />
                <span>{p.code} · Box {p.boxNo}</span>
                <span className="ml-auto text-xs text-muted-foreground">{p.sourceWarehouse?.name} · {p.items.reduce((a, i) => a + i.qty, 0)} pc</span>
              </label>
            ))}
            {pkgs.length === 0 && <p className="text-xs text-muted-foreground p-3">No packed boxes available — create packages first.</p>}
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {([["freight", "Freight"], ["insurance", "Insurance"], ["customs", "Customs"], ["duties", "Duties"], ["taxes", "Taxes"], ["docs", "Documents"], ["handling", "Handling"], ["lastMile", "Last-mile"], ["other", "Other"]] as const).map(([key, label]) => (
            <div key={key} className="space-y-0.5">
              <Label className="text-[11px]">{label} (৳)</Label>
              <Input type="number" className="h-8" value={charges[key]} onChange={(e) => setCharges((c) => ({ ...c, [key]: Number(e.target.value) }))} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-sm font-medium border-t pt-2">
          <span>{selected.length} box(es) · {selectedUnits} pc · total cost</span><span>{fmtMoney(total)}</span>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="outline" disabled={busy || selected.length === 0} onClick={() => submit(false)}>Save draft</Button>
          <Button disabled={busy || selected.length === 0} onClick={() => submit(true)} className="bg-violet-600 hover:bg-violet-700">Create & dispatch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveShipmentDialog({ shipment, onClose }: { shipment: Shipment; onClose: (done: boolean) => void }) {
  const expected = new Map<string, { sku: string; qty: number }>();
  for (const sp of shipment.packages) for (const it of sp.package.items) {
    const cur = expected.get(it.variant?.sku ?? "?");
    void cur;
  }
  // build expectation from package items
  const items: { variantId: string; sku: string; expected: number; received: number; damaged: number; missing: number }[] = [];
  for (const sp of shipment.packages) {
    for (const it of sp.package.items as unknown as { variantId?: string; variant?: { id: string; sku: string }; qty: number }[]) {
      const vid = it.variant?.id ?? it.variantId ?? "";
      const sku = it.variant?.sku ?? vid;
      const found = items.find((x) => x.variantId === vid);
      if (found) found.expected += it.qty;
      else items.push({ variantId: vid, sku, expected: it.qty, received: it.qty, damaged: 0, missing: 0 });
    }
  }
  const [lines, setLines] = useState(items);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(idem);
  const submitting = useRef(false);

  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      await apiPost("ops/shipments/receive", {
        id: shipment.id, items: lines.map((l) => ({ variantId: l.variantId, received: l.received, damaged: l.damaged, missing: l.missing })),
        notes: notes || undefined, idempotencyKey,
      });
      toast({ title: "Shipment received", description: "All quantities verified." });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { submitting.current = false; setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting.current && onClose(false)}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Receive Shipment — {shipment.code}</DialogTitle><DialogDescription>Box-by-box verification. Damaged units go to quarantine; missing units create traceable discrepancy records. {shipment.type === "INTERNATIONAL" ? "International landed cost is allocated to received variants." : ""}</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="rounded-lg border divide-y">
          {lines.map((l, i) => (
            <div key={l.variantId} className="px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{l.sku}</span>
                <span className="ml-auto text-xs text-muted-foreground">expected {l.expected}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([["received", "received"], ["damaged", "damaged"], ["missing", "missing"]] as const).map(([key, label]) => (
                  <div key={key} className="space-y-0.5">
                    <Label className="text-[10px]">{label}</Label>
                    <Input type="number" min={0} max={l.expected} className="h-8"
                      value={l[key]} onChange={(e) => setLines((arr) => arr.map((x, j) => j === i ? { ...x, [key]: Math.min(Number(e.target.value), l.expected) } : x))} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-1"><Label>Notes</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Package condition, photos reference…" /></div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">Verify & receive</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransportDialog({ onClose }: { onClose: (done: boolean) => void }) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState(0);
  const [partnerId, setPartnerId] = useState("");
  const [partners, setPartners] = useState<Partner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<Partner[]>("master/partners?type=TRANSPORT").then(setPartners).catch(() => null); }, []);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await apiPost("ops/transport/create", { origin, destination, purpose, amount, partnerId: partnerId || null, paymentStatus: "PAID" });
      toast({ title: "Transportation recorded" });
      onClose(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Record Transportation</DialogTitle><DialogDescription>Posted to freight expense with journal entry.</DialogDescription></DialogHeader>
        <ErrorText error={error} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Origin</Label><Input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Islampur" /></div>
          <div className="space-y-1"><Label>Destination</Label><Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Dhaka warehouse" /></div>
          <div className="col-span-2 space-y-1"><Label>Purpose</Label><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Fabric pickup" /></div>
          <div className="space-y-1"><Label>Provider</Label>
            <Select value={partnerId} onValueChange={setPartnerId}><SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>{partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Amount (৳)</Label><Input type="number" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !amount || !origin || !destination}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
