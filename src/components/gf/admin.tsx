"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiPost, fmtDate, fmtDateTime, statusLabel, type Lang } from "@/lib/gf-api";
import { PageHeader, StatCard, StatusBadge, ErrorText, DataTable, type Column } from "./ui-bits";
import type { ViewProps } from "./shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Plus, KeyRound, ShieldCheck, FileText, Globe } from "lucide-react";
import { PERMISSIONS } from "@/lib/constants";

type UserRow = { id: string; email: string; name: string; roleKey: string; isActive: boolean; lastLoginAt: string | null; twoFactorEnabled: boolean; phone: string | null };
type RoleDef = { key: string; name: string; permissions?: string[]; isSystem?: boolean; id?: string };
type AuditRow = { id: string; createdAt: string; userName: string | null; action: string; entity: string; refNo: string | null; reason: string | null };
type DocRow = { id: string; code: string; category: string; fileName: string; size: number; createdAt: string; uploadedById: string | null };


export function AdminView({ mode, can }: ViewProps & { mode: "admin-users" | "admin-settings" | "admin-audit" | "admin-docs" }) {
  return (
    <div className="space-y-4">
      {mode === "admin-users" && <UsersView can={can} />}
      {mode === "admin-settings" && <SettingsView can={can} />}
      {mode === "admin-audit" && <AuditView />}
      {mode === "admin-docs" && <DocsView />}
    </div>
  );
}

function UsersView({ can }: Pick<ViewProps, "can">) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const load = useCallback(() => {
    api<UserRow[]>("admin/users").then(setRows).catch((e) => setError(e.message));
    api<{ system: RoleDef[]; custom: RoleDef[] }>("admin/roles").then((r) => setRoles([...r.system, ...r.custom])).catch(() => null);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!can("manage_users")) return <ErrorText error="You need 'Manage users' permission to view this page." />;

  return (
    <div className="space-y-4">
      <PageHeader title="Users & Roles"
        description="Manage user roles, workflow permissions and warehouse location assignments."
        actions={<Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />Add User</Button>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Users" value={String(rows.length)} />
        <StatCard title="Active" value={String(rows.filter((r) => r.isActive).length)} tone="good" />
        <StatCard title="2FA enabled" value={String(rows.filter((r) => r.twoFactorEnabled).length)} tone="info" icon={<ShieldCheck className="h-4 w-4" />} />
        <StatCard title="Roles" value={String(roles.length)} />
      </div>
      <ErrorText error={error} />
      <DataTable
        columns={[
          { key: "name", header: "Name" },
          { key: "email", header: "Email" },
          { key: "roleKey", header: "Role", render: (r) => <span className="text-xs">{roles.find((x) => x.key === r.roleKey)?.name ?? String(r.roleKey)}</span> },
          { key: "twoFactorEnabled", header: "2FA", render: (r) => r.twoFactorEnabled ? <span className="text-emerald-600 text-xs">On</span> : <span className="text-muted-foreground text-xs">Off</span> },
          { key: "lastLoginAt", header: "Last login", render: (r) => r.lastLoginAt ? fmtDateTime(r.lastLoginAt) : "—" },
          { key: "isActive", header: "Status", render: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "CANCELLED"} /> },
          { key: "actions", header: "", searchable: false, render: (r) => (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
                const password = window.prompt(`New password for ${String(r.email)} (min 12 chars):`);
                if (!password) return;
                try { await apiPost("admin/users/update", { id: r.id, password }); toast({ title: "Password reset" }); }
                catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
              }}><KeyRound className="h-3 w-3 mr-1" />Reset pw</Button>
              <Button size="sm" variant="ghost" className={`h-7 text-xs ${r.isActive ? "text-red-600" : "text-emerald-600"}`}
                onClick={async () => {
                  try { await apiPost("admin/users/update", { id: r.id, isActive: !r.isActive }); toast({ title: r.isActive ? "User deactivated" : "User activated" }); load(); }
                  catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
                }}>{r.isActive ? "Deactivate" : "Activate"}</Button>
            </div>
          ) },
        ]}
        rows={rows}
      />
      <RolesCard roles={roles} onChanged={load} canManage={can("manage_users")} />
      {createOpen && <NewUserDialog roles={roles} onClose={(d) => { setCreateOpen(false); if (d) load(); }} />}
    </div>
  );
}

