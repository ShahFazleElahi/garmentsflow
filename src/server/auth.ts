import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { createHmac, randomBytes, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { roleHasPermission, DEFAULT_ROLES, type Permission } from "@/lib/constants";

const SESSION_COOKIE = "gf_session";
const SESSION_DAYS = 7;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
function encryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  return createHash("sha256").update(secret).digest();
}
export function encryptTotp(secret: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(x => x.toString("hex")).join(":");
}
export function decryptTotp(value: string) {
  const [iv, tag, data] = value.split(":").map(x => Buffer.from(x, "hex"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAuthTag(tag); return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export function validPassword(pw: unknown): pw is string {
  return typeof pw === "string" && pw.length >= 12 && Buffer.byteLength(pw) <= 72;
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try { return new URL(origin).host === (req.headers.get("host") ?? new URL(req.url).host) && req.headers.get("sec-fetch-site") !== "cross-site"; } catch { return false; }
}

// ── Passwords ──
export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 11);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

// ── TOTP (RFC 6238) ──
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function generateTotpSecret(length = 32): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += B32[b % 32];
  return out;
}
function base32Decode(s: string): Buffer {
  let bits = "";
  for (const c of s.toUpperCase()) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totpCode(secret: string, offset = 0): string {
  const counter = Math.floor(Date.now() / 30000) + offset;
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[o] & 0x7f) << 24) | (hmac[o + 1] << 16) | (hmac[o + 2] << 8) | hmac[o + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}
export function verifyTotp(secret: string, code: string): boolean {
  for (const off of [-1, 0, 1]) {
    const expected = totpCode(secret, off);
    if (typeof code === "string" && /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return true;
  }
  return false;
}
export function totpProvisioningUri(email: string, secret: string): string {
  return `otpauth://totp/GarmentFlow:${encodeURIComponent(email)}?secret=${secret}&issuer=GarmentFlow&algorithm=SHA1&digits=6&period=30`;
}

// ── Recovery codes ──
export function generateRecoveryCodes(): { plain: string[]; hashed: string[] } {
  const plain = Array.from({ length: 8 }, () => randomBytes(5).toString("hex"));
  return { plain, hashed: plain.map((c) => bcrypt.hashSync(c, 10)) };
}
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user?.recoveryCodes) return false;
  const hashes: string[] = JSON.parse(user.recoveryCodes);
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(code, hashes[i])) {
      hashes.splice(i, 1);
      const changed = await db.user.updateMany({ where: { id: userId, recoveryCodes: user.recoveryCodes }, data: { recoveryCodes: JSON.stringify(hashes) } });
      return changed.count === 1;
    }
  }
  return false;
}

// Database-backed rate limits are shared by all Vercel instances.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
export async function rateLimit(key: string): Promise<boolean> {
  const window = Math.floor(Date.now() / WINDOW_MS);
  const id = digest(`${window}:${key}`);
  const expiresAt = new Date((window + 1) * WINDOW_MS);
  const record = await db.authRateLimit.upsert({ where: { key: id }, create: { key: id, count: 1, expiresAt }, update: { count: { increment: 1 } } });
  if (Math.random() < 0.02) await db.authRateLimit.deleteMany({where:{expiresAt:{lt:new Date()}}});
  return record.count <= MAX_ATTEMPTS;
}
export async function clearRateLimit(key: string) {
  await db.authRateLimit.deleteMany({where:{key:digest(`${Math.floor(Date.now()/WINDOW_MS)}:${key}`)}});
}
export async function consumeTotp(userId: string, secret: string, code: string): Promise<boolean> {
  if (typeof code !== "string" || !/^[0-9]{6}$/.test(code)) return false;
  for (const offset of [-1,0,1]) {
    const step = BigInt(Math.floor(Date.now()/30000) + offset);
    if (totpCode(secret, offset) !== code) continue;
    const updated = await db.user.updateMany({where:{id:userId,OR:[{lastTotpStep:null},{lastTotpStep:{lt:step}}]},data:{lastTotpStep:step}});
    return updated.count === 1;
  }
  return false;
}

// ── Sessions ──
export async function createSession(userId: string, ip?: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await db.session.create({ data: { token: digest(token), userId, expiresAt, ip, userAgent } });
  return token;
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  locationIds: string[];
};

export async function getSessionUser(req: Request): Promise<AuthUser | null> {
  let token: string | undefined;
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (match) token = match[1];
  if (!token) {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value;
  }
  if (!token) return null;
  const session = await db.session.findUnique({ where: { token: digest(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) return null;
  return buildAuthUser(session.user.id);
}

export async function buildAuthUser(userId: string): Promise<AuthUser> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const customRoles = await db.role.findMany({ select: { key: true, permissionsJson: true, name: true } });
  const def = DEFAULT_ROLES.find((r) => r.key === user.roleKey);
  const custom = customRoles.find((r) => r.key === user.roleKey);
  let perms: string[];
  if (user.roleKey === "OWNER") perms = ["*"];
  else if (custom) perms = JSON.parse(custom.permissionsJson);
  else perms = def?.permissions ?? [];
  const locs = await db.userLocation.findMany({ where: { userId }, select: { locationId: true } });
  return {
    id: user.id, email: user.email, name: user.name, roleKey: user.roleKey,
    roleName: custom?.name ?? def?.name ?? user.roleKey,
    permissions: perms, locationIds: locs.map((l) => l.locationId),
  };
}

export function can(user: AuthUser | null, perm: Permission): boolean {
  if (!user) return false;
  if (user.permissions.includes("*")) return true;
  return user.permissions.includes(perm);
}

export async function revokeSession(token: string) {
  await db.session.updateMany({ where: { token: digest(token) }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string) {
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Extract session token from request (for logout). */
export function tokenFromRequest(req: NextRequest): string | undefined {
  return req.cookies.get(SESSION_COOKIE)?.value;
}

// Sensitive partner fields filtered by permission
export function filterPartnerFinancial<T extends Record<string, unknown>>(partner: T, user: AuthUser): T {
  if (can(user, "view_financial")) return partner;
  const { bankInfo, openingBalance, ...rest } = partner;
  return rest as T;
}
