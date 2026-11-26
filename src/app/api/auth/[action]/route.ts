import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  verifyPassword, createSession, setSessionCookie, clearSessionCookie, getSessionUser,
  rateLimit, clearRateLimit, revokeSession, tokenFromRequest, verifyTotp, consumeRecoveryCode,
  buildAuthUser, generateTotpSecret, totpProvisioningUri, generateRecoveryCodes, hashPassword, consumeTotp, encryptTotp, decryptTotp, validPassword, sameOrigin,
} from "@/server/auth";
import { logAudit, logActivity } from "@/server/core";
import { ok, bad } from "@/server/routes/helpers";

async function handlePost(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  if (!sameOrigin(req)) return bad("Cross-origin request denied", 403);
  const { action } = await ctx.params;
  const body = action === "logout" ? {} : await req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Invalid request body");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  if (action === "login") {
    const { email, password, totp, recoveryCode } = body as { email: string; password: string; totp?: string; recoveryCode?: string };
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password || Buffer.byteLength(password) > 72) return bad("Email and password are required");
    const emailKey = email.toLowerCase().trim();
    if (!(await rateLimit(`ip:${ip}`)) || !(await rateLimit(`user:${emailKey}`))) {
      return bad("Too many login attempts. Try again in a few minutes.", 429);
    }
    const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.isActive) return bad("Invalid email or password", 401);
    if (user.lockedUntil && user.lockedUntil > new Date()) return bad("Account temporarily locked. Try again later.", 423);
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const failed = user.lockedUntil && user.lockedUntil <= new Date() ? 1 : user.failedLogins + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed,
          lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });
      return bad("Invalid email or password", 401);
    }
    if (user.twoFactorEnabled) {
      if (!user.twoFactorSecret) return bad("Two-factor configuration unavailable", 401);
      if (typeof recoveryCode === "string" && recoveryCode) {
        const consumed = await consumeRecoveryCode(user.id, recoveryCode);
        if (!consumed) return bad("Invalid recovery code", 401);
      } else if (!totp || !(await consumeTotp(user.id, decryptTotp(user.twoFactorSecret), totp))) {
        return NextResponse.json({ ok: false, error: "TOTP code required", requires2fa: true }, { status: 401 });
      }
    }
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const token = await createSession(user.id, ip, req.headers.get("user-agent") ?? undefined);
    await setSessionCookie(token);
    await clearRateLimit(`user:${emailKey}`);
    const authUser = await buildAuthUser(user.id);
    await db.$transaction((tx) =>
      Promise.all([
        logAudit(tx, { userId: user.id, userName: user.name, action: "LOGIN", entity: "User", entityId: user.id }),
        logActivity(tx, { module: "ADMIN", action: "login", description: `${user.name} logged in`, userName: user.name }),
      ])
    );
    return ok({ user: authUser });
  }

  if (action === "logout") {
    const token = tokenFromRequest(req);
    if (token) await revokeSession(token);
    await clearSessionCookie();
    return ok({ loggedOut: true });
  }

  if (action === "bootstrap") return bad("Use the secure CLI bootstrap", 403);

  if (action === "2fa-setup") {
    const user = await getSessionUser(req);
    if (!user) return bad("Authentication required", 401);
    const existing = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (existing.twoFactorEnabled) return bad("Two-factor authentication is already enabled", 409);
    const secret = generateTotpSecret();
    const changed = await db.user.updateMany({
      where: { id: user.id, twoFactorEnabled: false },
      data: { twoFactorSecret: encryptTotp(secret) },
    });
    if (changed.count !== 1) return bad("Two-factor authentication is already enabled", 409);
    return ok({ secret, uri: totpProvisioningUri(user.email, secret) });
  }

  if (action === "2fa-enable") {
    const user = await getSessionUser(req);
    if (!user) return bad("Authentication required", 401);
    const { code } = body as { code: string };
    const dbUser = await db.user.findUnique({ where: { id: user.id } });
    if (!dbUser?.twoFactorSecret) return bad("Start 2FA setup first");
    if (dbUser.twoFactorEnabled) return bad("Two-factor authentication is already enabled", 409);
    if (!(await rateLimit(`2fa:${user.id}`))) return bad("Too many attempts", 429);
    if (!verifyTotp(decryptTotp(dbUser.twoFactorSecret), code)) return bad("Invalid TOTP code");
    const codes = generateRecoveryCodes();
    const changed = await db.user.updateMany({
      where: { id: user.id, twoFactorEnabled: false, twoFactorSecret: dbUser.twoFactorSecret },
      data: { twoFactorEnabled: true, recoveryCodes: JSON.stringify(codes.hashed) },
    });
    if (changed.count !== 1) return bad("Two-factor setup changed. Restart setup.", 409);
    return ok({ recoveryCodes: codes.plain });
  }

  if (action === "change-password") {
    const user = await getSessionUser(req);
    if (!user) return bad("Authentication required", 401);
    const { current, next } = body as { current: string; next: string };
    const dbUser = await db.user.findUnique({ where: { id: user.id } });
    if (typeof current !== "string" || !dbUser || !(await verifyPassword(current, dbUser.passwordHash))) return bad("Current password is incorrect");
    if (!validPassword(next)) return bad("New password must be at least 12 characters and at most 72 UTF-8 bytes");
    const passwordHash = await hashPassword(next);
    const changed = await db.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: user.id, passwordHash: dbUser.passwordHash, isActive: true }, data: { passwordHash },
      });
      if (updated.count !== 1) return false;
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return true;
    });
    if (!changed) return bad("Password or account changed. Sign in again.", 409);
    await clearSessionCookie();
    return ok({ changed: true });
  }

  return bad("Unknown auth action", 404);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  try { return await handlePost(req, ctx); } catch (e) { console.error("Auth request failed", e instanceof Error ? e.name : "Error"); return bad("Authentication request failed", 500); }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (action === "me") {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: true, data: { user: null } });
    return ok({ user });
  }
  return bad("Unknown auth action", 404);
}