function RolesCard({ roles, onChanged, canManage }: { roles: RoleDef[]; onChanged: () => void; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Roles & Permissions</h3>
        {canManage && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" />Custom role</Button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {roles.map((r) => (
          <div key={r.key} className="rounded-lg border px-3 py-2 bg-white">
            <p className="text-xs font-medium">{r.name}</p>
            <p className="text-[10px] text-muted-foreground">{r.permissions?.length ?? 0} permissions · {r.isSystem ? "system" : "custom"}</p>
          </div>
        ))}
      </div>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>New Custom Role</DialogTitle></DialogHeader>
            <NewRoleForm onSubmit={async (data) => {
              try { await apiPost("admin/roles/create", data); toast({ title: "Role created" }); setOpen(false); onChanged(); }
              catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
            }} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function NewRoleForm({ onSubmit }: { onSubmit: (data: { key: string; name: string; permissions: string[] }) => void }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<string[]>(["view"]);
  return (
    <div className="space-y-3">
      <div className="space-y-1"><Label>Role key</Label><Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replaceAll(" ", "_"))} placeholder="e.g. PACKAGING_LEAD" /></div>
      <div className="space-y-1"><Label>Display name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1.5">
        <Label>Permissions</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {PERMISSIONS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={perms.includes(p)} onChange={(e) => setPerms((s) => e.target.checked ? [...s, p] : s.filter((x) => x !== p))} />
              {statusLabel(p)}
            </label>
          ))}
        </div>
      </div>
      <DialogFooter><Button onClick={() => onSubmit({ key, name, permissions: perms })} disabled={!key || !name}>Create role</Button></DialogFooter>
    </div>
  );
}

