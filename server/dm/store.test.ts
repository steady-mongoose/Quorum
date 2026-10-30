import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Db } from "../db.ts";
import { createPost } from "../board/test-posting.ts";
import { openRollCallDb } from "../closed-test/roll-call-db.ts";
import { DM_MAX_DEVICES } from "../../src/lib/e2ee/limits.ts";
import {
  createBackupKey,
  createDevice,
  createIdentity,
  encryptBackupSecret,
  sealMessage,
  type DeviceRecord,
  type SealDestination,
} from "../../src/lib/e2ee/protocol.ts";
import {
  claimBundle,
  listMessages,
  listPeers,
  listThreads,
  openThread,
  postMessage,
  rememberNamedAccounts,
  putBackup,
  recordAttendance,
  registerDevice,
  revokeDevice,
  sweepExpired,
  type DeviceRegistration,
} from "./store.ts";

const TEXT = "The framing night is Thursday, bring the saw.";

async function member(db: Db, name: string, granted = true): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, name, `${name}-${id}@example.com`],
  );
  // A live board membership: messaging needs one on both sides, as rooms do.
  if (granted)
    await db.query(
      `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', now() - interval '30 days')`,
      [randomUUID(), id, name],
    );
  return id;
}

function registration(device: DeviceRecord): DeviceRegistration {
  return {
    deviceId: device.deviceId,
    label: device.label,
    signPublic: device.signPublic,
    boxPublic: device.boxPublic,
    statementSig: device.statementSig,
    identityPublic: device.identityPublic,
    identitySig: device.identitySig,
    signedPrekey: {
      id: device.signedPrekey.id,
      publicKey: device.signedPrekey.publicKey,
      signature: device.signedPrekey.signature,
    },
    prekeys: device.prekeys.map((prekey) => ({
      id: prekey.id,
      publicKey: prekey.publicKey,
      signature: prekey.signature,
    })),
  };
}

function destination(userId: string, device: DeviceRecord): SealDestination {
  const prekey = device.prekeys[0];
  return {
    kind: "device",
    userId,
    identityPublic: device.identityPublic,
    device: {
      deviceId: device.deviceId,
      signPublic: device.signPublic,
      boxPublic: device.boxPublic,
      statementSig: device.statementSig,
      identitySig: device.identitySig,
    },
    prekey: prekey
      ? { id: prekey.id, publicKey: prekey.publicKey, signature: prekey.signature }
      : null,
    signedPrekey: {
      id: device.signedPrekey.id,
      publicKey: device.signedPrekey.publicKey,
      signature: device.signedPrekey.signature,
    },
  };
}

async function meet(db: Db, userIds: string[]): Promise<void> {
  const people = await db.query<{ id: string; name: string }>(
    `select id, name from "user" where id in (${userIds.map((_, index) => `$${index + 1}`).join(", ")})`,
    userIds,
  );
  const author = people.find((person) => person.id === userIds[0]);
  assert.ok(author);
  const postId = randomUUID();
  await db.query(
    `insert into board_post (
       id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at
     ) values ($1, 'shop', $2, $3, 'hosted', 'The framing night went well and the next one is set.', $4, 's-framing', now())`,
    [postId, author.id, author.name, people.map((person) => person.name)],
  );
  await rememberNamedAccounts(db, postId);
  for (const userId of userIds) {
    const saved = await recordAttendance(db, userId, new Date("2026-10-19T12:00:00Z"), [
      "s-framing",
    ]);
    assert.equal(saved.ok, true);
  }
}

