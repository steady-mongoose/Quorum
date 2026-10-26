import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import { rememberNamedAccounts } from "./store.ts";
import type { Db } from "../db.ts";
import { DM_SEND_LIMIT, consumeLimit } from "../rate-limit.ts";
import {
  confirmSafety,
  createLocalDevice,
  createSiblingDevice,
  recordAttendance,
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
const PASSPHRASE = "correct horse battery staple";

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
    const aliceState = await createLocalDevice(alice, "Browser");
    const aliceVault = memoryVault(aliceState);
    const alicePhone = memoryVault(await createSiblingDevice(aliceState, "Phone"));
    const bobVault = memoryVault(await createLocalDevice(bob, "Browser"));
    assert.equal((await registerDevice(transport(handler, alice), aliceVault)).ok, true);
    assert.equal((await registerDevice(transport(handler, alice), alicePhone)).ok, true);
    assert.equal((await registerDevice(transport(handler, bob), bobVault)).ok, true);
    assert.equal((await publishBackup(transport(handler, alice), aliceVault, PASSPHRASE)).ok, true);
    assert.equal((await publishBackup(transport(handler, bob), bobVault, PASSPHRASE)).ok, true);
    const postId = randomUUID();
    await db.query(
      `insert into board_post (
         id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at
       ) values ($1, 'shop', $2, 'Alice', 'hosted', 'The framing night went well and the next one is set.', $3, 's-framing', now())`,
      [postId, alice, ["Alice", "Bob"]],
    );
    await rememberNamedAccounts(db, postId);
    assert.equal((await recordAttendance(transport(handler, alice), ["s-framing"])).ok, true);
    assert.equal((await recordAttendance(transport(handler, bob), ["s-framing"])).ok, true);

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

    const changed = await sendEncrypted(
      transport(handler, alice),
      aliceVault,
      opened.thread.id,
      bob,
      "The new browser needs a fresh check.",
    );
    assert.equal(changed.ok, false);
    if (!changed.ok && changed.safety) confirmSafety(aliceVault, bob, changed.safety);

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
    const left = await db.query(`select id from dm_message`);
    assert.equal(left.length, 0);
  } finally {
    await close();
  }
});

test("a site ban, including an expired CSAM ban, blocks every private-message route", async () => {
  const { db, close } = await openTestDb();
  const now = new Date("2026-10-19T12:00:00Z");
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
    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, created_at)
       values ($1, $2, 'Alice', 'csam', 'Tom', 1, $3, $4)`,
      [randomUUID(), alice, new Date(now.getTime() - 24 * 60 * 60 * 1000), now],
    );
    const calls = [
      () => transport(handler, alice).get("/api/dm/devices"),
      () => transport(handler, alice).post("/api/dm/devices", {}),
      () => transport(handler, alice).get("/api/dm/keys?userId=" + bob),
      () => transport(handler, alice).post("/api/dm/bundles", { userId: bob }),
      () => transport(handler, alice).post("/api/dm/attendance", { meetingIds: ["s-framing"] }),
      () => transport(handler, alice).get("/api/dm/peers"),
      () => transport(handler, alice).get("/api/dm/threads"),
      () => transport(handler, alice).post("/api/dm/threads", { userId: bob }),
      () => transport(handler, alice).post("/api/dm/threads/" + randomUUID() + "/messages", {}),
      () => transport(handler, alice).get("/api/dm/backup"),
    ];
    for (const call of calls) {
      const response = await call();
      assert.equal(response.status, 403);
      assert.equal((response.body as { error?: string }).error, "banned");
      assert.equal((response.body as { ban?: { reason?: string } }).ban?.reason, "csam");
    }
    const rows = await db.query(`select meeting_id from dm_attendance where user_id = $1`, [alice]);
    assert.equal(rows.length, 0);
  } finally {
    await close();
  }
});

test("posting came with someone else's meeting card does not make them a peer", async () => {
  const { db, close } = await openTestDb();
  const now = new Date("2026-10-19T12:00:00Z");
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
    const victim = await member(db, "Victim");
    const friend = await member(db, "Friend");
    const mallory = await member(db, "Mallory");
    for (const [id, name] of [
      [victim, "Victim"],
      [friend, "Friend"],
      [mallory, "Mallory"],
    ] as const) {
      await db.query(
        `insert into access_log
         (id, user_id, name, role, action, vouched_by, approved_by, by_actor, note)
         values ($1, $2, $3, 'member', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
        [randomUUID(), id, name],
      );
    }
    const cardId = "s-victim-night";
    const filed = await transport(handler, victim).post("/api/rooms/shop/posts", {
      type: "hosted",
      claim: "The framing night went well and the next one is set.",
      on: "2026-10-19",
      came: ["Victim", "Friend"],
      cardId,
      attested: true,
    });
    assert.equal(filed.status, 201);
    assert.equal((await recordAttendance(transport(handler, victim), [cardId])).ok, true);
    assert.equal((await recordAttendance(transport(handler, friend), [cardId])).ok, true);
    const together = await transport(handler, victim).get("/api/dm/peers");
    const peerIds = (
      (together.body as { peers?: { id: string }[] }).peers ?? []
    ).map((peer) => peer.id);
    assert.equal(peerIds.includes(friend), true);
    assert.equal(peerIds.includes(mallory), false);

    const attack = await transport(handler, mallory).post("/api/rooms/shop/posts", {
      type: "hosted",
      came: ["Victim"],
      cardId,
      attested: true,
      claim: "The framing night went well and the next one is set.",
      on: "2026-10-19",
    });
    assert.equal(attack.status, 409);
    assert.match(JSON.stringify(attack.body), /already belongs to someone else/);

    assert.equal((await recordAttendance(transport(handler, mallory), [cardId])).ok, true);
    const leaked = await transport(handler, mallory).get("/api/dm/peers");
    const leakedIds = ((leaked.body as { peers?: { id: string; name: string }[] }).peers ?? []).map(
      (peer) => peer.id,
    );
    assert.equal(leakedIds.includes(victim), false);
    assert.equal(leakedIds.includes(friend), false);
    const opened = await openEncryptedThread(transport(handler, mallory), victim);
    assert.equal(opened.ok, false);
  } finally {
    await close();
  }
});

