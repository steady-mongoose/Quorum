import { runAccountCreate, type AccountCreateReason } from "./closed-test/account-create.ts";
import type { ClosedAuth } from "./auth.ts";
import type { CreateUser } from "./closed-test/store.ts";

function copyResponse(response: Response, body: string): Response {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers.set(key, value);
  });
  for (const cookie of response.headers.getSetCookie?.() ?? [])
    headers.append("set-cookie", cookie);
  return new Response(body, { status: response.status, headers });
}

export function createAccountFactory(
  auth: ClosedAuth,
  baseURL: string,
  reason: AccountCreateReason,
): CreateUser {
  return (input) =>
    runAccountCreate(reason, async () => {
      const headers = new Headers(input.headers);
      headers.set("content-type", "application/json");
      const response = await auth.handler(
        new Request(new URL("/api/auth/sign-up/email", baseURL), {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: input.name,
            email: input.email,
            password: input.password,
          }),
        }),
      );
      const text = await response.text();
      let body: { message?: string; user?: { id?: string; name?: string; email?: string } } = {};
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        body = {};
      }
      if (!response.ok || !body.user?.id) {
        return {
          ok: false as const,
          status: response.status || 400,
          message: body.message || "The account was not created.",
        };
      }
      return {
        ok: true as const,
        user: {
          id: body.user.id,
          name: body.user.name || input.name,
          email: body.user.email || input.email,
          response: copyResponse(response, text),
        },
      };
    });
}

export async function readSessionUser(
  auth: ClosedAuth,
  headers: Headers,
): Promise<{ id: string; name: string; email: string } | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  };
}
