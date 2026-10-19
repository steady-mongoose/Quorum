import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { runAccountCreate, type AccountCreateReason } from "./closed-test/account-create.ts";
import { GENERIC_SIGNUP_ERROR } from "./closed-test/rules.ts";
import type { ClosedAuth } from "./auth.ts";
import type { CreateAccount, CreateUser, SignIn } from "./closed-test/store.ts";
import type { Db } from "./db.ts";

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
        console.error(
          JSON.stringify({
            event: "account-create-failed",
            status: response.status,
          }),
        );
        return {
          ok: false as const,
          status: response.status || 400,
          message: reason === "invite" ? GENERIC_SIGNUP_ERROR : body.message || "The account was not created.",
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

/** User and credential rows. Caller must be inside the signup transaction. */
export function createCredentialAccount(): CreateAccount {
  return async (tx: Db, input) => {
    const id = randomUUID();
    const hash = await hashPassword(input.password);
    const now = new Date();
    await tx.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $3, false, $4, $4)`,
      [id, input.name, input.email, now],
    );
    await tx.query(
      `insert into "account"
       ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
       values ($1, $2, 'credential', $2, $3, $4, $4)`,
      [randomUUID(), id, hash, now],
    );
    return { id };
  };
}

export function createSignIn(auth: ClosedAuth, baseURL: string): SignIn {
  return async (input) => {
    const headers = new Headers(input.headers);
    headers.set("content-type", "application/json");
    const response = await auth.handler(
      new Request(new URL("/api/auth/sign-in/email", baseURL), {
        method: "POST",
        headers,
        body: JSON.stringify({ email: input.email, password: input.password }),
      }),
    );
    const text = await response.text();
    if (!response.ok) {
      console.error(JSON.stringify({ event: "signup-session-failed", status: response.status }));
      return { ok: false, status: response.status || 400, message: GENERIC_SIGNUP_ERROR };
    }
    return {
      ok: true,
      user: {
        id: input.userId,
        name: input.name,
        email: input.email,
        response: copyResponse(response, text),
      },
    };
  };
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
