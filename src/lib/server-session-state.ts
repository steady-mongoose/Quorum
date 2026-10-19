import { createContext, useContext } from "react";
import {
  createServerInvite,
  signInWithPassword,
  signUpWithInvite,
  type AccountUser,
} from "@/lib/account-api";
import type { ApiMode } from "@/lib/api-mode";

export type ServerSession = {
  /** True when VITE_API_BASE_URL was set at build time. */
  configured: boolean;
  mode: "pending" | ApiMode;
  user: AccountUser | null;
  signUp: typeof signUpWithInvite;
  signIn: typeof signInWithPassword;
  signOut: () => Promise<void>;
  createInvite: typeof createServerInvite;
};

export const EMPTY_SERVER_SESSION: ServerSession = {
  configured: false,
  mode: "demo",
  user: null,
  signUp: signUpWithInvite,
  signIn: signInWithPassword,
  signOut: async () => undefined,
  createInvite: createServerInvite,
};

export const SessionContext = createContext<ServerSession>(EMPTY_SERVER_SESSION);

export function useServerSession(): ServerSession {
  return useContext(SessionContext);
}
