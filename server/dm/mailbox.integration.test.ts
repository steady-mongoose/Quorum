import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { DM_SEND_LIMIT, consumeLimit } from "../rate-limit.ts";
import {
  confirmSafety,
  createLocalDevice,
  listEncryptedThreads,
  memoryVault,
  openEncryptedThread,
  publishBackup,
  readEncrypted,
  registerDevice,
  restoreFromBackup,
  sendEncrypted,
  type DmTransport,
  type VaultStore,
} from "../../src/lib/e2ee/mailbox.ts";

const TEXT = "The framing night is Thursday, bring the saw.";
const PASSPHRASE = "correct horse battery";

async function member(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, name, `${name}-${id}@example.com`],
  );
  return id;
}

function transport(
  handler: (request: Request) => Promise<Response>,
  userId: string | null,
): DmTransport {
  async function call(path: string, method: string, body?: unknown) {
    const headers = new Headers({ origin: "http://localhost:8080" });
    if (userId) headers.set("x-user-id", userId);
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

test("two members, two devices, and a restored backup can read ciphertext the server cannot", async () => {
  const { db, close } = await openTestDb();
  let now = new Date("2026-10-19T12:00:00Z");
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
    const alice = await member(db, "Alice");
    const bob = await member(db, "Bob");
    const carol = await member(db, "Carol");
    const aliceVault = memoryVault(await createLocalDevice(alice, "Browser"));
    const alicePhone = memoryVault(await createLocalDevice(alice, "Phone"));
    const bobVault = memoryVault(await createLocalDevice(bob, "Browser"));
    assert.equal((await registerDevice(transport(handler, alice), aliceVault)).ok, true);
    assert.equal((await registerDevice(transport(handler, alice), alicePhone)).ok, true);
    assert.equal((await registerDevice(transport(handler, bob), bobVault)).ok, true);
    assert.equal(
      (await publishBackup(transport(handler, alice), aliceVault, PASSPHRASE, "min")).ok,
      true,
    );
    assert.equal(
      (await publishBackup(transport(handler, bob), bobVault, PASSPHRASE, "min")).ok,
      true,
    );

    const opened = await openEncryptedThread(transport(handler, alice), bob);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const blocked = await sendEncrypted(
      transport(handler, alice),
      aliceVault,
      opened.thread.id,
      bob,
      TEXT,
    );
    assert.equal(blocked.ok, false);
    if (blocked.ok || !blocked.safety) return;
    confirmSafety(aliceVault, bob, blocked.safety);
    const sent = await sendEncrypted(
      transport(handler, alice),
      aliceVault,
      opened.thread.id,
      bob,
      TEXT,
    );
    assert.equal(sent.ok, true);

    const bobRead = await readEncrypted(
      transport(handler, bob),
      bobVault,
      opened.thread.id,
      bob,
      "Bob",
      "Alice",
    );
    assert.equal(bobRead.ok, true);
    if (!bobRead.ok) return;
    assert.equal(bobRead.messages[0]?.text, TEXT);

    const phoneRead = await readEncrypted(
      transport(handler, alice),
      alicePhone,
      opened.thread.id,
      alice,
      "Alice",
      "Bob",
    );
    assert.equal(phoneRead.ok && phoneRead.messages[0]?.text, TEXT);

    const stored =
      JSON.stringify(await db.query(`select * from dm_message`)) +
      JSON.stringify(await db.query(`select * from dm_envelope`)) +
      JSON.stringify(await db.query(`select * from dm_backup`));
    assert.equal(stored.includes(TEXT), false);
    assert.equal(stored.includes(PASSPHRASE), false);

    const carolRead = await transport(handler, carol).get(
      `/api/dm/threads/${opened.thread.id}/messages`,
    );
    assert.equal(carolRead.status, 404);

    const threads = await listEncryptedThreads(transport(handler, bob));
    assert.equal(threads.ok, true);
    if (!threads.ok) return;
    assert.equal(threads.threads[0]?.otherName, "Alice");
    const listed = await transport(handler, bob).get(
      `/api/dm/threads/${opened.thread.id}/messages`,
    );
    const names = new Set<string>();
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        names.add(key);
        walk(child);
      }
    };
    walk(listed.body);
    for (const banned of ["text", "plaintext", "like", "likes", "reshare", "score", "scores"]) {
      assert.equal(names.has(banned), false);
    }

    const restored = await restoreFromBackup(
      transport(handler, bob),
      bob,
      PASSPHRASE,
      "New browser",
    );
    assert.equal(restored.ok, true);
    if (!restored.ok) return;
    const bobNext: VaultStore = memoryVault(restored.vault);
    assert.equal((await registerDevice(transport(handler, bob), bobNext)).ok, true);
    const history = await readEncrypted(
      transport(handler, bob),
      bobNext,
      opened.thread.id,
      bob,
      "Bob",
      "Alice",
    );
    assert.equal(history.ok && history.messages[0]?.text, TEXT);

    const wrong = await restoreFromBackup(
      transport(handler, bob),
      bob,
      "not the passphrase",
      "Nope",
    );
    assert.equal(wrong.ok, false);

    const plaintext = await transport(handler, alice).post(
      `/api/dm/threads/${opened.thread.id}/messages`,
      {
        text: TEXT,
      },
    );
    assert.equal(plaintext.status, 400);
    assert.match(JSON.stringify(plaintext.body), /does not accept message text/);

    for (let i = 0; i < DM_SEND_LIMIT.max; i += 1) {
      await consumeLimit(db, `dm-send:${alice}`, DM_SEND_LIMIT, now.getTime());
    }
    const limited = await sendEncrypted(
      transport(handler, alice),
      aliceVault,
      opened.thread.id,
      bob,
      "One more line.",
    );
    assert.equal(limited.ok, false);
    if (!limited.ok) assert.match(limited.message, /Too many/);

    const signedOut = await transport(handler, null).get("/api/dm/threads");
    assert.equal(signedOut.status, 401);

    now = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    const expired = await readEncrypted(
      transport(handler, bob),
      bobVault,
      opened.thread.id,
      bob,
      "Bob",
      "Alice",
    );
    assert.equal(expired.ok && expired.messages.length, 0);
  } finally {
    await close();
  }
});
