import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Db } from "../db.ts";
import { openTestDb } from "../closed-test/test-db.ts";
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
  openThread,
  postMessage,
  putBackup,
  recordAttendance,
  registerDevice,
  revokeDevice,
  sweepExpired,
  type DeviceRegistration,
} from "./store.ts";

const TEXT = "The framing night is Thursday, bring the saw.";

async function member(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, name, `${name}-${id}@example.com`],
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
  for (const userId of userIds) {
    const saved = await recordAttendance(
      db,
      userId,
      ["s-framing"],
      new Date("2026-10-19T12:00:00Z"),
    );
    assert.equal(saved.ok, true);
  }
}

test("a bad device signature is refused and eight devices is the cap", async () => {
  const { db, close } = await openTestDb();
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
  const { db, close } = await openTestDb();
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
  const { db, close } = await openTestDb();
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
  const { db, close } = await openTestDb();
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
  const { db, close } = await openTestDb();
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
