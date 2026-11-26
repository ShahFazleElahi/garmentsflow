import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionUser, can, AuthUser } from "@/server/auth";
import type { Permission } from "@/lib/constants";

export function ok(data: unknown, init?: number) {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200, headers: { "Cache-Control": "private, no-store" } });
}
export function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function requireUser(req: NextRequest): Promise<AuthUser | null> {
  return getSessionUser(req);
}

export async function requirePerm(req: NextRequest, perm: Permission): Promise<{ user: AuthUser } | { error: NextResponse }> {
  const user = await getSessionUser(req);
  if (!user) return { error: bad("Authentication required", 401) };
  if (!can(user, perm)) return { error: bad(`Permission denied: ${perm}`, 403) };
  return { user };
}

export function parseId(segments: string[]): string | null {
  return segments[0] ?? null;
}

export function q(req: NextRequest, key: string): string | undefined {
  return req.nextUrl.searchParams.get(key) ?? undefined;
}

export function qInt(req: NextRequest, key: string, def?: number): number | undefined {
  const v = req.nextUrl.searchParams.get(key);
  if (v == null) return def;
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

export function qDate(req: NextRequest, key: string): Date | undefined {
  const v = req.nextUrl.searchParams.get(key);
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

/** Serialize Decimal-containing objects for JSON transport. */
export function ser<T>(obj: T): T {
  function walk(value: unknown): unknown {
    if (Prisma.Decimal.isDecimal(value)) return Number(value.toString());
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,walk(v)]));
    return value;
  }
  return walk(obj) as T;
}
