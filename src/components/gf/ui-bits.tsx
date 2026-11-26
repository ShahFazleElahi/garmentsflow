"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { statusLabel } from "@/lib/gf-api";
import { cn } from "@/lib/utils";

// ── Stat card ──
export function StatCard({ title, value, sub, tone, icon }: {
  title: string; value: string; sub?: string; tone?: "default" | "good" | "warn" | "bad" | "info"; icon?: React.ReactNode;
}) {
  const toneCls = {
    default: "text-foreground", good: "text-emerald-600", warn: "text-amber-600",
    bad: "text-red-600", info: "text-violet-600",
  }[tone ?? "default"];
  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{title}</p>
            <p className={cn("text-lg font-semibold tabular-nums mt-0.5", toneCls)}>{value}</p>
            {sub ? <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p> : null}
          </div>
          {icon ? <div className="text-muted-foreground/70 shrink-0">{icon}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Status badge ──
const STATUS_TONE: Record<string, string> = {
  "APPROVED": "bg-emerald-100 text-emerald-700 border-emerald-200", "COMPLETED": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "PASSED": "bg-emerald-100 text-emerald-700 border-emerald-200", "PAID": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "RECEIVED": "bg-emerald-100 text-emerald-700 border-emerald-200", "RECEIVED_VERIFIED": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "PASSED_MINOR": "bg-emerald-100 text-emerald-700 border-emerald-200", "ACTIVE": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "DRAFT": "bg-amber-100 text-amber-700 border-amber-200", "PENDING": "bg-amber-100 text-amber-700 border-amber-200",
  "PARTIAL": "bg-amber-100 text-amber-700 border-amber-200", "PARTIALLY_COMPLETED": "bg-amber-100 text-amber-700 border-amber-200",
  "PARTIALLY_RECEIVED": "bg-amber-100 text-amber-700 border-amber-200", "PARTIALLY_COLLECTED": "bg-amber-100 text-amber-700 border-amber-200",
  "AWAITING_APPROVAL": "bg-amber-100 text-amber-700 border-amber-200", "AWAITING_QC": "bg-amber-100 text-amber-700 border-amber-200",
  "OPEN": "bg-amber-100 text-amber-700 border-amber-200", "ORDERED": "bg-amber-100 text-amber-700 border-amber-200",
  "PACKED": "bg-amber-100 text-amber-700 border-amber-200", "CONFIRMED": "bg-amber-100 text-amber-700 border-amber-200",
  "IN_PROGRESS": "bg-amber-100 text-amber-700 border-amber-200", "MATERIAL_RESERVED": "bg-amber-100 text-amber-700 border-amber-200",
  "REWORK_REQUIRED": "bg-amber-100 text-amber-700 border-amber-200", "REWORK": "bg-amber-100 text-amber-700 border-amber-200",
  "DISPATCHED": "bg-blue-100 text-blue-700 border-blue-200", "IN_TRANSIT": "bg-blue-100 text-blue-700 border-blue-200",
  "READY": "bg-blue-100 text-blue-700 border-blue-200", "PROCUREMENT_IN_PROGRESS": "bg-blue-100 text-blue-700 border-blue-200",
  "IN_PRODUCTION": "bg-blue-100 text-blue-700 border-blue-200", "READY_FOR_PRODUCTION": "bg-blue-100 text-blue-700 border-blue-200",
  "CANCELLED": "bg-red-100 text-red-700 border-red-200", "REJECTED": "bg-red-100 text-red-700 border-red-200",
  "DELAYED": "bg-red-100 text-red-700 border-red-200", "EXCEPTION": "bg-red-100 text-red-700 border-red-200",
  "QUARANTINED": "bg-red-100 text-red-700 border-red-200", "ON_HOLD": "bg-red-100 text-red-700 border-red-200",
};
export function StatusBadge({ status }: { status: unknown }) {
  const s = String(status ?? "");
  return (
    <Badge variant="outline" className={cn("text-[11px] whitespace-nowrap", STATUS_TONE[s] ?? "bg-muted text-muted-foreground border-border")}>
      {statusLabel(s)}
    </Badge>
  );
}

// ── Data table with search, sort, pagination ──
export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  value?: (row: T) => string | number;
  className?: string;
  searchable?: boolean;
};

export function DataTable<T extends object = Record<string, unknown>>({
  columns, rows, pageSize = 12, searchable = true, emptyText = "No records", toolbar,
}: {
  columns: Column<T>[]; rows: T[]; pageSize?: number; searchable?: boolean; emptyText?: string;
  toolbar?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let out = rows;
    if (query && searchable) {
      const q = query.toLowerCase();
      out = out.filter((r) => columns.some((c) => {
        if (c.searchable === false) return false;
        const raw = c.value ? c.value(r) : (r as Record<string, unknown>)[c.key];
        return String(raw ?? "").toLowerCase().includes(q);
      }));
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) {
        out = [...out].sort((a, b) => {
          const va = col.value ? col.value(a) : (a as Record<string, unknown>)[sortKey] ?? "";
          const vb = col.value ? col.value(b) : (b as Record<string, unknown>)[sortKey] ?? "";
          if (typeof va === "number" && typeof vb === "number") return (va - vb) * sortDir;
          return String(va).localeCompare(String(vb)) * sortDir;
        });
      }
    }
    return out;
  }, [rows, query, sortKey, sortDir, columns, searchable]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return (
    <div className="space-y-2">
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <div className="relative flex-1 min-w-52 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} className="pl-8 h-9" />
            </div>
          )}
          {toolbar}
        </div>
      )}
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn("whitespace-nowrap cursor-pointer select-none", c.className)}
                  onClick={() => {
                    if (sortKey === c.key) setSortDir((d) => (d === 1 ? -1 : 1));
                    else { setSortKey(c.key); setSortDir(1); }
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {sortKey === c.key ? (sortDir === 1 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : null}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">{emptyText}</TableCell></TableRow>
            ) : (
              pageRows.map((r, i) => (
                <TableRow key={String((r as Record<string, unknown>).id ?? i)}>
                  {columns.map((c) => (
                    <TableCell key={c.key} className={cn("py-2.5", c.className)}>
                      {c.render ? c.render(r) : String(c.value ? c.value(r) : (r as Record<string, unknown>)[c.key] ?? "—")}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{filtered.length} record(s)</span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Prev</Button>
            <span className="px-2">{currentPage + 1} / {pages}</span>
            <Button variant="outline" size="sm" className="h-7" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Confirm dialog ──
export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", destructive, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; confirmLabel?: string; destructive?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Section header ──
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground mt-0.5">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ── Error banner ──
export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>;
}
