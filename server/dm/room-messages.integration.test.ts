import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import {
  blockMember,
  confirmSafety,
  createLocalDevice,
  listBlockedMembers,
  memoryVault,
  openEncryptedThread,
  readEncrypted,
  registerDevice,
  sendEncrypted,
  unblockMember,
  type DmTransport,
} from "../../src/lib/e2ee/mailbox.ts";

const TEXT = "Can you bring the casserole dish back Sunday?";
const DAY = 24 * 60 * 60 * 1000;

async function roomMember(db: Db, name: string, roomId: string, joinedAt: Date): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name}-${id}@example.com`, joinedAt],
  );
  for (const room of ["", roomId]) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, 'member', $4, 'grant', 'test', 'test', 'test', 'Granted for the test.', $5)`,
      [randomUUID(), id, name, room, joinedAt],
    );
  }
  await db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, $2, $3)`, [
    id,
    roomId,
    joinedAt,
  ]);
  return id;
}

function transport(
  handler: (request: Request) => Promise<Response>,
  userId: string,
): DmTransport {
  async function call(path: string, method: string, body?: unknown) {
    const headers = new Headers({ origin: "http://localhost:8080", "x-user-id": userId });
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await handler(
      new Request(`http://127.0.0.1:8787${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  return {
    post: (path, body) => call(path, "POST", body),
    get: (path) => call(path, "GET"),
  };
}

test("two members of a church room exchange an encrypted message, and a block stops it", async () => {
  const { db, close } = await openTestDb();
  const now = new Date("2026-10-29T12:00:00Z");
  const handler = createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => now,
    createAccount: async () => {
      throw new Error("unused");
    },
    signIn: async () => {
      throw new Error("unused");
    },
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      const rows = await db.query<{ id: string; name: string; email: string }>(
        `select id, name, email from "user" where id = $1`,
        [id],
      );
      const user = rows[0];
      return user ? { id: user.id, name: user.name, email: user.email } : null;
    },
    forwardAuth: async () => new Response(null, { status: 404 }),
  });
  try {
    const ruth = await roomMember(db, "Ruth", "baptist", new Date(now.getTime() - 20 * DAY));
    const naomi = await roomMember(db, "Naomi", "baptist", new Date(now.getTime() - 20 * DAY));
    const ruthVault = memoryVault(await createLocalDevice(ruth, "Browser"));
    const naomiVault = memoryVault(await createLocalDevice(naomi, "Browser"));
    assert.equal((await registerDevice(transport(handler, ruth), ruthVault)).ok, true);
    assert.equal((await registerDevice(transport(handler, naomi), naomiVault)).ok, true);

    // They have never been checked in at the same meeting. The room is enough.
    const opened = await openEncryptedThread(transport(handler, ruth), naomi);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const first = await sendEncrypted(transport(handler, ruth), ruthVault, opened.thread.id, naomi, TEXT);
    if (!first.ok && first.safety) confirmSafety(ruthVault, naomi, first.safety);
    const sent = first.ok
      ? first
      : await sendEncrypted(transport(handler, ruth), ruthVault, opened.thread.id, naomi, TEXT);
    assert.equal(sent.ok, true);
    const read = await readEncrypted(
      transport(handler, naomi),
      naomiVault,
      opened.thread.id,
      naomi,
      "Naomi",
      "Ruth",
    );
    assert.equal(read.ok && read.messages[0]?.text, TEXT);

    // Naomi blocks Ruth. Ruth can no longer send, and is not told who blocked her.
    assert.equal((await blockMember(transport(handler, naomi), ruth)).ok, true);
    const after = await sendEncrypted(transport(handler, ruth), ruthVault, opened.thread.id, naomi, TEXT);
    assert.equal(after.ok, false);
    const naomiList = await listBlockedMembers(transport(handler, naomi));
    assert.deepEqual(naomiList.ok && naomiList.blocked.map((row) => row.name), ["Ruth"]);
    const ruthList = await listBlockedMembers(transport(handler, ruth));
    assert.deepEqual(ruthList.ok && ruthList.blocked, []);

    // Unblocking restores it.
    assert.equal((await unblockMember(transport(handler, naomi), ruth)).ok, true);
    const again = await sendEncrypted(transport(handler, ruth), ruthVault, opened.thread.id, naomi, TEXT);
    assert.equal(again.ok, true);
  } finally {
    await close();
  }
});
