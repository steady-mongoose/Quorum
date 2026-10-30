import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  addAgeRequiredHandler,
  addUnauthorizedHandler,
  apiBaseUrl,
  apiFetch,
  apiUrl,
  softenFetch,
} from "@/lib/api-base";
import { parseAgeConfirmed, parseMfaPhase, parseSessionBody } from "@/lib/account-result";
import { submitMfaChallenge } from "@/lib/mfa-api";
import {
  confirmAgeServer,
  createServerInvite,
  signInWithPassword,
  signOutServer,
  signUpWithInvite,
  type AccountUser,
} from "@/lib/account-api";
import { probeApiMode, readDemoFlag } from "@/lib/api-mode";
import { focusBrowserVault, forgetBrowserVault } from "@/lib/e2ee/browser";
import { SIGNED_UP_NO_SESSION, SIGNED_UP_NO_SESSION_MESSAGE } from "@/lib/account-result";
import { SessionContext, type ServerSession } from "@/lib/server-session-state";

export function ServerSessionProvider({ children }: { children: ReactNode }) {
  const demo = readDemoFlag();
  const configured = !demo;
  const [mode, setMode] = useState<ServerSession["mode"]>(demo ? "demo" : "pending");
  const [user, setUserState] = useState<AccountUser | null>(null);
  const [mfa, setMfa] = useState<ServerSession["mfa"]>("ok");
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(true);
  // The signed-in user as of the last set, so refreshPhase compares against the
  // current person rather than the one captured when its render ran.
  const userRef = useRef<AccountUser | null>(null);
  function setUser(next: AccountUser | null) {
    focusBrowserVault(next?.id ?? null);
    userRef.current = next;
    setUserState(next);
  }

  useEffect(() => {
    if (demo) return;
    return addUnauthorizedHandler(() => {
      setUser(null);
    });
  }, [demo]);

  // Any member route answering 403 age_required brings up the age step.
  useEffect(() => {
    if (demo) return;
    return addAgeRequiredHandler(() => setAgeConfirmed(false));
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
        setAgeConfirmed(parseAgeConfirmed(body));
        setUser(phase.mfa === "challenge" ? null : session);
      }
      if (!cancelled) setMode(next);
    });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  const applyPhase = (
    phase: { mfa: ServerSession["mfa"]; mfaEnrolled: boolean },
    session: AccountUser | null,
    body?: unknown,
  ) => {
    setAgeConfirmed(parseAgeConfirmed(body));
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
      applyPhase(parseMfaPhase(body), parseSessionBody(response.status, body), body);
    } else {
      setUser(null);
      setMfa("ok");
      setMfaEnrolled(false);
      setAgeConfirmed(true);
    }
    setMode(next);
  };

  const refreshPhase = async () => {
    if (demo) return;
    try {
      // softenFetch, not apiFetch: a 401 here must not run the sign-out
      // handlers. The panel that asked has just shown recovery codes or
      // "Authenticator is off."; the next ordinary API call still signs out.
      const response = await softenFetch(apiUrl("/api/auth/get-session"), { credentials: "include" });
      const body = await response.json().catch(() => null);
      const session = parseSessionBody(response.status, body);
      // Only a session that came back replaces this one. A 401, a 5xx, a
      // non-JSON body or a dropped connection leaves the page as it is.
      if (response.status !== 200 || !session) return;
      const phase = parseMfaPhase(body);
      setMfa(phase.mfa);
      setMfaEnrolled(phase.mfaEnrolled);
      // Same person: keep the user object, so the board does not reload and
      // the open panel (with its recovery codes) stays mounted.
      if (phase.mfa === "challenge") setUser(null);
      else if (session.id !== userRef.current?.id) setUser(session);
    } catch {
      // Keep the current phase; the next load reads it again.
    }
  };

  const value: ServerSession = {
    configured,
    mode,
    user,
    mfa,
    mfaEnrolled,
    ageConfirmed,
    confirmAge: async (adult) => {
      const result = await confirmAgeServer(adult);
      if (!result.ok) return { ok: false, message: result.message };
      setAgeConfirmed(true);
      return { ok: true };
    },
    signUp: async (input) => {
      const result = await signUpWithInvite(input);
      if (!result.ok) return result;
      const response = await apiFetch("/api/auth/get-session", { credentials: "include" });
      const body = await response.json().catch(() => null);
      const session = parseSessionBody(response.status, body);
      applyPhase(parseMfaPhase(body), session, body);
      // The account exists and the code is spent, but no session came back.
      // Say so, rather than leaving the person on a silent form.
      if (!session)
        return { ok: false, message: SIGNED_UP_NO_SESSION_MESSAGE, code: SIGNED_UP_NO_SESSION };
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
        applyPhase(parseMfaPhase(body), parseSessionBody(response.status, body), body);
      }
      return result;
    },
    finishMfa: async (code) => {
      const result = await submitMfaChallenge(code);
      if (!result.ok) return { ok: false, message: result.message };
      const response = await apiFetch("/api/auth/get-session", { credentials: "include" });
      const body = await response.json().catch(() => null);
      applyPhase(parseMfaPhase(body), parseSessionBody(response.status, body), body);
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
          setAgeConfirmed(true);
        }
      }
    },
    recheck,
    refreshPhase,
    createInvite: createServerInvite,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
