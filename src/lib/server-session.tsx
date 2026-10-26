import { useEffect, useState, type ReactNode } from "react";
import { addUnauthorizedHandler, apiBaseUrl, apiFetch } from "@/lib/api-base";
import { parseSessionBody } from "@/lib/account-result";
import {
  createServerInvite,
  readServerSession,
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
        if (cancelled) return;
        // Pending never reaches this branch. A 503 is not a known sign-out.
        const absent = response.status === 401 || (response.status === 200 && !session);
        if (absent) await forgetBrowserVault();
        if (cancelled) return;
        setUser(session);
      }
      if (!cancelled) setMode(next);
    });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  const recheck = async () => {
    if (demo) return;
    const next = await probeApiMode(apiBaseUrl(), fetch, 2500, false);
    if (next === "live") setUser(await readServerSession());
    else setUser(null);
    setMode(next);
  };

  const value: ServerSession = {
    configured,
    mode,
    user,
    signUp: async (input) => {
      const result = await signUpWithInvite(input);
      if (result.ok) setUser(await readServerSession());
      return result;
    },
    signIn: async (input) => {
      const result = await signInWithPassword(input);
      if (result.ok) setUser(await readServerSession());
      return result;
    },
    signOut: async () => {
      try {
        await forgetBrowserVault(user?.id);
      } finally {
        try {
          await signOutServer();
        } finally {
          setUser(null);
        }
      }
    },
    recheck,
    createInvite: createServerInvite,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