test("a bad device signature is refused and eight devices is the cap", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const alice = await member(db, "Alice");
    const device = await createDevice({ userId: alice, prekeyCount: 1 });
    const bad = {
      ...registration(device),
      statementSig: registration(device).prekeys[0].signature,
    };
    const refused = await registerDevice(db, alice, bad);
    assert.equal(refused.ok, false);

    const identity = await createIdentity();
    const first = await createDevice({
      userId: alice,
      prekeyCount: 1,
      label: "Browser 0",
      identity,
    });
    assert.equal((await registerDevice(db, alice, registration(first))).ok, true);
    const otherIdentity = await createDevice({ userId: alice, prekeyCount: 1 });
    const replaced = await registerDevice(db, alice, registration(otherIdentity));
    assert.equal(replaced.ok, false);
    if (!replaced.ok) assert.match(replaced.error, /identity key/);
    for (let i = 1; i < DM_MAX_DEVICES; i += 1) {
      const next = await createDevice({
        userId: alice,
        prekeyCount: 1,
        label: `Browser ${i}`,
        identity,
      });
      const saved = await registerDevice(db, alice, registration(next));
      assert.equal(saved.ok, true);
    }
    const extra = await createDevice({ userId: alice, prekeyCount: 1 });
    const capped = await registerDevice(db, alice, registration(extra));
    assert.equal(capped.ok, false);
    if (capped.ok) return;
    assert.match(capped.error, /8 devices/);
  } finally {
    await close();
  }
});

test("the backup row stores ciphertext, not the passphrase or the private key", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const alice = await member(db, "Alice");
    const backup = await createBackupKey();
    const identity = await createIdentity();
    const passphrase = "correct horse battery staple";
    const cipher = await encryptBackupSecret(
      { boxSecret: backup.boxSecret, identitySecret: identity.signSecret },
      passphrase,
    );
    assert.equal(cipher.ok, true);
    if (!cipher.ok) return;
    const saved = await putBackup(
      db,
      alice,
      backup.boxPublic,
      cipher.value,
      new Date("2026-10-19T12:00:00Z"),
    );
    assert.equal(saved.ok, true);
    const rows = await db.query<Record<string, unknown>>(
      `select * from dm_backup where user_id = $1`,
      [alice],
    );
    const blob = JSON.stringify(rows);
    assert.equal(blob.includes(passphrase), false);
    assert.equal(blob.includes(backup.boxSecret), false);
    assert.equal(rows[0]?.kdf, "argon2id");
  } finally {
    await close();
  }
});

