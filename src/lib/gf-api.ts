"use client";

// GarmentFlow client API + helpers
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; requires2fa?: boolean };

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/data/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as ApiResult<T>;
  if (!json.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json.data;
}

export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export async function authReq<T = unknown>(action: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/auth/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as ApiResult<T> & { requires2fa?: boolean };
  if (!json.ok) {
    const err = new Error(json.error || "Request failed") as Error & { requires2fa?: boolean };
    err.requires2fa = json.requires2fa;
    throw err;
  }
  return json.data;
}

// ── formatting ──
export const fmtMoney = (v: unknown, currency = "BDT"): string => {
  const n = Number(v ?? 0);
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "৳";
  return `${symbol}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
};
export const fmtNum = (v: unknown, dp = 0): string =>
  Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: dp });
export const fmtDate = (d: unknown): string => {
  if (!d) return "—";
  const date = new Date(d as string | number | Date);
  return isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
};
export const fmtDateTime = (d: unknown): string => {
  if (!d) return "—";
  const date = new Date(d as string | number | Date);
  return isNaN(date.getTime()) ? "—" : date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
export const statusLabel = (s: unknown): string =>
  String(s ?? "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// ── i18n (English + Bangla) ──
export const LANG = { en: "EN", bn: "বাং" } as const;
export type Lang = keyof typeof LANG;
const BN_DICT: Record<string, string> = {
  "Dashboard": "ড্যাশবোর্ড", "Executive Dashboard": "নির্বাহী ড্যাশবোর্ড", "Daily Operations": "দৈনিক কার্যক্রম",
  "Product Planning": "প্রোডাক্ট প্ল্যানিং", "All Product Plans": "সকল প্রোডাক্ট প্ল্যান", "Collections": "কালেকশন",
  "Procurement": "ক্রয়", "Purchase Orders": "ক্রয়াদেশ", "Direct Purchases": "সরাসরি ক্রয়", "Material Receiving": "মালামাল গ্রহণ",
  "Raw Material Inventory": "কাঁচামাল মজুদ", "Inventory Overview": "মজুদ সারসংক্ষেপ", "Stock Ledger": "স্টক লেজার",
  "Vendor Custody": "ভেন্ডর কাস্টডি", "Production": "উৎপাদন", "Production Batches": "উৎপাদন ব্যাচ", "Work Orders": "ওয়ার্ক অর্ডার",
  "Quality Control": "গুণগত মান নিয়ন্ত্রণ", "Inspections": "পরিদর্শন", "Finished Goods": "সমাপ্ত পণ্য", "Packaging": "প্যাকেজিং",
  "Logistics": "লজিস্টিকস", "Shipments": "শিপমেন্ট", "Transportation": "পরিবহন", "Business Partners": "ব্যবসায়িক অংশীদার",
  "Finance": "আর্থিক", "Expenses": "খরচ", "Payments": "পেমেন্ট", "Costing": "ব্যয় নির্ধারণ", "Sales": "বিক্রয়",
  "Reports": "রিপোর্ট", "Administration": "প্রশাসন", "Users": "ব্যবহারকারী", "Settings": "সেটিংস", "Audit Log": "নিরীক্ষা লগ",
  "Notifications": "বিজ্ঞপ্তি", "Search": "খুঁজুন", "Create": "তৈরি করুন", "Save": "সংরক্ষণ", "Cancel": "বাতিল",
  "Approve": "অনুমোদন", "Quick Actions": "দ্রুত অ্যাকশন", "Overview": "সারসংক্ষেপ", "New Plan": "নতুন প্ল্যান",
  "More": "আরও", "Operations": "অপারেশন", "Home": "হোম", "Logout": "লগআউট", "Total": "মোট", "Status": "স্ট্যাটাস",
};
export function t(key: string, lang: Lang): string {
  if (lang === "en") return key;
  return BN_DICT[key] ?? key;
}

// ── CSV download helper ──
export function downloadCsv(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const idem = () => `idem-${crypto.randomUUID()}`;
