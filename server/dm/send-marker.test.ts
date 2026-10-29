import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import {
  createDevice,
  sealMessage,
  type DeviceRecord,
  type SealDestination,
} from "../../src/lib/e2ee/protocol.ts";
import {
  claimBundle,
  openThread,
  postMessage,
  registerDevice,
  type DeviceRegistration,
} from "./store.ts";

const now = new Date("2026-10-29T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

/** A member who has stood in the shop room long enough to start conversations. */
async function member(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`, daysAgo(30)],
  );
  for (const room of ["", "shop"]) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, 'member', $4, 'grant', 'test', 'test', 'test', 'Granted for the test.', $5)`,
      [randomUUID(), id, name, room, daysAgo(30)],
    );
  }
  await db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', $2)`, [
    id,
    daysAgo(10),
  ]);
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

/** Anna and Ben with one device each, a conversation, and one sealed message from Anna. */
async function ready(db: Db) {
  const anna = await member(db, "Anna");
  const ben = await member(db, "Ben");
  const opened = await openThread(db, anna, ben, now);
  assert.ok(opened.ok);
  const annaDevice = await createDevice({ userId: anna, prekeyCount: 1 });
  const benDevice = await createDevice({ userId: ben, prekeyCount: 1 });
  assert.equal((await registerDevice(db, anna, registration(annaDevice))).ok, true);
  assert.equal((await registerDevice(db, ben, registration(benDevice))).ok, true);
  assert.equal((await claimBundle(db, anna, ben, now)).ok, true);
  const sealed = await sealMessage({
    messageId: randomUUID(),
    threadId: opened.value.id,
    sender: annaDevice,
    text: "The framing night is Thursday.",
    destinations: [destination(ben, benDevice)],
  });
  assert.ok(sealed.ok);
  return { anna, ben, threadId: opened.value.id, message: sealed.value };
}

async function stored(db: Db, threadId: string): Promise<{ messages: number; envelopes: number }> {
  const rows = await db.query<{ messages: number; envelopes: number }>(
    `select
       (select count(*)::int from dm_message where thread_id = $1) as messages,
       (select count(*)::int from dm_envelope e join dm_message m on m.id = e.message_id
         where m.thread_id = $1) as envelopes`,
    [threadId],
  );
  return rows[0] ?? { messages: -1, envelopes: -1 };
}

test("a send sets the sender's has-written marker, and only theirs", async () => {
  const { db, close } = await openTestDb();
  try {
    const { anna, threadId, message } = await ready(db);
    const posted = await postMessage(db, anna, threadId, message, now);
    assert.deepEqual(posted, { ok: true, value: { id: message.messageId } });
    const rows = await db.query<{ user_a: string; a: Date | null; b: Date | null }>(
      `select user_a, user_a_wrote_at as a, user_b_wrote_at as b from dm_thread where id = $1`,
      [threadId],
    );
    const row = rows[0];
    assert.ok(row);
    const annaIsA = row.user_a === anna;
    assert.equal((annaIsA ? row.a : row.b)?.getTime(), now.getTime(), "Anna's marker is set");
    assert.equal(annaIsA ? row.b : row.a, null, "Ben never wrote");
    assert.deepEqual(await stored(db, threadId), { messages: 1, envelopes: 1 });
  } finally {
    await close();
  }
});

test("a failed marker write leaves no stored message, so a retry cannot duplicate it", async () => {
  const { db, close } = await openTestDb();
  try {
    const { anna, threadId, message } = await ready(db);
    const failing = (inner: Db): Db => ({
      ...inner,
      query: (text, params) =>
        /update dm_thread[\s\S]*wrote_at/.test(text)
          ? Promise.reject(Object.assign(new Error("disk full"), { code: "53100" }))
          : inner.query(text, params),
      transaction: (fn) => inner.transaction((tx) => fn(failing(tx))),
    });
    await assert.rejects(postMessage(failing(db), anna, threadId, message, now), /disk full/);
    assert.deepEqual(await stored(db, threadId), { messages: 0, envelopes: 0 });

    // The retry stores it once and sets the marker.
    const retried = await postMessage(db, anna, threadId, message, now);
    assert.deepEqual(retried, { ok: true, value: { id: message.messageId } });
    assert.deepEqual(await stored(db, threadId), { messages: 1, envelopes: 1 });
    const marks = await db.query<{ wrote: boolean }>(
      `select (case when user_a = $2 then user_a_wrote_at else user_b_wrote_at end) is not null as wrote
         from dm_thread where id = $1`,
      [threadId, anna],
    );
    assert.equal(marks[0]?.wrote, true);
  } finally {
    await close();
  }
});

test("before migration 0046 is applied, a real send still stores the message", async () => {
  const { db, close } = await openTestDb();
  try {
    const { anna, threadId, message } = await ready(db);
    await db.query(`alter table members drop column message_from`);
    await db.query(`alter table dm_thread drop column user_a_wrote_at`);
    await db.query(`alter table dm_thread drop column user_b_wrote_at`);
    const posted = await postMessage(db, anna, threadId, message, now);
    assert.deepEqual(posted, { ok: true, value: { id: message.messageId } });
    assert.deepEqual(await stored(db, threadId), { messages: 1, envelopes: 1 });
    // The same message again is still the usual duplicate answer.
    const again = await postMessage(db, anna, threadId, message, now);
    assert.deepEqual(again.ok ? null : again.status, 409);
  } finally {
    await close();
  }
});