test("a thread is one pair, the text is not stored, and a third member cannot read it", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const now = new Date("2026-10-19T12:00:00Z");
    const alice = await member(db, "Alice");
    const bob = await member(db, "Bob");
    const carol = await member(db, "Carol");
    await meet(db, [alice, bob]);
    const self = await openThread(db, alice, alice, now);
    assert.equal(self.ok, false);

    const opened = await openThread(db, alice, bob, now);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const again = await openThread(db, bob, alice, now);
    assert.equal(again.ok && again.value.id, opened.value.id);

    const aliceDevice = await createDevice({ userId: alice, prekeyCount: 1 });
    const bobDevice = await createDevice({ userId: bob, prekeyCount: 1 });
    assert.equal((await registerDevice(db, alice, registration(aliceDevice))).ok, true);
    assert.equal((await registerDevice(db, bob, registration(bobDevice))).ok, true);
    const claimed = await claimBundle(db, alice, bob, now);
    assert.equal(claimed.ok, true);
    if (!claimed.ok) return;
    const sealed = await sealMessage({
      messageId: crypto.randomUUID(),
      threadId: opened.value.id,
      sender: aliceDevice,
      text: TEXT,
      destinations: [destination(bob, bobDevice)],
    });
    assert.equal(sealed.ok, true);
    if (!sealed.ok) return;
    const posted = await postMessage(db, alice, opened.value.id, sealed.value, now);
    assert.equal(posted.ok, true);

    const tables = [
      "dm_device",
      "dm_prekey",
      "dm_backup",
      "dm_thread",
      "dm_message",
      "dm_envelope",
    ];
    let blob = "";
    for (const table of tables) {
      blob += JSON.stringify(await db.query(`select * from ${table}`));
    }
    assert.equal(blob.includes(TEXT), false);

    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name like 'dm_%'`,
    );
    for (const column of columns) {
      assert.equal(/plain|like|reshare|score/i.test(column.column_name), false);
    }

    const carolRead = await listMessages(db, carol, opened.value.id, now);
    assert.equal(carolRead.ok, false);
    const bobRead = await listMessages(db, bob, opened.value.id, now);
    assert.equal(bobRead.ok, true);
    if (!bobRead.ok) return;
    assert.equal(bobRead.value.length, 1);
    assert.equal(JSON.stringify(bobRead.value).includes(TEXT), false);

    const laterDate = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    const later = await listMessages(db, bob, opened.value.id, laterDate);
    assert.equal(later.ok, true);
    if (!later.ok) return;
    assert.equal(later.value.length, 0);
    const hidden = await db.query(`select id from dm_message`);
    assert.equal(hidden.length, 1);
    await sweepExpired(db, laterDate);
    const left = await db.query(`select id from dm_message`);
    assert.equal(left.length, 0);
  } finally {
    await close();
  }
});

test("an envelope aimed outside the pair is refused, and a revoked device cannot send", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const now = new Date("2026-10-19T12:00:00Z");
    const alice = await member(db, "Alice");
    const bob = await member(db, "Bob");
    const carol = await member(db, "Carol");
    await meet(db, [alice, bob]);
    const stranger = await openThread(db, alice, carol, now);
    assert.equal(stranger.ok, false);
    const opened = await openThread(db, alice, bob, now);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const aliceDevice = await createDevice({ userId: alice, prekeyCount: 1 });
    const bobDevice = await createDevice({ userId: bob, prekeyCount: 1 });
    const carolDevice = await createDevice({ userId: carol, prekeyCount: 1 });
    assert.equal((await registerDevice(db, alice, registration(aliceDevice))).ok, true);
    assert.equal((await registerDevice(db, bob, registration(bobDevice))).ok, true);
    assert.equal((await registerDevice(db, carol, registration(carolDevice))).ok, true);
    const sealed = await sealMessage({
      messageId: crypto.randomUUID(),
      threadId: opened.value.id,
      sender: aliceDevice,
      text: TEXT,
      destinations: [destination(bob, bobDevice), destination(carol, carolDevice)],
    });
    assert.equal(sealed.ok, true);
    if (!sealed.ok) return;
    const leaked = await postMessage(db, alice, opened.value.id, sealed.value, now);
    assert.equal(leaked.ok, false);

    const direct = await sealMessage({
      messageId: crypto.randomUUID(),
      threadId: opened.value.id,
      sender: aliceDevice,
      text: TEXT,
      destinations: [destination(bob, bobDevice)],
    });
    assert.equal(direct.ok, true);
    if (!direct.ok) return;
    await revokeDevice(db, alice, aliceDevice.deviceId, now);
    const leftPrekeys = await db.query(`select id from dm_prekey where device_id = $1`, [
      aliceDevice.deviceId,
    ]);
    assert.equal(leftPrekeys.length, 0);
    const revoked = await postMessage(db, alice, opened.value.id, direct.value, now);
    assert.equal(revoked.ok, false);
  } finally {
    await close();
  }
});

test("each one-time prekey is handed out once", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const now = new Date("2026-10-19T12:00:00Z");
    const alice = await member(db, "Alice");
    const device = await createDevice({ userId: alice, prekeyCount: 1 });
    assert.equal((await registerDevice(db, alice, registration(device))).ok, true);
    const first = await claimBundle(db, alice, alice, now);
    const second = await claimBundle(db, alice, alice, now);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.value.devices[0]?.prekey?.id, device.prekeys[0]?.id);
    assert.equal(second.value.devices[0]?.prekey, null);
  } finally {
    await close();
  }
});

test("a claimed meeting id is not attendance, and peers do not reveal who went", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const now = new Date("2026-10-19T12:00:00Z");
    const alice = await member(db, "Alice");
    const bob = await member(db, "Bob");
    const carol = await member(db, "Carol");
    const dave = await member(db, "Dave");
    await db.query(
      `insert into dm_attendance (user_id, meeting_id, recorded_at) values ($1, 's-framing', $2)`,
      [carol, now],
    );
    assert.deepEqual(await listPeers(db, carol), []);
    assert.equal((await recordAttendance(db, carol, now)).ok, true);
    const invented = await db.query(`select meeting_id from dm_attendance where user_id = $1`, [carol]);
    assert.equal(invented.length, 0);
    assert.equal((await openThread(db, carol, alice, now)).ok, false);

    await meet(db, [alice, bob]);
    const hamId = randomUUID();
    await db.query(
      `insert into board_post (
         id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at
       ) values ($1, 'shop', $2, 'Bob', 'hosted', 'The radio night went well and the next one is set.', $3, 's-ham', now())`,
      [hamId, bob, ["Bob", "Dave"]],
    );
    await rememberNamedAccounts(db, hamId);
    const peers = await listPeers(db, alice);
    assert.deepEqual(
      peers.map((peer) => peer.name),
      ["Bob"],
    );
    assert.deepEqual(Object.keys(peers[0] ?? {}).sort(), ["id", "name"]);
    assert.equal(
      (await listPeers(db, alice)).some((peer) => peer.id === dave),
      false,
    );
    assert.equal((await listPeers(db, dave)).some((peer) => peer.id === alice), false);
    assert.equal((await listPeers(db, bob)).some((peer) => peer.id === dave), false);
    assert.equal((await recordAttendance(db, dave, now, ["s-ham"])).ok, true);
    assert.equal((await listPeers(db, bob)).some((peer) => peer.id === dave), true);
    assert.equal((await listPeers(db, alice)).some((peer) => peer.id === dave), false);

    const laterBob = await member(db, "Bob");
    assert.equal((await listPeers(db, alice)).some((peer) => peer.id === bob), true);
    assert.equal((await listPeers(db, alice)).some((peer) => peer.id === laterBob), false);
  } finally {
    await close();
  }
});

test("a signed prekey older than 30 days is not offered for a new message", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const now = new Date("2026-10-19T12:00:00Z");
    const alice = await member(db, "Alice");
    const device = await createDevice({ userId: alice, prekeyCount: 1 });
    assert.equal((await registerDevice(db, alice, registration(device))).ok, true);
    const fresh = await claimBundle(db, alice, alice, now);
    assert.equal(fresh.ok, true);
    if (!fresh.ok) return;
    assert.equal(fresh.value.devices[0]?.signedPrekey?.id, device.signedPrekey.id);
    await db.query(`update dm_device set signed_prekey_rotated_at = $2 where id = $1`, [
      device.deviceId,
      new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
    ]);
    const stale = await claimBundle(db, alice, alice, now);
    assert.equal(stale.ok, true);
    if (!stale.ok) return;
    assert.equal(stale.value.devices[0]?.signedPrekey, null);
  } finally {
    await close();
  }
});

test("deleting a member keeps the other person's thread and shows Former member", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const sql = readFileSync(new URL("../../migrations/0006_dm_e2ee.sql", import.meta.url), "utf8");
    assert.match(sql, /create or replace function anonymize_dm_user/);
    assert.match(sql, /create trigger anonymize_dm_user/);
    assert.match(sql, /Former member/);
    assert.match(sql, /sender_identity_public = null/);
    assert.match(sql, /sender_device_id = null/);
    assert.match(sql, /delete from dm_prekey/);
    assert.match(sql, /delete from dm_envelope/);
    assert.match(sql, /delete from dm_device/);
    assert.match(sql, /rateLimit/);
    assert.equal(/create or replace function anonymize_board_user/.test(sql), false);

    const now = new Date("2026-10-19T12:00:00Z");
    const alice = await member(db, "Alice");
    const bob = await member(db, "Bob");
    await meet(db, [alice, bob]);
    const opened = await openThread(db, alice, bob, now);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const aliceDevice = await createDevice({ userId: alice, prekeyCount: 1 });
    const bobDevice = await createDevice({ userId: bob, prekeyCount: 1 });
    assert.equal((await registerDevice(db, alice, registration(aliceDevice))).ok, true);
    assert.equal((await registerDevice(db, bob, registration(bobDevice))).ok, true);
    const sealed = await sealMessage({
      messageId: crypto.randomUUID(),
      threadId: opened.value.id,
      sender: aliceDevice,
      text: TEXT,
      destinations: [destination(bob, bobDevice), destination(alice, aliceDevice)],
    });
    assert.equal(sealed.ok, true);
    if (!sealed.ok) return;
    assert.equal((await postMessage(db, alice, opened.value.id, sealed.value, now)).ok, true);
    await db.query(
      `insert into "rateLimit" ("id", "key", "count", "lastRequest") values
       ($1, $2, 1, 1), ($3, $4, 1, 1), ($5, $6, 1, 1), ($7, $8, 1, 1)`,
      [
        randomUUID(),
        `dm-send:${alice}`,
        randomUUID(),
        `dm-bundle:${bob}:${alice}`,
        randomUUID(),
        `dm-send:${bob}`,
        randomUUID(),
        "signup:ip:203.0.113.5",
      ],
    );

    await db.query(`delete from "user" where id = $1`, [alice]);
    const limitKeys = (
      await db.query<{ key: string }>(`select "key" from "rateLimit" order by "key"`)
    ).map((row) => row.key);
    assert.equal(limitKeys.some((key) => key.includes(alice)), false);
    assert.deepEqual(limitKeys, [`dm-send:${bob}`, "signup:ip:203.0.113.5"]);
    const threads = await listThreads(db, bob);
    assert.equal(threads.length, 1);
    assert.equal(threads[0]?.otherName, "Former member");
    const kept = await db.query<{
      body_ciphertext: string;
      sender_device_id: string | null;
      sender_identity_public: string | null;
      sender_user_id: string | null;
    }>(
      `select body_ciphertext, sender_device_id, sender_identity_public, sender_user_id
       from dm_message where thread_id = $1`,
      [opened.value.id],
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.body_ciphertext, sealed.value.bodyCiphertext);
    assert.equal(kept[0]?.sender_device_id, null);
    assert.equal(kept[0]?.sender_identity_public, null);
    assert.equal(kept[0]?.sender_user_id, null);
    const device = await db.query(`select id from dm_device where id = $1`, [aliceDevice.deviceId]);
    assert.equal(device.length, 0);
    const prekeys = await db.query(`select id from dm_prekey where device_id = $1`, [
      aliceDevice.deviceId,
    ]);
    assert.equal(prekeys.length, 0);
    const toAlice = await db.query(
      `select id from dm_envelope where recipient_device_id = $1`,
      [aliceDevice.deviceId],
    );
    assert.equal(toAlice.length, 0);
    const toBob = await db.query(`select id from dm_envelope where recipient_device_id = $1`, [
      bobDevice.deviceId,
    ]);
    assert.equal(toBob.length, 1);
    const listed = await listMessages(db, bob, opened.value.id, now);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.value.length, 1);
    assert.equal(listed.value[0]?.former, true);
    assert.equal(listed.value[0]?.sender, null);
    assert.equal(listed.value[0]?.senderUserId, "");
    assert.equal(listed.value[0]?.senderIdentityPublic, "");
    assert.equal(listed.value[0]?.bodyCiphertext, sealed.value.bodyCiphertext);
    const served = JSON.stringify(listed.value);
    assert.equal(served.includes(aliceDevice.identityPublic), false);
    assert.equal(served.includes(aliceDevice.signPublic), false);
    assert.equal(served.includes(aliceDevice.boxPublic), false);
    const gone = await db.query(`select id from "user" where id = $1`, [alice]);
    assert.equal(gone.length, 0);
  } finally {
    await close();
  }
});

test("a reused card does not leak attendees, and a came list is not attendance", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const now = new Date("2026-10-19T12:00:00Z");
    const victim = await member(db, "Victim");
    const friend = await member(db, "Friend");
    const mallory = await member(db, "Mallory");
    const pat = await member(db, "Pat");
    const ned = await member(db, "Ned");
    const willa = await member(db, "Willa");
    for (const [id, name] of [
      [victim, "Victim"],
      [friend, "Friend"],
      [mallory, "Mallory"],
      [pat, "Pat"],
      [ned, "Ned"],
      [willa, "Willa"],
    ] as const) {
      await db.query(
        `insert into access_log
         (id, user_id, name, role, action, vouched_by, approved_by, by_actor, note)
         values ($1, $2, $3, 'member', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
        [randomUUID(), id, name],
      );
    }
    const hosted = {
      type: "hosted",
      claim: "The framing night went well and the next one is set.",
      on: "2026-10-19",
      attested: true,
    };
    const filed = await createPost(db, {
      userId: victim,
      name: "Victim",
      roomId: "shop",
      body: { ...hosted, came: ["Victim", "Friend"], cardId: "s-victim-night" },
      now,
    });
    assert.equal(filed.ok, true);
    const weekly = await createPost(db, {
      userId: victim,
      name: "Victim",
      roomId: "shop",
      body: { ...hosted, came: ["Victim", "Friend"], cardId: "s-victim-night" },
      now: new Date(now.getTime() + 60_000),
    });
    assert.equal(weekly.ok, true);

    const own = await createPost(db, {
      userId: mallory,
      name: "Mallory",
      roomId: "shop",
      body: { ...hosted, came: ["Victim"], cardId: "s-mallory-night" },
      now,
    });
    assert.equal(own.ok, true);
    assert.deepEqual(await listPeers(db, mallory), []);
    assert.equal(
      (await recordAttendance(db, mallory, now, ["s-mallory-night", "s-victim-night"])).ok,
      true,
    );
    assert.equal(
      (await listPeers(db, mallory)).some((peer) => peer.id === victim || peer.id === friend),
      false,
    );

    const reused = await createPost(db, {
      userId: mallory,
      name: "Mallory",
      roomId: "shop",
      body: { ...hosted, came: ["Victim"], cardId: "s-victim-night" },
      now,
    });
    assert.equal(reused.ok, false);
    if (reused.ok) return;
    assert.equal(reused.status, 409);

    await db.query(
      `insert into board_post (
         id, room_id, author_user_id, author_name, type, claim, came, card_id, on_date, created_at
       ) values ($1, 'shop', $2, 'Mallory', 'hosted', $3, $4, 's-victim-night', '2026-10-19', $5)`,
      [
        randomUUID(),
        mallory,
        hosted.claim,
        ["Victim"],
        new Date(now.getTime() + 120_000),
      ],
    );
    assert.equal((await recordAttendance(db, victim, now, ["s-victim-night"])).ok, true);
    assert.equal((await recordAttendance(db, friend, now, ["s-victim-night"])).ok, true);
    assert.equal((await recordAttendance(db, mallory, now, ["s-victim-night"])).ok, true);
    assert.equal((await recordAttendance(db, pat, now, ["s-victim-night", "s-mallory-night"])).ok, true);
    const victimPeers = (await listPeers(db, victim)).map((peer) => peer.id);
    assert.equal(victimPeers.includes(friend), true);
    assert.equal(victimPeers.includes(mallory), false);
    assert.equal(victimPeers.includes(pat), false);
    const malloryPeers = (await listPeers(db, mallory)).map((peer) => peer.id);
    assert.equal(malloryPeers.includes(victim), false);
    assert.equal(malloryPeers.includes(friend), false);
    assert.equal((await openThread(db, mallory, victim, now)).ok, false);
    assert.equal((await listPeers(db, friend)).some((peer) => peer.id === mallory), false);
    assert.deepEqual(await listPeers(db, pat), []);

    assert.equal((await recordAttendance(db, victim, now, ["s-victim-night", "s-mallory-night"])).ok, true);
    assert.equal((await listPeers(db, mallory)).some((peer) => peer.id === victim), true);
    assert.equal((await listPeers(db, mallory)).some((peer) => peer.id === friend), false);
    assert.equal((await listPeers(db, friend)).some((peer) => peer.id === mallory), false);

    const bareId = randomUUID();
    await db.query(
      `insert into board_post (
         id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at
       ) values ($1, 'shop', $2, 'Ned', 'hosted', $3, $4, '', $5)`,
      [bareId, ned, hosted.claim, ["Willa"], now],
    );
    await db.query(
      `insert into board_post (
         id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at
       ) values ($1, 'dispatch', $2, 'Ned', 'hosted', $3, $4, 's-road', $5)`,
      [randomUUID(), ned, hosted.claim, ["Willa"], now],
    );
    assert.equal((await recordAttendance(db, ned, now, [bareId, "s-road"])).ok, true);
    assert.equal((await recordAttendance(db, willa, now, [bareId, "s-road"])).ok, true);
    assert.deepEqual(await listPeers(db, ned), []);
    assert.deepEqual(await listPeers(db, willa), []);

    const did = await createPost(db, {
      userId: friend,
      name: "Friend",
      roomId: "shop",
      body: {
        type: "did",
        claim: "Framed a header at the shop night.",
        reason: "Victim checked it.",
        on: "2026-10-19",
        cardId: "s-victim-night",
      },
      now,
    });
    assert.equal(did.ok, true);
    const asked = await createPost(db, {
      userId: mallory,
      name: "Mallory",
      roomId: "shop",
      body: {
        type: "asked",
        claim: "Is the new night still on Thursday?",
        reason: "The card does not say.",
        cardId: "s-fresh-card",
      },
      now,
    });
    assert.equal(asked.ok, true);
    const hostedAfter = await createPost(db, {
      userId: victim,
      name: "Victim",
      roomId: "shop",
      body: { ...hosted, came: ["Victim"], cardId: "s-fresh-card" },
      now,
    });
    assert.equal(hostedAfter.ok, true);
  } finally {
    await close();
  }
});

