import { createContext, useContext } from "react";
import {
  createServerInvite,
  signInWithPassword,
  signUpWithInvite,
  type AccountUser,
} from "@/lib/account-api";
import type { ApiMode } from "@/lib/api-mode";

export type ServerSession = {
  /** False only when VITE_DEMO forces the browser. Same-origin /api still counts. */
  configured: boolean;
  mode: "pending" | ApiMode;
  user: AccountUser | null;
  signUp: typeof signUpWithInvite;
  signIn: typeof signInWithPassword;
  signOut: () => Promise<void>;
  /** Run the health probe again. Used when sign-in is unavailable. */
  recheck: () => Promise<void>;
  createInvite: typeof createServerInvite;
};

export const EMPTY_SERVER_SESSION: ServerSession = {
  configured: false,
  mode: "demo",
  user: null,
  signUp: signUpWithInvite,
  signIn: signInWithPassword,
  signOut: async () => undefined,
  recheck: async () => undefined,
  createInvite: createServerInvite,
};

export const SessionContext = createContext<ServerSession>(EMPTY_SERVER_SESSION);

export function useServerSession(): ServerSession {
  return useContext(SessionContext);
}
