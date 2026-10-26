import { useEffect, useState, type ReactNode } from "react";
import { apiBaseUrl } from "@/lib/api-base";
import {
  createServerInvite,
  readServerSession,
  signInWithPassword,
  signOutServer,
  signUpWithInvite,
  type AccountUser,
} from "@/lib/account-api";
import { probeApiMode, readDemoFlag } from "@/lib/api-mode";
import { SessionContext, type ServerSession } from "@/lib/server-session-state";

export function ServerSessionProvider({ children }: { children: ReactNode }) {
  const demo = readDemoFlag();
  const configured = !demo;
  const [mode, setMode] = useState<ServerSession["mode"]>(demo ? "demo" : "pending");
  const [user, setUser] = useState<AccountUser | null>(null);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    probeApiMode(apiBaseUrl(), fetch, 2500, false).then(async (next) => {
      if (cancelled) return;
      if (next === "live") setUser(await readServerSession());
      if (!cancelled) setMode(next);
    });
    return () => {
      cancelled = true;
    };
  }, [demo]);

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
      await signOutServer();
      setUser(null);
    },
    createInvite: createServerInvite,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