test("a deleted member's message stays readable, and a second read does not reuse a key", async () => {
  const { db, close } = await openTestDb();
  const now = new Date("2026-10-19T12:00:00Z");
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
    const aliceVault = memoryVault(await createLocalDevice(alice, "Browser"));
    const bobVault = memoryVault(await createLocalDevice(bob, "Browser"));
    assert.equal((await registerDevice(transport(handler, alice), aliceVault)).ok, true);
    assert.equal((await registerDevice(transport(handler, bob), bobVault)).ok, true);
    const postId = randomUUID();
    await db.query(
      `insert into board_post (
         id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at
       ) values ($1, 'shop', $2, 'Alice', 'hosted', 'The framing night went well and the next one is set.', $3, 's-framing', now())`,
      [postId, alice, ["Alice", "Bob"]],
    );
    await rememberNamedAccounts(db, postId);
    assert.equal((await recordAttendance(transport(handler, alice), ["s-framing"])).ok, true);
    assert.equal((await recordAttendance(transport(handler, bob), ["s-framing"])).ok, true);
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
    const bobBlocked = await sendEncrypted(
      transport(handler, bob),
      bobVault,
      opened.thread.id,
      alice,
      "Noted.",
    );
    assert.equal(bobBlocked.ok, false);
    if (bobBlocked.ok || !bobBlocked.safety) return;
    confirmSafety(bobVault, alice, bobBlocked.safety);
    const sent = await sendEncrypted(
      transport(handler, alice),
      aliceVault,
      opened.thread.id,
      bob,
      TEXT,
    );
    assert.equal(sent.ok, true);

    const first = await readEncrypted(
      transport(handler, bob),
      bobVault,
      opened.thread.id,
      bob,
      "Bob",
      "Alice",
      alice,
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.messages[0]?.text, TEXT);
    assert.equal(first.warnings.includes("A one-time key was reused."), false);

    const second = await readEncrypted(
      transport(handler, bob),
      bobVault,
      opened.thread.id,
      bob,
      "Bob",
      "Alice",
      alice,
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.messages[0]?.text, TEXT);
    assert.equal(second.warnings.includes("A one-time key was reused."), false);
    assert.equal(second.unreadable, 0);

    const identity = aliceVault.read()?.device.identityPublic ?? "";
    assert.equal(identity.length > 0, true);
    await db.query(`delete from "user" where id = $1`, [alice]);
    const deviceId = aliceVault.read()?.device.deviceId ?? "";
    const devices = await db.query(`select id from dm_device where id = $1`, [deviceId]);
    assert.equal(devices.length, 0);
    const envelopes = await db.query(
      `select id from dm_envelope where recipient_device_id = $1`,
      [deviceId],
    );
    assert.equal(envelopes.length, 0);

    const after = await readEncrypted(
      transport(handler, bob),
      bobVault,
      opened.thread.id,
      bob,
      "Bob",
      "Former member",
    );
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.messages.some((message) => message.text === TEXT), true);
    assert.equal(
      after.messages.find((message) => message.text === TEXT)?.from,
      "Former member",
    );
    const served = await transport(handler, bob).get(
      `/api/dm/threads/${opened.thread.id}/messages`,
    );
    assert.equal(JSON.stringify(served.body).includes(identity), false);

    const broken = bobVault.read();
    const pin = broken?.pins.find((item) => item.userId === alice);
    if (pin) pin.identityPublic = "not-the-saved-identity";
    if (broken) bobVault.write(broken);
    const refused = await readEncrypted(
      transport(handler, bob),
      bobVault,
      opened.thread.id,
      bob,
      "Bob",
      "Former member",
    );
    assert.equal(refused.ok, true);
    if (!refused.ok) return;
    assert.equal(refused.messages.some((message) => message.text === TEXT), false);
    assert.equal(refused.unreadable > 0, true);
  } finally {
    await close();
  }
});
