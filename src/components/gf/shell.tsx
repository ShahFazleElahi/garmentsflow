"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GarmentFlowLogo } from "./logo";
import { Root, type SessionUser } from "./root";
import { type Lang } from "@/lib/gf-api";
import { DashboardView } from "./dashboard";
import { PlansView, PlanDetailView } from "./plans";
import { ProcurementView } from "./procurement";
import { InventoryView } from "./inventory";
import { ProductionView } from "./production";
import { QualityView } from "./quality";
import { FinishedView } from "./finished";
import { PackagingView } from "./packaging";
import { LogisticsView } from "./logistics";
import { PartnersView } from "./partners";
import { FinanceView } from "./finance";
import { SalesView } from "./sales";
import { ReportsView } from "./reports";
import { AdminView } from "./admin";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ClipboardList, ShoppingCart, Boxes, Factory, ShieldCheck, Package,
  PackageCheck, Truck, Handshake, Wallet, Calculator, Store, BarChart3, Settings,
  Bell, Search, Menu, X, Home, Zap, LogOut, Languages, ChevronDown,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export type ViewId = string;

export const NAV_TREE: { key: string; label: string; icon: React.ElementType; children: { id: string; label: string }[] }[] = [
  {
    key: "dashboard", label: "Dashboard", icon: LayoutDashboard, children: [
      { id: "dashboard", label: "Executive Dashboard" },
      { id: "daily-ops", label: "Daily Operations" },
    ],
  },
  {
    key: "planning", label: "Product Planning", icon: ClipboardList, children: [
      { id: "plans", label: "All Product Plans" },
      { id: "plans-new", label: "Create Product Plan" },
    ],
  },
  {
    key: "procurement", label: "Procurement", icon: ShoppingCart, children: [
      { id: "purchase-orders", label: "Purchase Orders" },
      { id: "requirements", label: "Purchase Requirements" },
      { id: "receiving", label: "Material Receiving" },
    ],
  },
  {
    key: "inventory", label: "Raw Material Inventory", icon: Boxes, children: [
      { id: "inventory-stocks", label: "Inventory Overview" },
      { id: "inventory-ledger", label: "Stock Ledger" },
      { id: "inventory-custody", label: "Materials Held by Vendors" },
      { id: "inventory-counts", label: "Stock Count & Adjustments" },
    ],
  },
  {
    key: "production", label: "Production", icon: Factory, children: [
      { id: "batches", label: "Production Batches" },
      { id: "workorders", label: "Work Orders" },
    ],
  },
  {
    key: "quality", label: "Quality Control", icon: ShieldCheck, children: [
      { id: "quality", label: "Inspections & Rework" },
    ],
  },
  {
    key: "finished", label: "Finished Goods", icon: Package, children: [
      { id: "finished", label: "Finished Stock" },
      { id: "finished-movements", label: "Finished Movements" },
    ],
  },
  {
    key: "packaging", label: "Packaging", icon: PackageCheck, children: [
      { id: "packaging", label: "Boxes & Packing" },
    ],
  },
  {
    key: "logistics", label: "Logistics", icon: Truck, children: [
      { id: "shipments", label: "Shipments" },
      { id: "transport", label: "Transportation Ledger" },
    ],
  },
  {
    key: "partners", label: "Business Partners", icon: Handshake, children: [
      { id: "partners", label: "Partner Directory" },
    ],
  },
  {
    key: "finance", label: "Finance", icon: Wallet, children: [
      { id: "finance-accounts", label: "Cash & Bank" },
      { id: "finance-expenses", label: "Expenses" },
      { id: "finance-invoices", label: "Vendor Invoices" },
      { id: "finance-payments", label: "Payments" },
      { id: "finance-journal", label: "Journal & Ledger" },
      { id: "finance-statements", label: "Financial Statements" },
    ],
  },
  {
    key: "costing", label: "Costing", icon: Calculator, children: [
      { id: "costing", label: "Product Costing & Profitability" },
    ],
  },
  {
    key: "sales", label: "Sales", icon: Store, children: [
      { id: "sales", label: "Sales Invoices" },
    ],
  },
  {
    key: "reports", label: "Reports", icon: BarChart3, children: [
      { id: "reports", label: "Reports & Analytics" },
    ],
  },
  {
    key: "admin", label: "Administration", icon: Settings, children: [
      { id: "admin-users", label: "Users & Roles" },
      { id: "admin-settings", label: "System Settings" },
      { id: "admin-audit", label: "Audit Logs" },
      { id: "admin-docs", label: "Documents" },
    ],
  },
];

