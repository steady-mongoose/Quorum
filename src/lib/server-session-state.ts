import { createContext, useContext } from "react";
import {
  createServerInvite,
  signInWithPassword,
  signUpWithInvite,
  type AccountUser,
} from "@/lib/account-api";
import type { MfaPhase } from "@/lib/account-result";
import type { ApiMode } from "@/lib/api-mode";

export type ServerSession = {
  /** False only when VITE_DEMO forces the browser. Same-origin /api still counts. */
  configured: boolean;
  mode: "pending" | ApiMode;
  user: AccountUser | null;
  /** challenge hides the hall until the second step. enroll is a grace period. */
  mfa: MfaPhase;
  mfaEnrolled: boolean;
  /** False while a signed-in member still owes the one-time 18+ confirmation. */
  ageConfirmed: boolean;
  confirmAge: (adult: boolean) => Promise<{ ok: boolean; message?: string }>;
  signUp: typeof signUpWithInvite;
  signIn: typeof signInWithPassword;
  finishMfa: (code: string) => Promise<{ ok: boolean; message?: string }>;
  signOut: () => Promise<void>;
  /** Run the health probe again. Used when sign-in is unavailable. */
  recheck: () => Promise<void>;
  createInvite: typeof createServerInvite;
};

export const EMPTY_SERVER_SESSION: ServerSession = {
  configured: false,
  mode: "demo",
  user: null,
  mfa: "ok",
  mfaEnrolled: false,
  ageConfirmed: true,
  confirmAge: async () => ({ ok: false, message: "Sign in first." }),
  signUp: signUpWithInvite,
  signIn: signInWithPassword,
  finishMfa: async () => ({ ok: false, message: "Sign in first." }),
  signOut: async () => undefined,
  recheck: async () => undefined,
  createInvite: createServerInvite,
};

export const SessionContext = createContext<ServerSession>(EMPTY_SERVER_SESSION);

export function useServerSession(): ServerSession {
  return useContext(SessionContext);
}
