/** A non-secret hint so the first paint can show the signed-in header. Not a session. */
export const ENTERED_COOKIE = "avouch-entered";

export function enteredCookie(member: boolean): string {
  return member
    ? `${ENTERED_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax`
    : `${ENTERED_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Remember that this browser has been inside the app. Not a session. */
export function writeEnteredCookie(member: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = enteredCookie(member);
}

export type EnteredHintInput = {
  hydrated: boolean;
  mode: "pending" | "live" | "demo";
  /** False only when this build is forced into the browser demo. */
  configured: boolean;
  user: boolean;
  localEntry: boolean;
  member: boolean;
};

/**
 * What to write once the saved board and the server have both been read.
 * `null` leaves the cookie alone: still checking, or the API is down and the
 * last hint should survive the outage. `false` clears it (`Max-Age=0`).
 */
export function enteredHintDecision(input: EnteredHintInput): boolean | null {
  if (!input.hydrated || input.mode === "pending") return null;
  // A failed health probe is not a sign-out. Keep the hint until the API answers.
  if (input.configured && input.mode === "demo") return null;
  if (input.mode === "live") return input.user || input.localEntry;
  return input.member;
}

/**
 * Whether the first paint should show the signed-in shell.
 * A real request carries the cookie into the route. The static shell is
 * prerendered once, with no cookie, and the app mounts on the client only
 * after that empty shell has hydrated, so the cookie is read there.
 */
export function sawEnteredHint(input: {
  routeHint: boolean;
  staticSpa: boolean;
  ssr: boolean;
  cookie: string | null | undefined;
}): boolean {
  if (input.routeHint) return true;
  if (input.staticSpa && !input.ssr) return cookieSaysEntered(input.cookie);
  return false;
}

/** True when the cookie header says this browser has been inside the app. */
export function cookieSaysEntered(header: string | null | undefined): boolean {
  return new RegExp(`(?:^|;\\s*)${ENTERED_COOKIE}=1(?:\\s*;|$)`).test(header ?? "");
}

/**
 * The same answer on the server (request cookie) and in the browser
 * (document.cookie), so the first paint and hydration agree.
 */
export async function readEnteredHint(): Promise<boolean> {
  if (import.meta.env.SSR) {
    const { getRequest } = await import("@tanstack/react-start/server");
    return cookieSaysEntered(getRequest()?.headers.get("cookie"));
  }
  return cookieSaysEntered(typeof document === "undefined" ? "" : document.cookie);
}
