import { useEffect, useState, type ReactNode } from "react";
import { addUnauthorizedHandler, apiBaseUrl, apiFetch } from "@/lib/api-base";
import { parseMfaPhase, parseSessionBody } from "@/lib/account-result";
import { submitMfaChallenge } from "@/lib/mfa-api";
import {
  createServerInvite,
  signInWithPassword,
  signOutServer,
  signUpWithInvite,
  type AccountUser,
} from "@/lib/account-api";
import { probeApiMode, readDemoFlag } from "@/lib/api-mode";
import { focusBrowserVault, forgetBrowserVault } from "@/lib/e2ee/browser";
import { SessionContext, type ServerSession } from "@/lib/server-session-state";

export function ServerSessionProvider({ children }: { children: ReactNode }) {
  const demo = readDemoFlag();
  const configured = !demo;
  const [mode, setMode] = useState<ServerSession["mode"]>(demo ? "demo" : "pending");
  const [user, setUserState] = useState<AccountUser | null>(null);
  const [mfa, setMfa] = useState<ServerSession["mfa"]>("ok");
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  function setUser(next: AccountUser | null) {
    focusBrowserVault(next?.id ?? null);
    setUserState(next);
  }

  useEffect(() => {
    if (demo) return;
    return addUnauthorizedHandler(() => {
      setUser(null);
    });
  }, [demo]);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    probeApiMode(apiBaseUrl(), fetch, 2500, false).then(async (next) => {
      if (cancelled) return;
      if (next === "live") {
        const response = await apiFetch("/api/auth/get-session", { credentials: "include" });
        const body = await response.json().catch(() => null);
        const session = parseSessionBody(response.status, body);
        const phase = parseMfaPhase(body);
        if (cancelled) return;
        // Pending never reaches this branch. A 503 is not a known sign-out.
        if (response.status === 401 || (response.status === 200 && !session)) await forgetBrowserVault();
        if (cancelled) return;
        setMfa(phase.mfa);
        setMfaEnrolled(phase.mfaEnrolled);
        setUser(phase.mfa === "challenge" ? null : session);
      }
      if (!cancelled) setMode(next);
    });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  const applyPhase = (phase: { mfa: ServerSession["mfa"]; mfaEnrolled: boolean }, session: AccountUser | null) => {
    setMfa(phase.mfa);
    setMfaEnrolled(phase.mfaEnrolled);
    setUser(phase.mfa === "challenge" ? null : session);
  };

  const recheck = async () => {
    if (demo) return;
    const next = await probeApiMode(apiBaseUrl(), fetch, 2500, false);
    if (next === "live") {
      const response = await apiFetch("/api/auth/get-session", { credentials: "include" });
      const body = await response.json().catch(() => null);
      applyPhase(parseMfaPhase(body), parseSessionBody(response.status, body));
    } else {
      setUser(null);
      setMfa("ok");
      setMfaEnrolled(false);
    }
    setMode(next);
  };

  const value: ServerSession = {
    configured,
    mode,
    user,
    mfa,
    mfaEnrolled,
    signUp: async (input) => {
      const result = await signUpWithInvite(input);
      if (result.ok) {
        const response = await apiFetch("/api/auth/get-session", { credentials: "include" });
        const body = await response.json().catch(() => null);
        applyPhase(parseMfaPhase(body), parseSessionBody(response.status, body));
      }
      return result;
    },
    signIn: async (input) => {
      const result = await signInWithPassword(input);
      if (result.ok && result.mfa === "challenge") {
        setMfa("challenge");
        setMfaEnrolled(true);
        setUser(null);
        return result;
      }
      if (result.ok) {
        const response = await apiFetch("/api/auth/get-session", { credentials: "include" });
        const body = await response.json().catch(() => null);
        applyPhase(parseMfaPhase(body), parseSessionBody(response.status, body));
      }
      return result;
    },
    finishMfa: async (code) => {
      const result = await submitMfaChallenge(code);
      if (!result.ok) return { ok: false, message: result.message };
      const response = await apiFetch("/api/auth/get-session", { credentials: "include" });
      const body = await response.json().catch(() => null);
      applyPhase(parseMfaPhase(body), parseSessionBody(response.status, body));
      return { ok: true };
    },
    signOut: async () => {
      try {
        await forgetBrowserVault(user?.id);
      } finally {
        try {
          await signOutServer();
        } finally {
          setUser(null);
          setMfa("ok");
          setMfaEnrolled(false);
        }
      }
    },
    recheck,
    createInvite: createServerInvite,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