const MOBILE_TABS: { id: string; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Home", icon: Home },
  { id: "daily-ops", label: "Operations", icon: Zap },
  { id: "quick-add", label: "Quick Add", icon: Menu },
  { id: "inventory-stocks", label: "Inventory", icon: Boxes },
  { id: "more", label: "More", icon: Settings },
];

type NotificationRow = { id: string; severity: string; title: string; message: string | null; isRead: boolean; createdAt: string };

export function AppShell({ user, onLogout, lang, setLang }: {
  user: SessionUser; onLogout: () => void; lang: Lang; setLang: (l: Lang) => void;
}) {
  const [view, setView] = useState<ViewId>("dashboard");
  const [viewParam, setViewParam] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop collapse
  const [openGroups, setOpenGroups] = useState<string[]>(["dashboard", "planning"]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotificationRow[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const navigate = useCallback((id: string, param?: string | null) => {
    setView(id);
    setViewParam(param ?? null);
    setSidebarOpen(false);
    setQuickAddOpen(false);
    topRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
  }, []);

  const refreshNotifs = useCallback(() => {
    fetch("/api/data/admin/notifications")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setNotifs(j.data); })
      .catch(() => null);
  }, []);
  useEffect(() => { refreshNotifs(); }, [refreshNotifs]);
  useEffect(() => {
    const iv = setInterval(refreshNotifs, 60_000);
    return () => clearInterval(iv);
  }, [refreshNotifs]);

  // global search: command palette across modules
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
        if (e.key === "/" && (e.target as HTMLElement)?.tagName === "INPUT") return;
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const activeGroup = NAV_TREE.find((g) => g.children.some((c) => c.id === view || (viewParam && c.id === view)));
  const unread = notifs.filter((n) => !n.isRead).length;

  const can = useCallback((perm: string) => user.permissions.includes("*") || user.permissions.includes(perm), [user]);

  const renderView = () => {
    const p = { user, navigate, viewParam, lang, can, refreshNotifs } as const;
    switch (view) {
      case "dashboard": return <DashboardView {...p} mode="exec" />;
      case "daily-ops": return <DashboardView {...p} mode="daily" />;
      case "plans": case "plans-new": return <PlansView {...p} create={view === "plans-new"} />;
      case "plan-detail": return <PlanDetailView {...p} planId={viewParam} />;
      case "purchase-orders": case "requirements": case "receiving":
        return <ProcurementView {...p} mode={view as "purchase-orders" | "requirements" | "receiving"} />;
      case "inventory-stocks": case "inventory-ledger": case "inventory-custody": case "inventory-counts":
        return <InventoryView {...p} mode={view as "inventory-stocks" | "inventory-ledger" | "inventory-custody" | "inventory-counts"} />;
      case "batches": case "workorders":
        return <ProductionView {...p} mode={view as "batches" | "workorders"} />;
      case "quality": return <QualityView {...p} />;
      case "finished": case "finished-movements":
        return <FinishedView {...p} mode={view as "finished" | "finished-movements"} />;
      case "packaging": return <PackagingView {...p} />;
      case "shipments": case "transport":
        return <LogisticsView {...p} mode={view as "shipments" | "transport"} />;
      case "partners": return <PartnersView {...p} />;
      case "finance-accounts": case "finance-expenses": case "finance-invoices": case "finance-payments":
      case "finance-journal": case "finance-statements": case "costing":
        return <FinanceView {...p} mode={view} />;
      case "sales": return <SalesView {...p} />;
      case "reports": return <ReportsView {...p} />;
      case "admin-users": case "admin-settings": case "admin-audit": case "admin-docs":
        return <AdminView {...p} mode={view as "admin-users" | "admin-settings" | "admin-audit" | "admin-docs"} />;
      default:
        return <DashboardView {...p} mode="exec" />;
    }
  };

  const allNavItems = NAV_TREE.flatMap((g) => g.children.map((c) => ({ ...c, group: g.label })));

  const sidebar = (
    <aside className={cn(
      "flex flex-col bg-[#231f33] text-white/80 h-full transition-all duration-200",
      collapsed ? "w-[64px]" : "w-[248px]",
    )}>
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/10 shrink-0">
        <GarmentFlowLogo className="h-8 w-8 shrink-0" />
        {!collapsed && <span className="font-semibold text-white tracking-tight">GarmentFlow</span>}
        <button className="ml-auto lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X className="h-4 w-4" /></button>
      </div>
      <nav className="flex-1 overflow-y-auto py-2 gf-sidebar-scroll" aria-label="Main navigation">
        {NAV_TREE.map((group) => {
          const Icon = group.icon;
          const isOpen = openGroups.includes(group.key);
          const hasActive = group.children.some((c) => c.id === view);
          return (
            <div key={group.key}>
              <button
                className={cn(
                  "w-full flex items-center gap-2.5 px-4 py-2 text-[13px] hover:bg-white/5 transition-colors",
                  hasActive && "text-white",
                )}
                onClick={() => collapsed ? navigate(group.children[0].id) : setOpenGroups((g) => g.includes(group.key) ? g.filter((k) => k !== group.key) : [...g, group.key])}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="flex-1 text-left truncate">{group.label}</span>}
                {!collapsed && <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />}
              </button>
              {!collapsed && isOpen && (
                <div className="pb-1">
                  {group.children.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate(c.id)}
                      className={cn(
                        "w-full flex items-center gap-2 pl-11 pr-4 py-1.5 text-[12.5px] text-left hover:bg-white/5 transition-colors",
                        view === c.id ? "text-white bg-violet-600/30 border-r-2 border-violet-400" : "",
                      )}
                    >
                      <span className="truncate">{c.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="p-3 border-t border-white/10 text-[10px] text-white/40 shrink-0">
        {!collapsed && <>Developed by <a href="https://assetifyhub.com" target="_blank" rel="noreferrer" className="underline">Assetify Hub Technologies</a></>}
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen flex bg-[#f7f6f3]" ref={topRef}>
      {/* Desktop sidebar */}
      <div className="hidden lg:block sticky top-0 h-screen shrink-0">{sidebar}</div>
      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64 shadow-xl">{sidebar}</div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-40 h-14 bg-white/90 backdrop-blur border-b flex items-center gap-2 px-3 sm:px-5">
          <button className="lg:hidden p-2 -ml-1" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <button
            className="hidden lg:inline-flex p-2 rounded hover:bg-muted"
            onClick={() => setCollapsed((c) => !c)}
            aria-label="Toggle sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
            <span className="truncate">{activeGroup?.label ?? "Dashboard"}</span>
            <span>/</span>
            <span className="text-foreground font-medium truncate">
              {NAV_TREE.flatMap((g) => g.children).find((c) => c.id === view)?.label ?? "Executive Dashboard"}
            </span>
          </div>
          <button
            onClick={() => setSearchOpen(true)}
            className="ml-auto flex items-center gap-2 h-8 px-3 rounded-md border bg-muted/40 text-xs text-muted-foreground hover:bg-muted"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Search…</span>
            <kbd className="hidden md:inline text-[10px] border rounded px-1">⌘K</kbd>
          </button>
          <Button size="sm" className="hidden sm:inline-flex h-8 bg-violet-600 hover:bg-violet-700" onClick={() => setQuickAddOpen(true)}>
            <Zap className="h-3.5 w-3.5 mr-1" /> Quick Add
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="relative p-2 rounded hover:bg-muted" aria-label="Notifications">
                <Bell className="h-4.5 w-4.5 h-[18px] w-[18px]" />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center px-0.5">{unread}</span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
              <DropdownMenuLabel className="flex items-center justify-between">
                Notifications
                <button
                  className="text-[11px] underline text-muted-foreground"
                  onClick={async () => {
                    await fetch("/api/data/admin/notifications/read-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
                    refreshNotifs();
                  }}
                >Mark all read</button>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifs.length === 0 ? <div className="px-3 py-6 text-center text-xs text-muted-foreground">No notifications</div> :
                notifs.slice(0, 12).map((n) => (
                  <DropdownMenuItem key={n.id} className="flex-col items-start gap-0.5 py-2" onClick={() => { navigate("dashboard"); setNotifOpen(false); }}>
                    <div className="flex items-center gap-2 w-full">
                      <Badge variant="outline" className={
                        n.severity === "DANGER" ? "border-red-200 text-red-600 bg-red-50 text-[10px]" :
                        n.severity === "WARNING" ? "border-amber-200 text-amber-600 bg-amber-50 text-[10px]" :
                        "border-border text-muted-foreground text-[10px]"
                      }>{n.severity}</Badge>
                      <span className="text-xs font-medium truncate">{n.title}</span>
                    </div>
                    {n.message ? <p className="text-[11px] text-muted-foreground line-clamp-2">{n.message}</p> : null}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button className="p-2 rounded hover:bg-muted" onClick={() => setLang(lang === "en" ? "bn" : "en")} aria-label="Language">
            <Languages className="h-[18px] w-[18px]" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-muted" aria-label="Account">
                <span className="h-7 w-7 rounded-full bg-violet-600 text-white text-xs font-semibold flex items-center justify-center">
                  {user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <span className="hidden md:block text-xs font-medium max-w-28 truncate">{user.name}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <p className="text-xs font-medium">{user.name}</p>
                <p className="text-[11px] text-muted-foreground font-normal">{user.roleName}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout}><LogOut className="h-3.5 w-3.5 mr-2" />Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Main */}
        <main className="flex-1 min-w-0 px-3 sm:px-5 py-4 pb-20 lg:pb-6">
          {renderView()}
        </main>

        <footer className="hidden lg:flex items-center justify-center h-10 text-[11px] text-muted-foreground border-t bg-white/60 mt-auto">
          GarmentFlow — Outsourced Garments Operation Management System · © {new Date().getFullYear()} ·{" "}
          <a href="https://assetifyhub.com" target="_blank" rel="noreferrer" className="underline ml-1">Developed by Assetify Hub Technologies</a>
        </footer>
      </div>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t flex h-16 pb-[env(safe-area-inset-bottom)]" aria-label="Mobile navigation">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = view === tab.id || (tab.id === "dashboard" && view === "dashboard");
          if (tab.id === "quick-add") {
            return (
              <button key={tab.id} className="flex-1 flex flex-col items-center justify-center gap-0.5" onClick={() => setQuickAddOpen(true)}>
                <span className="h-8 w-8 -mt-4 rounded-full bg-violet-600 text-white flex items-center justify-center shadow-lg"><Icon className="h-4 w-4" /></span>
                <span className="text-[10px] text-muted-foreground">{tab.label}</span>
              </button>
            );
          }
          if (tab.id === "more") {
            return (
              <button key={tab.id} className={cn("flex-1 flex flex-col items-center justify-center gap-0.5", active && "text-violet-600")} onClick={() => setSidebarOpen(true)}>
                <Icon className="h-5 w-5" />
                <span className="text-[10px]">{tab.label}</span>
              </button>
            );
          }
          return (
            <button key={tab.id} className={cn("flex-1 flex flex-col items-center justify-center gap-0.5", active && "text-violet-600")} onClick={() => navigate(tab.id)}>
              <Icon className="h-5 w-5" />
              <span className="text-[10px]">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Command palette */}
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Search modules, orders, plans…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Modules">
            {allNavItems.map((c) => (
              <CommandItem key={c.id} onSelect={() => { navigate(c.id); setSearchOpen(false); }}>
                <span>{c.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{c.group}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Quick actions */}
      <QuickAddDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} navigate={navigate} can={can} />
    </div>
  );
}

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const QUICK_ACTIONS: { id: string; label: string; target: string; perm?: string }[] = [
  { id: "qa-plan", label: "Create Product Plan", target: "plans-new" },
  { id: "qa-purchase", label: "Add Purchase", target: "purchase-orders" },
  { id: "qa-expense", label: "Add Expense", target: "finance-expenses" },
  { id: "qa-receive", label: "Receive Materials", target: "receiving" },
  { id: "qa-send-factory", label: "Send to Factory", target: "workorders" },
  { id: "qa-collect-factory", label: "Collect from Factory", target: "workorders" },
  { id: "qa-send-tailor", label: "Send to Tailor", target: "workorders" },
  { id: "qa-collect-tailor", label: "Collect from Tailor", target: "workorders" },
  { id: "qa-qc", label: "Record Quality Inspection", target: "quality" },
  { id: "qa-package", label: "Create Package", target: "packaging" },
  { id: "qa-shipment", label: "Create Shipment", target: "shipments" },
  { id: "qa-receive-shipment", label: "Receive Shipment", target: "shipments" },
  { id: "qa-payment", label: "Record Payment", target: "finance-payments" },
  { id: "qa-sale", label: "Create Sale", target: "sales" },
];

function QuickAddDialog({ open, onOpenChange, navigate, can }: {
  open: boolean; onOpenChange: (o: boolean) => void; navigate: (id: string) => void; can: (p: string) => boolean;
}) {
  const actions = QUICK_ACTIONS.filter((a) => !a.perm || can(a.perm));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Quick Actions</DialogTitle>
          <DialogDescription>Jump straight into the most frequent daily operations.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((a) => (
            <Button key={a.id} variant="outline" className="justify-start h-auto py-2.5" onClick={() => navigate(a.target)}>
              {a.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type ViewProps = {
  user: SessionUser;
  navigate: (id: string, param?: string | null) => void;
  viewParam: string | null;
  lang: Lang;
  can: (p: string) => boolean;
  refreshNotifs?: () => void;
};

export { Root };
