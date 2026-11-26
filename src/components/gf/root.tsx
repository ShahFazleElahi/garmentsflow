"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authReq, type Lang, t as tr } from "@/lib/gf-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorText } from "./ui-bits";
import { GarmentFlowLogo } from "./logo";
import { AppShell } from "./shell";

export type SessionUser = {
  id: string; email: string; name: string; roleKey: string; roleName: string;
  permissions: string[]; locationIds: string[];
};

export function Root() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => { setUser(j?.data?.user ?? null); })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const onLogout = useCallback(async () => {
    try { await authReq("logout"); setUser(null); } catch { window.alert("Sign out failed. Please retry."); }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <GarmentFlowLogo className="h-12 w-12" />
          <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-violet-500" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen onLogin={setUser} lang={lang} setLang={setLang} />;
  return <AppShell user={user} onLogout={onLogout} lang={lang} setLang={setLang} />;
}

function LoginScreen({ onLogin, lang, setLang }: { onLogin: (u: SessionUser) => void; lang: Lang; setLang: (l: Lang) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const result = await authReq<{ user: SessionUser }>("login", { email, password, totp: totp || undefined, recoveryCode: useRecovery ? recoveryCode : undefined });
      onLogin(result.user);
    } catch (err) {
      const e2 = err as Error & { requires2fa?: boolean };
      if (e2.requires2fa) setNeeds2fa(true);
      setError(e2.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#f7f6f3]">
      {/* Brand panel */}
      <div className="lg:w-[46%] bg-[#231f33] text-white flex flex-col justify-between p-8 lg:p-14">
        <div className="flex items-center gap-3">
          <GarmentFlowLogo className="h-10 w-10" />
          <div>
            <p className="font-semibold text-lg tracking-tight">GarmentFlow</p>
            <p className="text-xs text-white/60">Outsourced Garments Operation Management</p>
          </div>
        </div>
        <div className="my-10 lg:my-0">
          <h1 className="text-3xl lg:text-4xl font-semibold leading-tight">From Product Planning<br />to Global Delivery.</h1>
          <p className="mt-4 text-white/60 text-sm max-w-md leading-relaxed">
            Plan collections, procure materials, outsource embroidery and tailoring, run quality control,
            pack, ship Dhaka → Sylhet → UK — and know your true cost and profit on every product.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 text-xs text-white/70 max-w-md">
            {["Product Planning & Matrix", "MRP & Budgets", "Vendor Custody Tracking", "Material Reconciliation", "Landed Costing", "Multi-location Inventory"].map((f) => (
              <div key={f} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-violet-400" />{f}</div>
            ))}
          </div>
        </div>
        <footer className="space-y-2 text-xs text-white/50 leading-relaxed">
          <p>
            Developed by{" "}
            <a
              href="https://assetifyhub.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-white/80 hover:text-white transition-colors"
            >
              Assetify Hub Technologies
            </a>
          </p>
          <p>
            © {currentYear} Assetify Hub Technologies. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="https://assetifyhub.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              assetifyhub.com
            </a>
            <span>·</span>
            <a
              href="https://www.facebook.com/profile.php?id=61583933039295"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              Facebook
            </a>
          </div>
        </footer>
      </div>

      {/* Login form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div className="lg:hidden flex items-center gap-2 mb-2">
            <GarmentFlowLogo className="h-8 w-8" />
            <span className="font-semibold">GarmentFlow</span>
          </div>
          <h2 className="text-xl font-semibold">{tr("Sign in", lang)}</h2>
          <ErrorText error={error} />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Email</label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Password</label>
            <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {needs2fa && !useRecovery && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Two-factor code (TOTP)</label>
              <Input value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="123456" inputMode="numeric" />
            </div>
          )}
          {needs2fa && useRecovery && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Recovery code</label>
              <Input value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} placeholder="xxxxxxxxxx" />
            </div>
          )}
          {needs2fa && (
            <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setUseRecovery((v) => !v)}>
              {useRecovery ? "Use authenticator app instead" : "Use a recovery code instead"}
            </Button>
          )}
          <Button type="submit" disabled={busy} className="w-full bg-violet-600 hover:bg-violet-700">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Secure sign in</span>
            <button type="button" className="underline" onClick={() => setLang(lang === "en" ? "bn" : "en")}>
              {lang === "en" ? "বাংলা" : "English"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