test("a listed name is the account that existed when the host posted", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const now = new Date("2026-10-19T12:00:00Z");
    const host = await member(db, "Host");
    const willa = await member(db, "Willa");
    const mallory = await member(db, "Mallory");
    for (const [id, name] of [
      [host, "Host"],
      [willa, "Willa"],
      [mallory, "Mallory"],
    ] as const) {
      await db.query(
        `insert into access_log
         (id, user_id, name, role, action, vouched_by, approved_by, by_actor, note)
         values ($1, $2, $3, 'member', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
        [randomUUID(), id, name],
      );
    }
    const posted = await createPost(db, {
      userId: host,
      name: "Host",
      roomId: "shop",
      body: {
        type: "hosted",
        claim: "The framing night went well and the next one is set.",
        on: "2026-10-19",
        came: ["Willa", "Pete"],
        cardId: "s-named-night",
        attested: true,
      },
      now,
    });
    assert.equal(posted.ok, true);
    await db.query(`update "user" set name = 'Pete' where id = $1`, [mallory]);
    const pete = await member(db, "Pete");
    assert.equal((await recordAttendance(db, mallory, now, ["s-named-night"])).ok, true);
    assert.equal((await recordAttendance(db, pete, now, ["s-named-night"])).ok, true);
    assert.equal((await recordAttendance(db, willa, now, ["s-named-night"])).ok, true);
    const peers = (await listPeers(db, host)).map((person) => person.id);
    assert.equal(peers.includes(willa), true);
    assert.equal(peers.includes(mallory), false);
    assert.equal(peers.includes(pete), false);
  } finally {
    await close();
  }
});

test("existing hosted posts are named when the private-message migration runs", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const sql = readFileSync(new URL("../../migrations/0006_dm_e2ee.sql", import.meta.url), "utf8");
    assert.match(sql, /backfill_dm_named_accounts/);
    assert.match(sql, /to_regclass\('public.board_post'\)/);
    assert.match(sql, /access_log/);
    assert.match(sql, /a\.at <= p\.created_at/);
    assert.doesNotMatch(sql, /u\.name = any\(p\.came\)/);
    const now = new Date("2026-10-19T12:00:00Z");
    const earlier = new Date("2026-10-19T11:00:00Z");
    const later = new Date("2026-10-20T12:00:00Z");
    const host = await member(db, "Host", false);
    const willa = await member(db, "Willa", false);
    const firstBob = await member(db, "Bob", false);
    const secondBob = await member(db, "Bob", false);
    const peteThen = await member(db, "Pete", false);
    const mallory = await member(db, "Mallory", false);
    const peteNow = await member(db, "Pete", false);
    const grant = async (userId: string, name: string, at: Date) => {
      await db.query(
        `insert into access_log
         (id, user_id, name, role, action, vouched_by, approved_by, by_actor, note, at)
         values ($1, $2, $3, 'member', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
        [randomUUID(), userId, name, at],
      );
    };
    await grant(host, "Host", earlier);
    await grant(willa, "Willa", earlier);
    await grant(firstBob, "Bob", earlier);
    await grant(secondBob, "Bob", earlier);
    await grant(peteThen, "Pete", earlier);
    await grant(mallory, "Mallory", earlier);
    await grant(peteNow, "Pete", later);
    await db.query(`update "user" set name = 'Hostess' where id = $1`, [host]);
    await db.query(`update "user" set name = 'Peter' where id = $1`, [peteThen]);
    await db.query(`update "user" set name = 'Pete' where id = $1`, [mallory]);
    const postId = randomUUID();
    await db.query(
      `insert into board_post (
         id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at
       ) values ($1, 'shop', $2, 'Host', 'hosted', 'The framing night went well and the next one is set.', $3, 's-backfill', $4)`,
      [postId, host, ["Host", "Willa", "Pete", "Bob"], now],
    );
    await db.query(`select backfill_dm_named_accounts()`);
    await db.query(`select backfill_dm_named_accounts()`);
    const named = (
      await db.query<{ user_id: string }>(
        `select user_id from dm_named_account where post_id = $1 order by user_id`,
        [postId],
      )
    ).map((row) => row.user_id);
    assert.deepEqual(named, [host, willa, peteThen].sort());
    assert.equal(named.includes(firstBob), false);
    assert.equal(named.includes(secondBob), false);
    assert.equal(named.includes(mallory), false);
    assert.equal(named.includes(peteNow), false);
    assert.equal((await recordAttendance(db, willa, now, ["s-backfill"])).ok, true);
    assert.equal((await listPeers(db, host)).some((person) => person.id === willa), true);
  } finally {
    await close();
  }
});