function NewUserDialog({ roles, onClose }: { roles: RoleDef[]; onClose: (d: boolean) => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", roleKey: "DATA_ENTRY", phone: "" });
  const [busy, setBusy] = useState(false);
  const [locations, setLocations] = useState<{ id: string; name: string; isActive: boolean; type: string }[]>([]);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  useEffect(() => {
    api<typeof locations>("master/locations").then(rows => setLocations(rows.filter(row => row.isActive && row.type === "BUSINESS"))).catch(() => null);
  }, []);
  const submit = async () => {
    setBusy(true);
    try {
      await apiPost("admin/users/create", { ...form, locationIds });
      toast({ title: "User created", description: form.email });
      onClose(true);
    } catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add User</DialogTitle><DialogDescription>Password is hashed (bcrypt); the user can enable 2FA from their profile.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Full name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1"><Label>Email *</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="space-y-1"><Label>Password (min 12 chars) *</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div className="space-y-1"><Label>Role</Label>
            <Select value={form.roleKey} onValueChange={(v) => setForm({ ...form, roleKey: v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{roles.map((r) => <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Locations</legend>
            {locations.map(location => (
              <label key={location.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={locationIds.includes(location.id)} onChange={event =>
                  setLocationIds(ids => event.target.checked ? [...ids, location.id] : ids.filter(id => id !== location.id))} />
                {location.name}
              </label>
            ))}
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.name || !form.email || form.password.length < 12} className="bg-violet-600 hover:bg-violet-700">Create user</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsView({ can, lang }: { can: (p: string) => boolean; lang?: Lang }) {
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [rates, setRates] = useState<{ rows: { base: string; quote: string; rate: number; date: string }[]; latest: Record<string, number> }>({ rows: [], latest: {} });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Record<string, Record<string, unknown>>>("master/settings").then(setSettings).catch((e) => setError(e.message));
    api<typeof rates>("master/exchange-rates").then(setRates).catch(() => null);
  }, []);
  useEffect(() => { load(); }, [load]);

  const business = (settings.business ?? {}) as Record<string, string>;
  const locale = (settings.locale ?? {}) as Record<string, string>;
  const costing = (settings.costing ?? {}) as Record<string, string>;

  const save = async (key: string, value: Record<string, unknown>) => {
    try { await apiPost("admin/settings/update", { [key]: value }); toast({ title: "Settings saved" }); load(); }
    catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="System Settings" description="Business identity, locale, costing policy and exchange rates. Integration credentials are stored encrypted and never exposed to the client." />
      <ErrorText error={error} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-white p-4 space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-1.5"><Globe className="h-4 w-4 text-violet-500" />Business & locale</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Business name</Label><Input defaultValue={business.name ?? ""} onBlur={(e) => save("business", { ...business, name: e.target.value })} /></div>
            <div className="space-y-1"><Label>Language</Label>
              <Select value={locale.language ?? "en"} onValueChange={(v) => save("locale", { ...locale, language: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="bn">বাংলা (Bangla)</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Timezone</Label>
              <Select value={locale.timezone ?? "Asia/Dhaka"} onValueChange={(v) => save("locale", { ...locale, timezone: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["Asia/Dhaka", "Europe/London", "UTC"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Base currency</Label>
              <Select value={locale.baseCurrency ?? "BDT"} onValueChange={(v) => save("locale", { ...locale, baseCurrency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["BDT", "GBP", "USD"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Interface language toggle is available from the header; forms remain English in this release.</p>
        </div>

        <div className="rounded-lg border bg-white p-4 space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-violet-500" />Accounting & inventory policy</h3>
          <div className="space-y-1"><Label>Inventory costing method</Label>
            <Select value={costing.method ?? "WEIGHTED_AVERAGE"} onValueChange={(v) => save("costing", { ...costing, method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="WEIGHTED_AVERAGE">Weighted average</SelectItem><SelectItem value="FIFO">FIFO (reporting approximation)</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Wastage policy</Label>
            <Select value={costing.wastagePolicy ?? "NORMAL_IN_COST_ABNORMAL_EXPENSED"} onValueChange={(v) => save("costing", { ...costing, wastagePolicy: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NORMAL_IN_COST_ABNORMAL_EXPENSED">Normal wastage in cost; abnormal expensed</SelectItem>
                <SelectItem value="ALL_IN_COST">All wastage capitalized (not recommended)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-[11px] text-muted-foreground">Normal production wastage is included in product cost; abnormal losses post to the abnormal-loss account and are never capitalized into good inventory.</div>
        </div>

        <div className="rounded-lg border bg-white p-4 space-y-3 lg:col-span-2">
          <h3 className="text-sm font-medium">Exchange rates (BDT base)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {["GBP", "USD"].map((cur) => (
              <div key={cur} className="space-y-1">
                <Label>1 {cur} = ? BDT</Label>
                <Input type="number" step="0.01" defaultValue={rates.latest[`${cur}_BDT`] ?? ""} onBlur={(e) => {
                  const rate = Number(e.target.value);
                  if (rate > 0) apiPost("master/exchange-rates", { base: cur, quote: "BDT", rate, date: new Date().toISOString().slice(0, 10) }).then(() => toast({ title: `Rate saved: 1 ${cur} = ৳${rate}` })).catch(() => null);
                }} />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {rates.rows.slice(0, 6).map((r, i) => <span key={i} className="px-2 py-0.5 rounded bg-muted">{r.base}/{r.quote} {Number(r.rate)} · {fmtDate(r.date)}</span>)}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Optional integrations (S3 storage, courier APIs, email, AI) are configured via environment variables in production — never exposed here.</p>
      <div hidden>{lang}</div>
    </div>
  );
}

function AuditView() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<AuditRow[]>("admin/audit").then(setRows).catch((e) => setError(e.message)); }, []);
  return (
    <div className="space-y-4">
      <PageHeader title="Audit Logs" description="Who did what, when — approvals, postings, reversals and configuration changes with previous/updated values and reasons." />
      <ErrorText error={error} />
      <DataTable
        columns={[
          { key: "createdAt", header: "Time", render: (r) => fmtDateTime(r.createdAt) },
          { key: "userName", header: "User", render: (r) => r.userName ?? "system" },
          { key: "action", header: "Action", render: (r) => <StatusBadge status={r.action} /> },
          { key: "entity", header: "Entity" },
          { key: "refNo", header: "Reference", render: (r) => <span className="text-xs">{r.refNo ?? "—"}</span> },
          { key: "reason", header: "Reason", render: (r) => <span className="text-xs text-muted-foreground line-clamp-1">{r.reason ?? ""}</span> },
        ]}
        rows={rows}
        pageSize={15}
      />
    </div>
  );
}

function DocsView() {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("Purchase Receipts");
  const load = useCallback(() => { api<DocRow[]>("admin/documents").then(setRows).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      // Authenticated upload persisted in PostgreSQL.
      const body = new FormData();
      body.append("file", file);
      body.append("category", category);
      const res = await fetch("/api/data/admin/documents/upload", { method: "POST", body });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      toast({ title: "Document stored" });
      setOpen(false); setFile(null);
      load();
    } catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Documents" description="Central document registry: invoices, receipts, design files, shipment and customs documents. Validated file types, secure access."
        actions={<Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Upload</Button>} />
      <ErrorText error={error} />
      <DataTable
        columns={[
          { key: "code", header: "ID" },
          { key: "fileName", header: "File", render: (r) => <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-muted-foreground" /><a className="underline" href={`/api/data/admin/documents/download/${r.id}`}>{String(r.fileName)}</a></span> },
          { key: "category", header: "Category" },
          { key: "size", header: "Size", render: (r) => `${(Number(r.size) / 1024).toFixed(1)} KB` },
          { key: "createdAt", header: "Uploaded", render: (r) => fmtDateTime(r.createdAt) },
        ]}
        rows={rows}
        emptyText="No documents uploaded yet."
      />
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Upload Document</DialogTitle><DialogDescription>Allowed: pdf, jpg, png, webp — max 4 MB.</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>Category</Label>
                <Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["Product Images", "Design Sketches", "Measurement Charts", "Supplier Invoices", "Purchase Receipts", "Factory Receipts", "Tailoring Receipts", "Payment Receipts", "Transportation Receipts", "Quality Photos", "Packing Lists", "Shipment Documents", "Customs Documents", "Business Agreements", "Other"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1"><Label>File</Label><Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={upload} disabled={busy || !file}>Upload</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
