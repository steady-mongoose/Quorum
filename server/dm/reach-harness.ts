import { randomUUID } from "node:crypto";
import { createApp } from "../http.ts";
import type { Db } from "../db.ts";

/** Real HTTP through createApp, for the DM reach tests. x-user-id signs the call in. */

export const DAY = 24 * 60 * 60 * 1000;

export async function member(db: Db, name: string, joined: Date): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`, joined],
  );
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'For the test.', $4)`,
    [randomUUID(), id, name, joined],
  );
  return id;
}

export function inRoom(db: Db, userId: string, roomId: string, at: Date) {
  return db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, $2, $3)`, [
    userId,
    roomId,
    at,
  ]);
}

export function testApp(db: Db, now: () => Date) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now,
    createAccount: async () => {
      throw new Error("unused");
    },
    signIn: async () => {
      throw new Error("unused");
    },
    readSession: async (headers) => {
      const rows = await db.query<{ id: string; name: string; email: string }>(
        `select id, name, email from "user" where id = $1`,
        [headers.get("x-user-id")],
      );
      return rows[0] ?? null;
    },
    forwardAuth: async () => new Response(null, { status: 404 }),
  });
}

export type Answer = {
  status: number;
  body: unknown;
  type: string | null;
  cache: string | null;
};

export async function call(
  handler: ReturnType<typeof createApp>,
  userId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Answer> {
  const headers = new Headers({ origin: "http://localhost:8080", "x-user-id": userId });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await handler(
    new Request(`http://127.0.0.1:8787${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    body: await response.json().catch(() => null),
    type: response.headers.get("content-type"),
    cache: response.headers.get("cache-control"),
  };
}
