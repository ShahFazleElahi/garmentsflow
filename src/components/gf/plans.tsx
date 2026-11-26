"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiPost, fmtMoney, fmtNum, fmtDate, statusLabel, idem } from "@/lib/gf-api";
import { PageHeader, StatCard, StatusBadge, ErrorText, DataTable, ConfirmDialog, type Column } from "./ui-bits";
import type { ViewProps } from "./shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Plus, Copy, Trash2, Wand2, CheckCircle2, FileSpreadsheet, Layers, ClipboardList, Wallet, FlaskConical, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Plan = {
  id: string; code: string; name: string; description: string | null; status: string; unit: string;
  plannedQty: number; estimatedBudget: number; targetMfgCost: number; targetLandedCost: number;
  targetWholesalePrice: number; targetRetailPrice: number; priority: string; season: string | null;
  version: number; createdAt: string; approvedAt: string | null;
  category: { name: string } | null; collection: { name: string } | null;
  colors: { id: string; name: string; hex: string }[];
  sizes: { id: string; name: string }[];
  variants: { id: string; sku: string; colorName: string; sizeName: string; plannedQty: number; producedQty: number; soldQty: number }[];
  batches: { id: string; code: string; plannedQty: number; status: string; variants: { completedQty: number }[] }[];
  boms: { id: string; version: number; status: string }[];
  _count: { designs: number };
};

type ColorRow = { id?: string; name: string; hex: string; fabricShade?: string; dyeLot?: string };
type SizeRow = { id?: string; name: string; chest?: string; length?: string };
type Cell = { colorId: string; sizeId: string; qty: number; enabled: boolean };

