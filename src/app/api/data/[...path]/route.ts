import { NextRequest } from "next/server";
import { canWriteModule, getSessionUser, sameOrigin, type WorkflowPermission } from "@/server/auth";
import { ok, bad } from "@/server/routes/helpers";
import * as master from "@/server/routes/master";
import * as dashboard from "@/server/routes/dashboard";
import * as plans from "@/server/routes/plans";
import * as procurement from "@/server/routes/procurement";
import * as inventoryx from "@/server/routes/inventoryx";
import * as production from "@/server/routes/production";
import * as ops from "@/server/routes/ops";
import * as finance from "@/server/routes/finance";
import * as reports from "@/server/routes/reports";
import * as admin from "@/server/routes/admin";

const DOMAINS: Record<string, { get?: (segments: string[], req: NextRequest) => Promise<Response>; post?: (segments: string[], body: Record<string, unknown>, req: NextRequest) => Promise<Response> }> = {
  master: { get: master.handleGet, post: master.handlePost },
  dashboard: { get: dashboard.handleGet },
  plans: { get: plans.handleGet, post: plans.handlePost },
  procurement: { get: procurement.handleGet, post: procurement.handlePost },
  inventory: { get: inventoryx.handleGet, post: inventoryx.handlePost },
  production: { get: production.handleGet, post: production.handlePost },
  ops: { get: ops.handleGet, post: ops.handlePost },
  finance: { get: finance.handleGet, post: finance.handlePost },
  reports: { get: reports.handleGet },
  admin: { get: admin.handleGet, post: admin.handlePost },
};

type Ctx = { params: Promise<{ path?: string[] }> };

function workflowPermission(domain: string, resource: string): WorkflowPermission | undefined {
  switch (domain) {
    case "plans": return "module_planning";
    case "procurement": return resource === "payments" || resource === "invoices" ? "module_finance" : "module_procurement";
    case "inventory": return "module_inventory";
    case "production": return "module_production";
    case "finance": return resource === "sales" ? "module_sales" : "module_finance";
    case "ops":
      if (resource === "inspections") return "module_quality";
      if (resource === "packages") return "module_packaging";
      if (resource === "shipments" || resource === "transport") return "module_logistics";
      if (resource === "finished") return "module_inventory";
  }
}

async function dispatch(req: NextRequest, ctx: Ctx, method: "GET" | "POST"): Promise<Response> {
  const { path } = await ctx.params;
  const segments = path ?? [];
  const [domain, ...rest] = segments;

  if (domain === "health") return ok({ status: "ok" });
  const mod = Object.hasOwn(DOMAINS, domain) ? DOMAINS[domain] : undefined;
  if (!mod) return bad(`Unknown API domain: ${domain ?? "(none)"}`, 404);

  if (method === "POST" && !sameOrigin(req)) return bad("Cross-origin request denied", 403);
  try {
    const user = await getSessionUser(req);
    if (!user) return bad("Authentication required", 401);
    if (method === "GET") {
      if (!mod.get) return bad("GET not supported for this domain", 405);
      return await mod.get(rest, req);
    }
    const permission = workflowPermission(domain, rest[0] ?? "");
    if (permission && !canWriteModule(user, permission)) return bad(`Permission denied: ${permission}`, 403);
    const multipart = domain === "admin" && rest.join("/") === "documents/upload";
    const body = multipart ? {} : await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Invalid JSON body");
    if (!mod.post) return bad("POST not supported for this domain", 405);
    return await mod.post(rest, body as Record<string, unknown>, req);
  } catch (e) {
    console.error(`[api:${domain}]`, e instanceof Error ? e.name : "Error");
    return bad("Internal server error", 500);
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return dispatch(req, ctx, "GET");
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return dispatch(req, ctx, "POST");
}