test("two hosts cannot claim one fresh card at the same time", async () => {
  const { db, close } = await openRollCallDb();
  try {
    const sql = readFileSync(new URL("../../migrations/0006_dm_e2ee.sql", import.meta.url), "utf8");
    assert.match(sql, /dm_card_host/);
    assert.match(sql, /card_id text primary key/);
    const now = new Date("2026-10-19T12:00:00Z");
    const alice = await member(db, "Alice");
    const bob = await member(db, "Bob");
    for (const [id, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
    ] as const) {
      await db.query(
        `insert into access_log
         (id, user_id, name, role, action, vouched_by, approved_by, by_actor, note)
         values ($1, $2, $3, 'member', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
        [randomUUID(), id, name],
      );
    }
    const body = {
      type: "hosted",
      claim: "The framing night went well and the next one is set.",
      on: "2026-10-19",
      came: ["Alice"],
      cardId: "s-race-card",
      attested: true,
    };
    const [first, second] = await Promise.all([
      createPost(db, { userId: alice, name: "Alice", roomId: "shop", body, now }),
      createPost(db, {
        userId: bob,
        name: "Bob",
        roomId: "shop",
        body: { ...body, came: ["Bob"] },
        now,
      }),
    ]);
    const results = [first, second];
    assert.equal(results.filter((result) => result.ok).length, 1);
    const denied = results.find((result) => !result.ok);
    assert.ok(denied);
    if (!denied || denied.ok) return;
    assert.equal(denied.status, 409);
    const posts = await db.query(`select id from board_post where card_id = 's-race-card' and type = 'hosted'`);
    assert.equal(posts.length, 1);
    const claims = await db.query<{ author_user_id: string }>(
      `select author_user_id from dm_card_host where card_id = 's-race-card'`,
    );
    assert.equal(claims.length, 1);

    const earlier = randomUUID();
    const later = randomUUID();
    await db.query(
      `insert into board_post (
         id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at
       ) values
       ($1, 'shop', $2, 'Alice', 'hosted', 'The framing night went well and the next one is set.', $3, 's-early-card', $4),
       ($5, 'shop', $6, 'Bob', 'hosted', 'The framing night went well and the next one is set.', $7, 's-early-card', $8)`,
      [earlier, alice, ["Alice"], now, later, bob, ["Bob"], new Date(now.getTime() + 60_000)],
    );
    await db.query(`select backfill_dm_card_hosts()`);
    const owner = await db.query<{ author_user_id: string }>(
      `select author_user_id from dm_card_host where card_id = 's-early-card'`,
    );
    assert.equal(owner[0]?.author_user_id, alice);
    const taken = await createPost(db, {
      userId: bob,
      name: "Bob",
      roomId: "shop",
      body: { ...body, came: ["Bob"], cardId: "s-early-card" },
      now,
    });
    assert.equal(taken.ok, false);
    if (taken.ok) return;
    assert.equal(taken.status, 409);
  } finally {
    await close();
  }
});