export function PlansView({ navigate, can, create }: ViewProps & { create?: boolean }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(Boolean(create));

  const load = useCallback(() => {
    api<Plan[]>("plans/plans").then(setPlans).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const totalPlanned = plans.reduce((a, p) => a + p.plannedQty, 0);
  const totalProduced = plans.reduce((a, p) => a + p.variants.reduce((x, v) => x + v.producedQty, 0), 0);
  const budget = plans.reduce((a, p) => a + Number(p.estimatedBudget), 0);

  const columns: Column<Plan>[] = [
    { key: "code", header: "Plan", value: (r) => r.code, render: (r) => (
      <button className="font-medium text-violet-700 hover:underline" onClick={() => navigate("plan-detail", r.id)}>{r.code}</button>
    ) },
    { key: "name", header: "Product", value: (r) => r.name },
    { key: "category", header: "Category", value: (r) => r.category?.name ?? "", render: (r) => r.category?.name ?? "—" },
    { key: "collection", header: "Collection", value: (r) => r.collection?.name ?? "", render: (r) => r.collection?.name ?? "—" },
    { key: "plannedQty", header: "Planned", value: (r) => r.plannedQty, render: (r) => `${fmtNum(r.plannedQty)} ${r.unit.toLowerCase()}` },
    { key: "produced", header: "Produced", value: (r) => r.variants.reduce((a, v) => a + v.producedQty, 0), render: (r) => {
      const produced = r.variants.reduce((a, v) => a + v.producedQty, 0);
      const pct = r.plannedQty > 0 ? Math.round((produced / r.plannedQty) * 100) : 0;
      return (
        <div className="min-w-24">
          <span className="text-xs tabular-nums">{fmtNum(produced)} ({pct}%)</span>
          <Progress value={pct} className="h-1.5 mt-1" />
        </div>
      );
    } },
    { key: "colors", header: "Colors × Sizes", value: (r) => r.colors.length * r.sizes.length, render: (r) => `${r.colors.length} × ${r.sizes.length}` },
    { key: "variants", header: "Variants", value: (r) => r.variants.length },
    { key: "estimatedBudget", header: "Budget", value: (r) => Number(r.estimatedBudget), render: (r) => fmtMoney(r.estimatedBudget) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "version", header: "Ver", render: (r) => <span className="text-xs text-muted-foreground">v{r.version}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Product Plans"
        description="Every collection starts here — plan products, colors, sizes and production quantities before any money is spent."
        actions={can("create") ? <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setWizardOpen(true)}><Plus className="h-4 w-4 mr-1" />New Product Plan</Button> : undefined}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Total Plans" value={fmtNum(plans.length)} icon={<ClipboardListIcon />} />
        <StatCard title="Planned Quantity" value={fmtNum(totalPlanned)} icon={<Layers />} />
        <StatCard title="Produced" value={fmtNum(totalProduced)} tone="good" />
        <StatCard title="Estimated Budgets" value={fmtMoney(budget)} icon={<Wallet />} />
      </div>
      <ErrorText error={error} />
      <DataTable columns={columns} rows={plans} pageSize={10} />
      <PlanWizard open={wizardOpen} onClose={(created) => { setWizardOpen(false); if (created) { load(); navigate("plans"); } }} />
    </div>
  );
}

function ClipboardListIcon() { return <ClipboardList className="h-4 w-4" />; }

// ═══════════ Plan Wizard (9 steps) ═══════════
function PlanWizard({ open, onClose }: { open: boolean; onClose: (created: boolean) => void }) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [collections, setCollections] = useState<{ id: string; name: string }[]>([]);
  // form state
  const [form, setForm] = useState({
    name: "", description: "", categoryId: "", collectionId: "", season: "", targetMarket: "UK & Bangladesh",
    unit: "Set", plannedQty: 200, priority: "MEDIUM", expectedStartDate: "", targetCompletionDate: "",
    targetMfgCost: 0, targetLandedCost: 0, targetWholesalePrice: 0, targetRetailPrice: 0, instructions: "",
  });
  const [colors, setColors] = useState<ColorRow[]>([
    { name: "Black", hex: "#1a1a1a" }, { name: "Maroon", hex: "#6b1f2a" },
    { name: "Olive Green", hex: "#556b2f" }, { name: "Navy Blue", hex: "#1f2a4d" },
  ]);
  const [sizes, setSizes] = useState<SizeRow[]>(["M", "L", "XL", "XXL"].map((s) => ({ name: s })));
  const [matrix, setMatrix] = useState<Map<string, number>>(new Map());
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  const [savedColors, setSavedColors] = useState<Plan["colors"]>([]);
  const [bomRows, setBomRows] = useState<{ materialId: string; colorId?: string; component: string; qtyPerPiece: number; wastagePct: number; estUnitCost: number }[]>([]);
  const [materials, setMaterials] = useState<{ id: string; name: string; sku: string }[]>([]);
  const [budget, setBudget] = useState({ fabric: 0, lace: 0, embroidery: 0, tailoring: 0, transport: 0, packaging: 0, contingency: 0 });

  useEffect(() => {
    if (!open) return;
    api<{ id: string; name: string }[]>("master/product-categories").then(setCategories).catch(() => null);
    api<{ id: string; name: string }[]>("master/collections").then(setCollections).catch(() => null);
    api<{ id: string; name: string; sku: string }[]>("master/materials").then(setMaterials).catch(() => null);
  }, [open]);

  const sizeIds = useMemo(() => sizes.map((s) => ({ id: s.id ?? s.name, name: s.name })), [sizes]);
  const colorIds = useMemo(() => colors.map((c) => ({ id: c.id ?? c.name, name: c.name, hex: c.hex })), [colors]);
  const allocated = useMemo(() => [...matrix.values()].reduce((a, b) => a + b, 0), [matrix]);
  const plannedQty = Number(form.plannedQty) || 0;

  const setCell = (cid: string, sid: string, qty: number) => {
    setMatrix((m) => { const n = new Map(m); n.set(`${cid}:${sid}`, Math.max(0, Math.round(qty))); return n; });
  };
  const equalDistribution = () => {
    const n = colorIds.length * sizeIds.length || 1;
    const per = Math.floor(plannedQty / n);
    let rem = plannedQty - per * n;
    const next = new Map<string, number>();
    for (const c of colorIds) for (const s of sizeIds) {
      let q = per;
      if (rem > 0) { q += 1; rem -= 1; }
      next.set(`${c.id}:${s.id}`, q);
    }
    setMatrix(next);
  };
  const ratioDistribution = (ratioPct: number) => {
    // color-ratio distribution: first color gets ratioPct, rest share remainder
    const weights = colorIds.map((_, i) => (i === 0 ? ratioPct : (100 - ratioPct) / Math.max(colorIds.length - 1, 1)));
    const perColor = colorIds.map((c, i) => Math.floor(plannedQty * (weights[i] / 100)));
    let rem = plannedQty - perColor.reduce((a, b) => a + b, 0);
    const next = new Map<string, number>();
    colorIds.forEach((c, i) => {
      let colorQty = perColor[i];
      if (rem > 0 && i < rem) { colorQty += 1; }
      const per = sizeIds.length ? Math.floor(colorQty / sizeIds.length) : 0;
      let remS = colorQty - per * sizeIds.length;
      sizeIds.forEach((s, j) => {
        let q = per;
        if (remS > 0 && j < remS) { q += 1; }
        next.set(`${c.id}:${s.id}`, q);
      });
    });
    setMatrix(next);
  };

  const submitPlan = async (): Promise<string | null> => {
    setBusy(true); setError(null);
    try {
      const plan = await apiPost<{ id: string }>("plans/plans/create", {
        name: form.name, description: form.description, categoryId: form.categoryId || null,
        collectionId: form.collectionId || null, season: form.season || null, targetMarket: form.targetMarket,
        unit: form.unit, plannedQty: plannedQty, priority: form.priority,
        expectedStartDate: form.expectedStartDate || undefined, targetCompletionDate: form.targetCompletionDate || undefined,
        targetMfgCost: Number(form.targetMfgCost), targetLandedCost: Number(form.targetLandedCost),
        targetWholesalePrice: Number(form.targetWholesalePrice), targetRetailPrice: Number(form.targetRetailPrice),
        instructions: form.instructions || undefined,
      });
      setCreatedPlanId(plan.id);
      if (colors.length) await apiPost("plans/plans/colors", { planId: plan.id, colors: colors.map((c) => ({ name: c.name, hex: c.hex, fabricShade: c.fabricShade, dyeLot: c.dyeLot })) });
      if (sizes.length) await apiPost("plans/plans/sizes", { planId: plan.id, sizes: sizes.map((s) => ({ name: s.name, measurements: { chest: s.chest, length: s.length } })) });
      // fetch real ids
      const { plan: fresh } = await api<{ plan: Plan }>(`plans/plans/${plan.id}`);
      setSavedColors(fresh.colors);
      const cells: Cell[] = [];
      for (const fc of fresh.colors) for (const fs of fresh.sizes) {
        const q = matrix.get(`${(colorIds.find((c) => c.name === fc.name)?.id) ?? fc.name}:${(sizeIds.find((s) => s.name === fs.name)?.id) ?? fs.name}`) ?? 0;
        cells.push({ colorId: fc.id, sizeId: fs.id, qty: q, enabled: true });
      }
      await apiPost("plans/plans/matrix", { planId: plan.id, cells });
      await apiPost("plans/plans/generate-variants", { planId: plan.id });
      toast({ title: "Plan created", description: "Colors, sizes, matrix and variants saved." });
      return plan.id;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally { setBusy(false); }
  };

  const saveBom = async () => {
    if (!createdPlanId) return;
    setBusy(true); setError(null);
    try {
      await apiPost("plans/plans/bom", { planId: createdPlanId, items: bomRows });
      toast({ title: "BOM saved" });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const saveBudget = async () => {
    if (!createdPlanId) return;
    setBusy(true); setError(null);
    try {
      const total = Object.values(budget).reduce((a, b) => a + Number(b || 0), 0);
      const { plan: fresh } = await api<{ plan: Plan }>(`plans/plans/${createdPlanId}`);
      await apiPost("plans/plans/budget", {
        planId: createdPlanId, estimatedBudget: total,
        targetMfgCost: Number(form.targetMfgCost), targetLandedCost: Number(form.targetLandedCost),
        targetWholesalePrice: Number(form.targetWholesalePrice), targetRetailPrice: Number(form.targetRetailPrice),
      });
      void fresh;
      await apiPost("plans/plans/status", { id: createdPlanId, status: "AWAITING_APPROVAL" });
      toast({ title: "Budget saved — plan submitted for approval", description: fmtMoney(total) });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const finish = async () => {
    if (!createdPlanId) {
      const pid = await submitPlan();
      if (!pid) return;
    }
    onClose(true);
  };

  const steps = ["Product Info", "Colors", "Sizes", "Production Matrix", "Design & Sample", "BOM", "Material Requirements", "Budget", "Review"];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Product Plan — {steps[step - 1]}</DialogTitle>
          <DialogDescription>Step {step} of 9 · {steps.join(" → ")}</DialogDescription>
        </DialogHeader>
        <ErrorText error={error} />

        {step === 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2 space-y-1"><Label>Product name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Embroidered Three-Piece — Eid Collection" /></div>
            <div className="sm:col-span-2 space-y-1"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Kameez + Salwar + Dupatta set with golden embroidery…" /></div>
            <div className="space-y-1"><Label>Category</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Collection</Label>
              <Select value={form.collectionId} onValueChange={(v) => setForm({ ...form, collectionId: v })}>
                <SelectTrigger><SelectValue placeholder="Select collection" /></SelectTrigger>
                <SelectContent>{collections.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Season</Label><Input value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} placeholder="Eid 2026" /></div>
            <div className="space-y-1"><Label>Unit</Label>
              <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["Piece", "Set", "Bundle"].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Planned quantity *</Label><Input type="number" min={1} value={form.plannedQty} onChange={(e) => setForm({ ...form, plannedQty: Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Expected start date</Label><Input type="date" value={form.expectedStartDate} onChange={(e) => setForm({ ...form, expectedStartDate: e.target.value })} /></div>
            <div className="space-y-1"><Label>Target completion</Label><Input type="date" value={form.targetCompletionDate} onChange={(e) => setForm({ ...form, targetCompletionDate: e.target.value })} /></div>
            <div className="space-y-1"><Label>Target mfg cost / unit (৳)</Label><Input type="number" value={form.targetMfgCost} onChange={(e) => setForm({ ...form, targetMfgCost: Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label>Target landed cost / unit (৳)</Label><Input type="number" value={form.targetLandedCost} onChange={(e) => setForm({ ...form, targetLandedCost: Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label>Target wholesale price (৳)</Label><Input type="number" value={form.targetWholesalePrice} onChange={(e) => setForm({ ...form, targetWholesalePrice: Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label>Target retail price (৳)</Label><Input type="number" value={form.targetRetailPrice} onChange={(e) => setForm({ ...form, targetRetailPrice: Number(e.target.value) })} /></div>
            <div className="sm:col-span-2 space-y-1"><Label>Production instructions</Label><Textarea rows={2} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Add unlimited colors with swatches. Each color gets its own fabric and BOM allocations.</p>
              <Button size="sm" variant="outline" onClick={() => setColors((c) => [...c, { name: "", hex: "#334155" }])}><Plus className="h-3.5 w-3.5 mr-1" />Add color</Button>
            </div>
            <div className="space-y-2">
              {colors.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="color" value={c.hex} onChange={(e) => setColors((arr) => arr.map((x, j) => j === i ? { ...x, hex: e.target.value } : x))} className="h-9 w-10 rounded border cursor-pointer" aria-label="Color swatch" />
                  <Input placeholder="Color name" value={c.name} onChange={(e) => setColors((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="flex-1" />
                  <Input placeholder="Fabric shade (optional)" value={c.fabricShade ?? ""} onChange={(e) => setColors((arr) => arr.map((x, j) => j === i ? { ...x, fabricShade: e.target.value } : x))} className="w-40" />
                  <Input placeholder="Dye lot" value={c.dyeLot ?? ""} onChange={(e) => setColors((arr) => arr.map((x, j) => j === i ? { ...x, dyeLot: e.target.value } : x))} className="w-28" />
                  <Button size="icon" variant="ghost" onClick={() => setColors((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove color"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Standard sizes with measurements (chest / length in inches).</p>
              <div className="flex gap-2">
                {["XS", "S", "M", "L", "XL", "XXL", "XXXL", "Free Size"].filter((s) => !sizes.some((x) => x.name === s)).map((s) => (
                  <Button key={s} size="sm" variant="outline" onClick={() => setSizes((arr) => [...arr, { name: s }])}>{s}</Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {sizes.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={s.name} onChange={(e) => setSizes((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="w-28" />
                  <Input placeholder="Chest (in)" value={s.chest ?? ""} onChange={(e) => setSizes((arr) => arr.map((x, j) => j === i ? { ...x, chest: e.target.value } : x))} />
                  <Input placeholder="Length (in)" value={s.length ?? ""} onChange={(e) => setSizes((arr) => arr.map((x, j) => j === i ? { ...x, length: e.target.value } : x))} />
                  <Button size="icon" variant="ghost" onClick={() => setSizes((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove size"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={equalDistribution}><Wand2 className="h-3.5 w-3.5 mr-1" />Equal distribution</Button>
              <Button size="sm" variant="outline" onClick={() => ratioDistribution(40)}>Ratio: first color 40%</Button>
              <Button size="sm" variant="ghost" onClick={() => setMatrix(new Map())}>Reset</Button>
              <div className="ml-auto text-sm">
                Allocated <span className={allocated === plannedQty ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>{fmtNum(allocated)}</span> / {fmtNum(plannedQty)} {unitNote(form.unit)}
              </div>
            </div>
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Color</TableHead>
                    {sizeIds.map((s) => <TableHead key={s.id} className="text-center">{s.name}</TableHead>)}
                    <TableHead className="text-center">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {colorIds.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: c.hex }} />
                          {c.name}
                        </span>
                      </TableCell>
                      {sizeIds.map((s) => (
                        <TableCell key={s.id} className="text-center">
                          <Input type="number" min={0} className="h-8 w-16 mx-auto text-center" value={matrix.get(`${c.id}:${s.id}`) ?? 0}
                            onChange={(e) => setCell(c.id, s.id, Number(e.target.value))} />
                        </TableCell>
                      ))}
                      <TableCell className="text-center font-medium tabular-nums">{fmtNum(sizeIds.reduce((a, s) => a + (matrix.get(`${c.id}:${s.id}`) ?? 0), 0))}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/30 font-medium">
                    <TableCell>Total</TableCell>
                    {sizeIds.map((s) => <TableCell key={s.id} className="text-center tabular-nums">{fmtNum(colorIds.reduce((a, c) => a + (matrix.get(`${c.id}:${s.id}`) ?? 0), 0))}</TableCell>)}
                    <TableCell className="text-center tabular-nums">{fmtNum(allocated)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {allocated !== plannedQty && (
              <p className="text-xs text-amber-600">The plan cannot be approved until allocated ({fmtNum(allocated)}) equals planned ({fmtNum(plannedQty)}).</p>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-violet-500" />Design and sample development can be recorded on the plan detail page after creation.</p>
            <ul className="list-disc pl-5 space-y-1 text-[13px]">
              <li>Create design records with versions and freeze the approved design per production batch.</li>
              <li>Record sample quantity, material consumed, factory/tailor charges and sample cost.</li>
              <li>Sample cost can be expensed separately or allocated to commercial production per accounting policy.</li>
            </ul>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Bill of Materials — per set, with wastage %. Size overrides can be edited on the plan page.</p>
              <Button size="sm" variant="outline" onClick={() => setBomRows((r) => [...r, { materialId: "", component: "MAIN", qtyPerPiece: 0, wastagePct: 0, estUnitCost: 0 }])}><Plus className="h-3.5 w-3.5 mr-1" />Add material</Button>
            </div>
            {bomRows.map((row, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <Select value={row.materialId} onValueChange={(v) => setBomRows((r) => r.map((x, j) => j === i ? { ...x, materialId: v } : x))}>
                  <SelectTrigger className="col-span-3"><SelectValue placeholder="Material" /></SelectTrigger>
                  <SelectContent>{materials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.sku})</SelectItem>)}</SelectContent>
                </Select>
                <Select value={row.colorId ?? "all"} onValueChange={(v) => setBomRows((r) => r.map((x, j) => j === i ? { ...x, colorId: v === "all" ? undefined : v } : x))}>
                  <SelectTrigger className="col-span-2" aria-label="BOM color"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All colors</SelectItem>
                    {savedColors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={row.component} onValueChange={(v) => setBomRows((r) => r.map((x, j) => j === i ? { ...x, component: v } : x))}>
                  <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
                  <SelectContent>{["MAIN", "KAMEEZ", "SALWAR", "DUPATTA", "PACKAGING"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" step="0.01" placeholder="Qty/set" className="col-span-2" value={row.qtyPerPiece} onChange={(e) => setBomRows((r) => r.map((x, j) => j === i ? { ...x, qtyPerPiece: Number(e.target.value) } : x))} />
                <Input type="number" placeholder="Wastage %" className="col-span-1" value={row.wastagePct} onChange={(e) => setBomRows((r) => r.map((x, j) => j === i ? { ...x, wastagePct: Number(e.target.value) } : x))} />
                <Input type="number" placeholder="Unit ৳" className="col-span-1" value={row.estUnitCost} onChange={(e) => setBomRows((r) => r.map((x, j) => j === i ? { ...x, estUnitCost: Number(e.target.value) } : x))} />
                <Button size="icon" variant="ghost" className="col-span-1" onClick={() => setBomRows((r) => r.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4 text-red-500" /></Button>
              </div>
            ))}
            {bomRows.length > 0 && (
              <div className="flex justify-end items-center text-sm">
                <Button size="sm" onClick={saveBom} disabled={busy || !createdPlanId || bomRows.some((r) => !r.materialId)}>Save BOM</Button>
              </div>
            )}
          </div>
        )}

        {step === 7 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-violet-500" />Material requirements are generated from the approved BOM × variant quantities. Generate them on the plan detail page after approval — or right now from MRP:</p>
            <Button size="sm" variant="outline" disabled={!createdPlanId || busy} onClick={async () => {
              try { const rows = await apiPost<unknown[]>("plans/plans/mrp", { planId: createdPlanId }); toast({ title: `MRP generated — ${rows.length} material line(s)` }); }
              catch (e) { setError((e as Error).message); }
            }}>Generate Material Requirements</Button>
            <p className="text-xs text-muted-foreground">Shortage = gross requirement − available stock − confirmed incoming. Purchase requisitions are raised from the MRP page.</p>
          </div>
        )}

        {step === 8 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {([["fabric", "Fabric"], ["lace", "Lace & accessories"], ["embroidery", "Embroidery"], ["tailoring", "Cutting & tailoring"], ["transport", "Transportation"], ["packaging", "Packaging"], ["contingency", "Contingency"]] as const).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label>{label} (৳)</Label>
                <Input type="number" value={budget[key]} onChange={(e) => setBudget((b) => ({ ...b, [key]: Number(e.target.value) }))} />
              </div>
            ))}
            <div className="col-span-2 sm:col-span-3 flex justify-between border-t pt-3 text-sm font-medium">
              <span>Estimated total budget</span><span>{fmtMoney(Object.values(budget).reduce((a, b) => a + Number(b || 0), 0))}</span>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <Button size="sm" disabled={busy || !createdPlanId} onClick={saveBudget}>Save Budget & Submit for Approval</Button>
            </div>
          </div>
        )}

        {step === 9 && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border divide-y">
              <ReviewRow label="Product" value={`${form.name} (${form.unit})`} />
              <ReviewRow label="Planned quantity" value={`${fmtNum(plannedQty)} ${form.unit.toLowerCase()}(s)`} />
              <ReviewRow label="Colors × Sizes" value={`${colors.length} × ${sizes.length} = ${colors.length * sizes.length} variants`} />
              <ReviewRow label="Matrix allocated" value={`${fmtNum(allocated)} ${allocated === plannedQty ? "✓ balanced" : "⚠ not balanced"}`} />
              <ReviewRow label="BOM items" value={String(bomRows.length)} />
              <ReviewRow label="Estimated budget" value={fmtMoney(Object.values(budget).reduce((a, b) => a + Number(b || 0), 0))} />
              <ReviewRow label="Target wholesale / retail" value={`${fmtMoney(form.targetWholesalePrice)} / ${fmtMoney(form.targetRetailPrice)}`} />
              <ReviewRow label="Expected margin" value={Number(form.targetRetailPrice) > 0 ? `${Math.round(((Number(form.targetRetailPrice) - Number(form.targetLandedCost)) / Number(form.targetRetailPrice)) * 100)}%` : "—"} />
            </div>
            <p className="text-xs text-muted-foreground">The plan is created as {createdPlanId ? "draft steps saved — review and approve on the plan page." : "a draft; matrix must balance before approval."}</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onClose(false)}>Close</Button>
          {step > 1 && <Button variant="outline" onClick={() => setStep((s) => s - 1)}>Back</Button>}
          {step < 9 && (
            <Button
              onClick={async () => {
                if (step === 1) {
                  if (!form.name || plannedQty <= 0) { setError("Product name and planned quantity are required"); return; }
                  const pid = await submitPlan();
                  if (!pid) return;
                }
                setStep((s) => s + 1);
              }}
              disabled={busy}
              className="bg-violet-600 hover:bg-violet-700"
            >
              {step === 1 ? "Create plan & continue" : "Next"}
            </Button>
          )}
          {step === 9 && <Button onClick={finish} className="bg-violet-600 hover:bg-violet-700">Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function unitNote(unit: string) { return unit.toLowerCase() + "(s)"; }
function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span>
    </div>
  );
}

// ═══════════ Plan Detail (lifecycle) ═══════════
type BomDetail = { id: string; version: number; status: string; items: { id: string; component: string; color: { name: string } | null; qtyPerPiece: number; wastagePct: number; estUnitCost: number; material: { name: string; sku: string }; sizeOverridesJson: string | null }[] };

type PlanDetail = {
  plan: Plan & { matrix: Cell[]; measurementCharts?: unknown[]; purchaseOrders?: Record<string, unknown>[]; boms: BomDetail[]; requirements: { id: string; material: { name: string; sku: string }; grossQty: number; stockQty: number; incomingQty: number; shortageQty: number; suggestedQty: number; estCost: number }[]; designs: { id: string; code: string; name: string; status: string; version: number; samples: { id: string; qty: number; status: string; totalCost: number }[] }[] };
  inspections: { id: string; code: string; status: string; inspectedQty: number; passedQty: number; rejectedQty: number }[];
  finishedStocks: { id: string; qty: number; warehouse: { name: string }; variant: { sku: string } }[];
  packages: { id: string; code: string; boxNo: string; items: { qty: number }[] }[];
  shipmentsLocal: unknown[];
  shipmentsIntl: unknown[];
  expenses: { id: string; code: string; category: string; amount: number; date: string }[];
  payments: { id: string; invoiceNo: string; amount: number; paidAmount: number; status: string }[];
  salesItems: { id: string; qty: number; lineTotal: number; invoice: { code: string; customer: { name: string } } }[];
  costEntries: { id: string; category: string; amount: number; date: string }[];
  activities: { id: string; date: string; description: string; module: string; userName: string | null }[];
};

export function PlanDetailView({ planId, navigate, can }: ViewProps & { planId: string | null }) {
  const [data, setData] = useState<PlanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!planId) return;
    api<PlanDetail>(`plans/plans/${planId}`).then(setData).catch((e) => setError(e.message));
  }, [planId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorText error={error} />;
  if (!data) return <p className="text-sm text-muted-foreground py-20 text-center">Loading plan…</p>;

  const plan = data.plan;
  const produced = plan.variants.reduce((a, v) => a + v.producedQty, 0);
  const sold = plan.variants.reduce((a, v) => a + v.soldQty, 0);
  const actualCost = data.costEntries.reduce((a, e) => a + Number(e.amount), 0);
  const revenue = data.salesItems.reduce((a, s) => a + Number(s.lineTotal), 0);
  const approvedBom = plan.boms[0] as BomDetail | undefined;

  const act = async (path: string, body: Record<string, unknown>, okMsg: string) => {
    setBusy(true); setError(null);
    try { await apiPost(path, body); toast({ title: okMsg }); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="link" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => navigate("plans")}>← All plans</Button>
          <h1 className="text-xl font-semibold flex items-center gap-2">{plan.code} — {plan.name} <StatusBadge status={plan.status} /></h1>
          <p className="text-sm text-muted-foreground">{plan.category?.name} · {plan.collection?.name} · {plan.season} · v{plan.version} · {fmtNum(plan.plannedQty)} {plan.unit.toLowerCase()}(s) planned</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("approve") && plan.status !== "APPROVED" && !["COMPLETED", "CANCELLED"].includes(plan.status) && (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => act("plans/plans/approve", { id: plan.id }, "Plan approved")}>
              <CheckCircle2 className="h-4 w-4 mr-1" />Approve plan
            </Button>
          )}
          {can("approve") && ["APPROVED", "IN_PRODUCTION", "PARTIALLY_COMPLETED"].includes(plan.status) && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => {
              const reason = window.prompt("Revision reason:");
              if (reason) act("plans/plans/revise", { id: plan.id, reason }, "Plan revision created");
            }}><History className="h-4 w-4 mr-1" />Revise</Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act("plans/plans/duplicate", { id: plan.id }, "Plan duplicated")}>
            <Copy className="h-4 w-4 mr-1" />Duplicate
          </Button>
          {can("create") && (
            <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
              const qtyStr = window.prompt(`Batch quantity (max ${plan.plannedQty - plan.batches.reduce((a, b) => a + b.plannedQty, 0)}):`);
              if (!qtyStr) return;
              await act("production/batches/create", { planId: plan.id, plannedQty: Number(qtyStr) }, "Production batch created");
            }}><Plus className="h-4 w-4 mr-1" />Create batch</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard title="Planned" value={fmtNum(plan.plannedQty)} />
        <StatCard title="Produced" value={fmtNum(produced)} tone="good" sub={plan.plannedQty > 0 ? `${Math.round((produced / plan.plannedQty) * 100)}%` : ""} />
        <StatCard title="Sold" value={fmtNum(sold)} tone="info" />
        <StatCard title="Estimated budget" value={fmtMoney(plan.estimatedBudget)} />
        <StatCard title="Actual cost (from ledger)" value={fmtMoney(actualCost)} tone={actualCost > Number(plan.estimatedBudget) && Number(plan.estimatedBudget) > 0 ? "bad" : "default"} />
        <StatCard title="Revenue / Gross profit" value={fmtMoney(revenue)} tone={revenue - actualCost >= 0 ? "good" : "bad"} sub={revenue > 0 ? `GP ${fmtMoney(revenue - data.salesItems.reduce((a, s) => a + Number(s.lineTotal) * 0, 0))}` : ""} />
      </div>

      <Tabs defaultValue="matrix" className="space-y-3">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/60">
          {["matrix", "colors", "sizes", "variants", "bom", "mrp", "designs", "purchases", "production", "quality", "finished", "packaging", "finance", "costing", "sales", "timeline"].map((tKey) => (
            <TabsTrigger key={tKey} value={tKey} className="text-xs capitalize">{tKey === "mrp" ? "MRP" : tKey}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="matrix"><MatrixEditor plan={plan} canEdit={can("edit")} onChanged={load} /></TabsContent>

        <TabsContent value="colors">
          <div className="flex flex-wrap gap-3">
            {plan.colors.map((c) => (
              <Card key={c.id} className="w-40 py-3">
                <CardContent className="px-3 space-y-1">
                  <span className="block h-10 rounded-md border" style={{ backgroundColor: c.hex }} />
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.hex}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="sizes">
          <DataTable
            columns={[
              { key: "name", header: "Size" },
            ]}
            rows={plan.sizes}
            searchable={false}
          />
        </TabsContent>

        <TabsContent value="variants">
          <DataTable
            columns={[
              { key: "sku", header: "SKU" },
              { key: "colorName", header: "Color" },
              { key: "sizeName", header: "Size" },
              { key: "plannedQty", header: "Planned", render: (r) => fmtNum(Number(r.plannedQty)) },
              { key: "producedQty", header: "Produced", render: (r) => fmtNum(Number(r.producedQty)) },
              { key: "soldQty", header: "Sold", render: (r) => fmtNum(Number(r.soldQty)) },
            ]}
            rows={plan.variants}
            pageSize={16}
          />
        </TabsContent>

        <TabsContent value="bom">
          {approvedBom ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">BOM v{approvedBom.version} · {approvedBom.status}</Badge>
                {approvedBom.status !== "APPROVED" && can("approve") && (
                  <Button size="sm" disabled={busy} onClick={() => act("plans/plans/bom-approve", { id: approvedBom.id }, "BOM approved")}>Approve BOM</Button>
                )}
              </div>
              <DataTable
                columns={[
                  { key: "material", header: "Material", value: (r) => String((r as { material: { name: string } }).material?.name ?? ""), render: (r) => String((r as unknown as { material: { name: string } }).material.name) },
                  { key: "component", header: "Component" },
                  { key: "color", header: "Color", render: (r) => r.color?.name ?? "All colors" },
                  { key: "qtyPerPiece", header: "Qty/set", render: (r) => fmtNum(Number((r as unknown as { qtyPerPiece: number }).qtyPerPiece), 2) },
                  { key: "wastagePct", header: "Wastage %", render: (r) => `${fmtNum(Number((r as unknown as { wastagePct: number }).wastagePct), 1)}%` },
                  { key: "estUnitCost", header: "Unit cost", render: (r) => fmtMoney(Number((r as unknown as { estUnitCost: number }).estUnitCost)) },
                  { key: "sizeOverridesJson", header: "Size overrides", render: (r) => {
                    const j = (r as unknown as { sizeOverridesJson: string | null }).sizeOverridesJson;
                    return j ? <span className="text-xs">{j}</span> : "—";
                  } },
                ]}
                rows={approvedBom.items}
                searchable={false}
              />
            </div>
          ) : <p className="text-sm text-muted-foreground py-6 text-center">No BOM yet — create one from the wizard or edit on this page.</p>}
        </TabsContent>

        <TabsContent value="mrp">
          <div className="flex items-center gap-2 mb-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("plans/plans/mrp", { planId: plan.id }, "Material requirements regenerated")}>Regenerate MRP</Button>
            <span className="text-xs text-muted-foreground">Shortage = gross requirement − available − incoming</span>
          </div>
          <DataTable
            columns={[
              { key: "material", header: "Material", render: (r) => String((r as unknown as { material: { name: string } }).material.name) },
              { key: "grossQty", header: "Gross req.", render: (r) => fmtNum(Number((r as unknown as { grossQty: number }).grossQty), 1) },
              { key: "stockQty", header: "In stock", render: (r) => fmtNum(Number((r as unknown as { stockQty: number }).stockQty), 1) },
              { key: "incomingQty", header: "Incoming", render: (r) => fmtNum(Number((r as unknown as { incomingQty: number }).incomingQty), 1) },
              { key: "shortageQty", header: "Shortage", render: (r) => <span className={Number((r as unknown as { shortageQty: number }).shortageQty) > 0 ? "text-red-600 font-medium" : ""}>{fmtNum(Number((r as unknown as { shortageQty: number }).shortageQty), 1)}</span> },
              { key: "suggestedQty", header: "Suggested purchase", render: (r) => fmtNum(Number((r as unknown as { suggestedQty: number }).suggestedQty), 1) },
              { key: "estCost", header: "Est. cost", render: (r) => fmtMoney(Number((r as unknown as { estCost: number }).estCost)) },
            ]}
            rows={plan.requirements}
            searchable={false}
          />
        </TabsContent>

        <TabsContent value="designs">
          <div className="space-y-2">
            {plan.designs.map((d) => (
              <Card key={d.id} className="py-3">
                <CardContent className="px-4 flex flex-wrap items-center gap-3">
                  <span className="font-medium text-sm">{d.code} — {d.name}</span>
                  <StatusBadge status={d.status} />
                  <span className="text-xs text-muted-foreground">v{d.version} · {d.samples.length} sample(s)</span>
                  {d.status !== "FROZEN" && can("approve") && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => act("plans/plans/designs", { id: d.id, sub: "freeze" }, "Design frozen for production")}>Freeze design</Button>
                  )}
                </CardContent>
              </Card>
            ))}
            {plan.designs.length === 0 && <p className="text-sm text-muted-foreground">No designs recorded.</p>}
          </div>
        </TabsContent>

        <TabsContent value="purchases">
          <DataTable
            columns={[
              { key: "code", header: "PO" },
              { key: "supplier", header: "Supplier", render: (r) => String((r as unknown as { supplier: { name: string } }).supplier?.name ?? "") },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
              { key: "total", header: "Total", render: (r) => fmtMoney(Number(r.total)) },
            ]}
            rows={((plan as unknown as { purchaseOrders?: Record<string, unknown>[] }).purchaseOrders) ?? []}
            searchable={false}
          />
        </TabsContent>

        <TabsContent value="production">
          <div className="space-y-2">
            {plan.batches.map((b) => {
              const done = b.variants.reduce((a, v) => a + v.completedQty, 0);
              return (
                <Card key={b.id} className="py-3">
                  <CardContent className="px-4 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{b.code}</span>
                      <StatusBadge status={b.status} />
                      <span className="text-xs text-muted-foreground">{fmtNum(b.plannedQty)} planned · {fmtNum(done)} completed</span>
                    </div>
                    <Progress value={b.plannedQty > 0 ? (done / b.plannedQty) * 100 : 0} className="h-2" />
                  </CardContent>
                </Card>
              );
            })}
            {plan.batches.length === 0 && <p className="text-sm text-muted-foreground">No production batches yet.</p>}
          </div>
        </TabsContent>

        <TabsContent value="quality">
          <DataTable
            columns={[
              { key: "code", header: "Inspection" },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
              { key: "inspectedQty", header: "Inspected" },
              { key: "passedQty", header: "Passed" },
              { key: "rejectedQty", header: "Rejected" },
            ]}
            rows={data.inspections}
            searchable={false}
          />
        </TabsContent>

        <TabsContent value="finished">
          <DataTable
            columns={[
              { key: "warehouse", header: "Warehouse", render: (r) => String((r as unknown as { warehouse: { name: string } }).warehouse.name) },
              { key: "sku", header: "Variant", render: (r) => String((r as unknown as { variant: { sku: string } }).variant.sku) },
              { key: "qty", header: "Qty" },
            ]}
            rows={data.finishedStocks}
            searchable={false}
          />
        </TabsContent>

        <TabsContent value="packaging">
          <div className="space-y-1.5">
            {data.packages.map((p) => (
              <p key={p.id} className="text-[13px]">{p.code} (Box {p.boxNo}) — {p.items.reduce((a, i) => a + i.qty, 0)} pc</p>
            ))}
            {data.packages.length === 0 && <p className="text-sm text-muted-foreground">No packages yet.</p>}
          </div>
        </TabsContent>

        <TabsContent value="finance">
          <DataTable
            columns={[
              { key: "code", header: "Document" },
              { key: "category", header: "Category" },
              { key: "amount", header: "Amount", render: (r) => fmtMoney(Number(r.amount)) },
              { key: "date", header: "Date", render: (r) => fmtDate(String(r.date)) },
            ]}
            rows={data.expenses}
            searchable={false}
          />
          <p className="text-xs text-muted-foreground mt-2">Vendor invoices: {data.payments.map((p) => `${p.invoiceNo} (${p.status})`).join(", ") || "none"}</p>
        </TabsContent>

        <TabsContent value="costing">
          <CostSummary costEntries={data.costEntries} estimatedBudget={Number(plan.estimatedBudget)} />
        </TabsContent>

        <TabsContent value="sales">
          <DataTable
            columns={[
              { key: "invoice", header: "Invoice", render: (r) => String((r as unknown as { invoice: { code: string } }).invoice.code) },
              { key: "customer", header: "Customer", render: (r) => String((r as unknown as { invoice: { customer: { name: string } } }).invoice.customer.name) },
              { key: "qty", header: "Qty" },
              { key: "lineTotal", header: "Revenue", render: (r) => fmtMoney(Number(r.lineTotal)) },
            ]}
            rows={data.salesItems}
            searchable={false}
          />
        </TabsContent>

        <TabsContent value="timeline">
          <div className="space-y-2.5">
            {data.activities.map((a) => (
              <div key={a.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                <div>
                  <p className="text-[13px]">{a.description}</p>
                  <p className="text-[11px] text-muted-foreground">{fmtDate(a.date)} · {a.module} {a.userName ? `· ${a.userName}` : ""}</p>
                </div>
              </div>
            ))}
            {data.activities.length === 0 && <p className="text-sm text-muted-foreground">No activity recorded yet.</p>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CostSummary({ costEntries, estimatedBudget }: { costEntries: { category: string; amount: number }[]; estimatedBudget: number }) {
  const byCat = new Map<string, number>();
  for (const e of costEntries) byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount));
  const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  return (
    <div className="space-y-2 max-w-lg">
      <div className="flex justify-between text-sm font-medium"><span>Total actual cost</span><span>{fmtMoney(total)}</span></div>
      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Estimated budget</span><span>{fmtMoney(estimatedBudget)}</span></div>
      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Variance</span><span className={total > estimatedBudget && estimatedBudget > 0 ? "text-red-600" : "text-emerald-600"}>{fmtMoney(estimatedBudget - total)}</span></div>
      <div className="rounded-lg border divide-y mt-2">
        {rows.map(([cat, amt]) => (
          <div key={cat} className="flex justify-between px-3 py-1.5 text-[13px]">
            <span>{cat.replaceAll("_", " ")}</span><span className="tabular-nums">{fmtMoney(amt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatrixEditor({ plan, canEdit, onChanged }: { plan: Plan & { matrix: Cell[]; colors: { id: string; name: string; hex: string }[]; sizes: { id: string; name: string }[] }; canEdit: boolean; onChanged: () => void }) {
  const [cells, setCells] = useState<Map<string, number>>(new Map(plan.matrix.map((m) => [`${m.colorId}:${m.sizeId}`, m.qty])));
  const [busy, setBusy] = useState(false);
  const allocated = [...cells.values()].reduce((a, b) => a + b, 0);

  const equalDistribution = () => {
    const combos = plan.colors.length * plan.sizes.length || 1;
    const per = Math.floor(plan.plannedQty / combos);
    let rem = plan.plannedQty - per * combos;
    const next = new Map<string, number>();
    for (const c of plan.colors) for (const s of plan.sizes) {
      let q = per; if (rem > 0) { q += 1; rem -= 1; }
      next.set(`${c.id}:${s.id}`, q);
    }
    setCells(next);
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={equalDistribution}><Wand2 className="h-3.5 w-3.5 mr-1" />Equal distribution</Button>
          <Button size="sm" className="bg-violet-600 hover:bg-violet-700" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const arr = plan.colors.flatMap((c) => plan.sizes.map((s) => ({ colorId: c.id, sizeId: s.id, qty: cells.get(`${c.id}:${s.id}`) ?? 0, enabled: true })));
              await apiPost("plans/plans/matrix", { planId: plan.id, cells: arr });
              toast({ title: "Matrix saved", description: `Allocated ${fmtNum(allocated)} of ${fmtNum(plan.plannedQty)}` });
              onChanged();
            } catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
            finally { setBusy(false); }
          }}>Save matrix</Button>
          <Button size="sm" variant="outline" disabled={busy || allocated !== plan.plannedQty}
            onClick={async () => {
              setBusy(true);
              try { await apiPost("plans/plans/generate-variants", { planId: plan.id }); toast({ title: "Variants regenerated" }); onChanged(); }
              catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
              finally { setBusy(false); }
            }}>Regenerate variants</Button>
        </div>
      )}
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="bg-muted/50">
            <TableHead>Color</TableHead>
            {plan.sizes.map((s) => <TableHead key={s.id} className="text-center">{s.name}</TableHead>)}
            <TableHead className="text-center">Total</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {plan.colors.map((c) => (
              <TableRow key={c.id}>
                <TableCell><span className="inline-flex items-center gap-2"><span className="h-4 w-4 rounded-full border" style={{ backgroundColor: c.hex }} />{c.name}</span></TableCell>
                {plan.sizes.map((s) => (
                  <TableCell key={s.id} className="text-center">
                    {canEdit ? (
                      <Input type="number" min={0} className="h-8 w-16 mx-auto text-center" value={cells.get(`${c.id}:${s.id}`) ?? 0}
                        onChange={(e) => setCells((m) => { const n = new Map(m); n.set(`${c.id}:${s.id}`, Math.max(0, Math.round(Number(e.target.value)))); return n; })} />
                    ) : <span className="tabular-nums">{cells.get(`${c.id}:${s.id}`) ?? 0}</span>}
                  </TableCell>
                ))}
                <TableCell className="text-center font-medium tabular-nums">{plan.sizes.reduce((a, s) => a + (cells.get(`${c.id}:${s.id}`) ?? 0), 0)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/30 font-medium">
              <TableCell>Total</TableCell>
              {plan.sizes.map((s) => <TableCell key={s.id} className="text-center tabular-nums">{plan.colors.reduce((a, c) => a + (cells.get(`${c.id}:${s.id}`) ?? 0), 0)}</TableCell>)}
              <TableCell className="text-center tabular-nums">{allocated}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      {allocated !== plan.plannedQty && <p className="text-xs text-amber-600">Allocated {fmtNum(allocated)} ≠ planned {fmtNum(plan.plannedQty)} — approval is blocked until balanced.</p>}
    </div>
  );
}
