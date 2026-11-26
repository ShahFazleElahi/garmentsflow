import { db } from "@/lib/db";
import { bad, ok, ser, requirePerm, q } from "./helpers";
import { NextRequest } from "next/server";
import { hashPassword, can, validPassword, scopedLocations } from "../auth";
import { refreshAlerts } from "../notify";
import { logAudit } from "../core";
import { DEFAULT_ROLES, PERMISSIONS } from "@/lib/constants";

const financialNotifications = ["OUTSTANDING_PAYABLE", "BUDGET_OVERRUN"];
const publicActivity = { amount: null, module: { notIn: ["FINANCE", "SALES"] } };

export async function handleGet(segments: string[], req: NextRequest) {
  const [resource] = segments;
  const auth = await requirePerm(req, "view");
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const financial = can(user, "view_financial");
  const locations = scopedLocations(user);

  if (resource === "users") {
    if (!can(user, "manage_users")) return bad("Permission denied: manage_users", 403);
    const rows = await db.user.findMany({
      select: { id: true, email: true, name: true, roleKey: true, isActive: true, lastLoginAt: true, twoFactorEnabled: true, createdAt: true, phone: true },
      orderBy: { createdAt: "asc" },
    });
    return ok(rows);
  }
  if (resource === "roles") {
    if (!can(user, "manage_users")) return bad("Permission denied", 403);
    const custom = await db.role.findMany({ orderBy: { key: "asc" } });
    return ok({ system: DEFAULT_ROLES, custom: custom.filter(r => !r.isSystem).map(r => ({ ...r, permissions: JSON.parse(r.permissionsJson) })) });
  }
  if (resource === "audit") {
    if (!can(user, "manage_users")) return bad("Permission denied", 403);
    const take = Math.min(parseInt(q(req, "take") ?? "200", 10) || 200, 1000);
    const rows = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take });
    return ok(rows);
  }
  if (resource === "notifications") {
    const rows = locations ? [] : financial ? await refreshAlerts() : await db.notification.findMany({
      where: { type: { notIn: financialNotifications } }, orderBy: [{ isRead: "asc" }, { createdAt: "desc" }], take: 100,
    });
    return ok(rows);
  }
  if (resource === "activity") {
    const rows = locations ? [] : await db.activityEvent.findMany({
      where: financial ? undefined : publicActivity, orderBy: { date: "desc" }, take: 200,
    });
    return ok(rows);
  }
  if (resource === "documents") {
    const documentScope = user.roleKey === "OWNER" ? {} : { uploadedById: user.id };
    if (segments[1] === "download") {
      const doc = await db.document.findFirst({ where: { id: segments[2] ?? "", ...documentScope } });
      if (!doc?.content) return bad("Document content not found", 404);
      return new Response(new Uint8Array(doc.content), { headers: { "Content-Type": doc.mimeType ?? "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    const rows = await db.document.findMany({ where: documentScope, orderBy: { createdAt: "desc" }, select: { id: true, code: true, category: true, fileName: true, mimeType: true, size: true, createdAt: true, uploadedById: true } });
    return ok(rows);
  }
  if (resource === "timeline") {
    if (locations) return ok([]);
    const planId = q(req, "planId");
    const batchId = q(req, "batchId");
    const filters = [...(planId ? [{ planId }] : []), ...(batchId ? [{ batchId }] : [])];
    const rows = await db.activityEvent.findMany({
      where: { ...(financial ? {} : publicActivity), ...(filters.length ? { OR: filters } : {}) },
      orderBy: { date: "desc" },
      take: 300,
    });
    return ok(rows);
  }
  return bad(`Unknown admin resource: ${resource}`, 404);
}

export async function handlePost(segments: string[], body: Record<string, unknown>, req: NextRequest) {
  const [resource, action] = segments;
  const auth = await requirePerm(req, resource === "users" || resource === "roles" || resource === "settings" ? "manage_users" : resource === "notifications" ? "view" : "edit");
  if ("error" in auth) return auth.error;
  const { user } = auth;

  if (["users", "roles", "settings"].includes(resource) && user.roleKey !== "OWNER") return bad("Owner access required", 403);
  if (resource === "users") {
    if (action === "create") {
      const { email, password, name, roleKey, phone, locationIds } = body as { email: string; password: string; name: string; roleKey: string; phone?: string; locationIds?: string[] };
      if (typeof email !== "string" || !email.includes("@") || !validPassword(password) || typeof name !== "string" || !name.trim()) return bad("Valid name, email and password (12–72 bytes) required");
      if (!DEFAULT_ROLES.some(r => r.key === roleKey) && !(await db.role.findUnique({ where: { key: roleKey } }))) return bad("Unknown role");
      const exists = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
      if (exists) return bad("A user with this email already exists");
      if (locationIds !== undefined && (!Array.isArray(locationIds) || locationIds.some(id => typeof id !== "string" || !id))) return bad("Invalid location assignment");
      const assigned = [...new Set(locationIds ?? [])];
      const passwordHash = await hashPassword(password);
      const created = await db.$transaction(async tx => {
        if (assigned.length !== await tx.location.count({ where: { id: { in: assigned }, isActive: true } })) {
          throw new Error("Invalid or inactive assigned location");
        }
        const record = await tx.user.create({
          data: { email: email.toLowerCase().trim(), passwordHash, name: name.trim(), roleKey, phone, createdById: user.id },
        });
        if (assigned.length) await tx.userLocation.createMany({
          data: assigned.map(locationId => ({ userId: record.id, locationId })),
        });
        await logAudit(tx, { userId: user.id, userName: user.name, action: "CREATE", entity: "User", entityId: record.id,
          newJson: { email: record.email, roleKey, locationIds: assigned } });
        return record;
      }).catch((error: unknown) => {
        if (error instanceof Error && error.message === "Invalid or inactive assigned location") return null;
        throw error;
      });
      if (!created) return bad("Invalid or inactive assigned location");
      return ok({ id: created.id });
    }
    if (action === "update") {
      const { id, isActive, roleKey, name, phone, locationIds, password } = body as { id: string; isActive?: boolean; roleKey?: string; name?: string; phone?: string; locationIds?: string[]; password?: string };
      if (id === user.id && (isActive === false || (roleKey && roleKey !== "OWNER"))) return bad("Cannot disable or demote your own owner account");
      if (password != null && password !== "" && !validPassword(password)) return bad("Password must be at least 12 characters and at most 72 bytes");
      if (roleKey && !DEFAULT_ROLES.some(r => r.key === roleKey) && !(await db.role.findUnique({ where: { key: roleKey } }))) return bad("Unknown role");
      const data: Record<string, unknown> = {};
      if (isActive != null) data.isActive = isActive;
      if (roleKey) data.roleKey = roleKey;
      if (name) data.name = name;
      if (phone != null) data.phone = phone;
      if (password && validPassword(password)) data.passwordHash = await hashPassword(password);
      if (locationIds !== undefined && (!Array.isArray(locationIds) || locationIds.some(location => typeof location !== "string" || !location))) {
        return bad("Invalid location assignment");
      }
      const assigned = locationIds ? [...new Set(locationIds)] : undefined;
      const updated = await db.$transaction(async tx => {
        if (assigned && assigned.length !== await tx.location.count({ where: { id: { in: assigned }, isActive: true } })) return false;
        await tx.user.update({ where: { id }, data });
        if (assigned) {
          await tx.userLocation.deleteMany({ where: { userId: id } });
          if (assigned.length) await tx.userLocation.createMany({ data: assigned.map(locationId => ({ userId: id, locationId })) });
        }
        if (isActive === false || password || roleKey || assigned) {
          await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        await logAudit(tx, { userId: user.id, userName: user.name, action: "UPDATE", entity: "User", entityId: id,
          newJson: { isActive, roleKey, locationIds: assigned } });
        return true;
      });
      if (!updated) return bad("Invalid or inactive assigned location");
      return ok({ updated: true });
    }
  }

  if (resource === "roles") {
    if (action === "create") {
      const { key, name, permissions } = body as { key: string; name: string; permissions: string[] };
      if (!key || !name) return bad("Role key and name are required");
      const normalized = key.toUpperCase().replaceAll(" ", "_");
      if (DEFAULT_ROLES.some(r => r.key === normalized)) return bad("Reserved role key");
      if (permissions && (!Array.isArray(permissions) || permissions.some(p => !PERMISSIONS.includes(p as typeof PERMISSIONS[number])))) return bad("Invalid permissions");
      const exists = await db.role.findUnique({ where: { key: normalized } });
      if (exists) return bad("Role key already exists");
      const role = await db.role.create({
        data: { key: normalized, name, permissionsJson: JSON.stringify(permissions ?? ["view"]) },
      });
      await db.$transaction((tx) => logAudit(tx, { userId: user.id, userName: user.name, action: "CREATE", entity: "Role", entityId: role.id, newJson: { key, name, permissions } }));
      return ok(role);
    }
    if (action === "update") {
      const { id, name, permissions } = body as { id: string; name?: string; permissions?: string[] };
      const existing = await db.role.findUnique({ where: { id } });
      if (!existing || existing.isSystem || DEFAULT_ROLES.some(r => r.key === existing.key)) return bad("System role cannot be edited", 403);
      if (permissions && (!Array.isArray(permissions) || permissions.some(p => !PERMISSIONS.includes(p as typeof PERMISSIONS[number])))) return bad("Invalid permissions");
      const role = await db.role.update({
        where: { id },
        data: { name, ...(permissions ? { permissionsJson: JSON.stringify(permissions) } : {}) },
      });
      return ok(role);
    }
  }

  if (resource === "notifications" && action === "read-all") {
    if (scopedLocations(user)) return bad("Company-wide notifications require unrestricted access", 403);
    await db.notification.updateMany({
      where: can(user, "view_financial") ? undefined : { type: { notIn: financialNotifications } },
      data: { isRead: true },
    });
    return ok({ read: true });
  }
  if (resource === "notifications" && action === "read") {
    if (scopedLocations(user)) return bad("Company-wide notifications require unrestricted access", 403);
    const changed = await db.notification.updateMany({
      where: { id: String(body.id), ...(can(user, "view_financial") ? {} : { type: { notIn: financialNotifications } }) },
      data: { isRead: true },
    });
    if (!changed.count) return bad("Notification not found", 404);
    return ok({ read: true });
  }

  if (resource === "documents") {
    if (action === "register") {
      // Document metadata registration (files stored via storage adapter)
      const code = `DOC-${Date.now().toString(36).toUpperCase()}`;
      const doc = await db.document.create({
        data: {
          code, category: String(body.category ?? "Other"), fileName: String(body.fileName),
          mimeType: body.mimeType as string | undefined, size: Number(body.size ?? 0),
          storagePath: String(body.storagePath), refType: body.refType as string | undefined,
          refId: body.refId as string | undefined, uploadedById: user.id,
        },
      });
      return ok(doc);
    }
  }

  if (resource === "documents" && action === "upload") {
    // Secure upload: validate type/size and persist outside the public webroot in PostgreSQL.
    const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    const MAX_SIZE = 4 * 1024 * 1024;
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) return bad("Expected multipart form data");
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const category = String(form.get("category") ?? "Other");
    if (!(file instanceof File)) return bad("No file provided");
    if (!ALLOWED.includes(file.type)) return bad("File type not allowed (pdf, jpg, png, webp only)");
    if (file.size <= 0 || file.size > MAX_SIZE) return bad("File must be between 1 byte and 4 MB");
    const buffer = Buffer.from(await file.arrayBuffer());
    const signature = file.type === "application/pdf" ? buffer.subarray(0,5).toString() === "%PDF-" : file.type === "image/png" ? buffer.subarray(0,8).toString("hex") === "89504e470d0a1a0a" : file.type === "image/jpeg" ? buffer.subarray(0,3).toString("hex") === "ffd8ff" : buffer.subarray(0,4).toString() === "RIFF" && buffer.subarray(8,12).toString() === "WEBP";
    if (!signature) return bad("File contents do not match the file type");
    const { randomUUID } = await import("node:crypto");
    const code = `DOC-${randomUUID()}`;
    const doc = await db.$transaction(async tx => {
      const saved = await tx.document.create({
        data: {
          code, category, fileName: file.name.slice(0, 180), mimeType: file.type,
          size: file.size, storagePath: `database:${code}`, content: new Uint8Array(buffer), uploadedById: user.id,
        },
        select: { id: true, code: true, category: true, fileName: true, size: true, createdAt: true },
      });
      await logAudit(tx, { userId: user.id, userName: user.name, action: "CREATE", entity: "Document", entityId: saved.id, refNo: code, newJson: { fileName: saved.fileName, category } });
      return saved;
    });
    return ok(doc);
  }

  if (resource === "settings" && action === "update") {
    const entries = body as Record<string, unknown>;
    for (const [key, value] of Object.entries(entries)) {
      await db.systemSetting.upsert({
        where: { key },
        update: { valueJson: JSON.stringify(value) },
        create: { key, valueJson: JSON.stringify(value) },
      });
    }
    await db.$transaction((tx) => logAudit(tx, { userId: user.id, userName: user.name, action: "UPDATE", entity: "SystemSetting", newJson: entries }));
    return ok({ saved: true });
  }

  return bad(`Unknown admin action: ${resource}/${action ?? ""}`, 404);
}
