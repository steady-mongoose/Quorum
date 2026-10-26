export type AccountUser = { id: string; name: string; email: string };

export type AccountResult =
  | { ok: true; user: AccountUser | null }
  | { ok: false; message: string; code?: string };

export function parseAccountResult(status: number, body: unknown): AccountResult {
  if (status >= 200 && status < 300) {
    const user = body && typeof body === "object" ? (body as { user?: unknown }).user : undefined;
    return { ok: true, user: parseUser(user) };
  }
  const record =
    body && typeof body === "object"
      ? (body as { error?: unknown; message?: unknown; code?: unknown })
      : {};
  const message =
    typeof record.message === "string"
      ? record.message
      : typeof record.error === "string"
        ? record.error
        : "The server did not accept that.";
  const code = typeof record.code === "string" && record.code ? record.code : undefined;
  return code ? { ok: false, message, code } : { ok: false, message };
}

export function parseSessionBody(status: number, body: unknown): AccountUser | null {
  if (status !== 200) return null;
  const user = body && typeof body === "object" ? (body as { user?: unknown }).user : undefined;
  return parseUser(user);
}

function parseUser(user: unknown): AccountUser | null {
  if (!user || typeof user !== "object") return null;
  const record = user as { id?: unknown; name?: unknown; email?: unknown };
  if (typeof record.id !== "string" || typeof record.name !== "string") return null;
  return {
    id: record.id,
    name: record.name,
    email: typeof record.email === "string" ? record.email : "",
  };
}
