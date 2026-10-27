import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { isBlockedHash } from "./block.ts";
import {
  confirmationMail,
  declineTakedown,
  listTakedowns,
  mediaIdFrom,
  newRequestId,
  removeForTakedown,
  submitTakedown,
  TAKEDOWN_WINDOW_MS,
  validateTakedown,
} from "./store.ts";

const now = new Date("2026-10-27T12:00:00Z");
const good = {
  name: "Rae Doe",
  email: "rae@example.com",
  contentUrl: "https://avouchsocial.com/m/abc",
  goodFaith: true,
  signature: "Rae Doe",
};

async function user(db: Db, id: string, role: "member" | "admin") {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, id.slice(0, 6), `${id}@example.com`, now],
  );
  for (const r of role === "admin" ? ["member", "admin"] : ["member"]) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, 'T', $3, '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
      [randomUUID(), id, r, now],
    );
  }
}

async function media(db: Db, owner: string, sha: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into media_object
       (id, owner_user_id, scope, kind, status, content_type, byte_size, room_id, post_id,
        encryption, upload_key, source_sha256)
     values ($1, $2, 'room', 'image', 'ready', 'image/jpeg', 100, 'shop', $3,
             'server-processed', $4, $5)`,
    [id, owner, `post-${id}`, `up/${id}`, sha],
  );
  return id;
}

test("request IDs are TD- plus 10 readable characters", () => {
  const id = newRequestId();
  assert.match(id, /^TD-[2-9A-HJKMNP-Z]{10}$/);
  assert.notEqual(newRequestId(), id);
});

test("a request needs contact, a target, the good-faith statement, and a signature", () => {
  assert.equal(validateTakedown(good).ok, true);
  assert.equal(validateTakedown({ ...good, contentUrl: "", description: "In the shop room, Oct 20." }).ok, true);
  assert.equal(validateTakedown({ ...good, email: "nope" }).ok, false);
  assert.equal(validateTakedown({ ...good, contentUrl: "" }).ok, false);
  assert.equal(validateTakedown({ ...good, goodFaith: false }).ok, false);
  assert.equal(validateTakedown({ ...good, signature: " " }).ok, false);
  assert.equal(validateTakedown({ ...good, name: "" }).ok, false);
});

test("submitting saves the request, sets a 48-hour due time, mails the ID, and logs both", async () => {
  const { db, close } = await openTestDb();
  try {
    const sent: { url: string; body: any }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const saved = await submitTakedown(db, good, now, {
      fetch: fakeFetch,
      env: { RESEND_API_KEY: "k", RESEND_FROM: "Avouch <no-reply@example.com>" },
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.value.mailed, true);
    assert.equal(saved.value.dueAt, now.getTime() + TAKEDOWN_WINDOW_MS);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.body.to, ["rae@example.com"]);
    assert.match(sent[0]!.body.text, new RegExp(saved.value.id));
    const audit = await db.query<{ action: string; detail: string }>(
      `select action, detail from takedown_audit where request_id = $1 order by action`,
      [saved.value.id],
    );
    assert.deepEqual(audit, [
      { action: "mailed", detail: "sent" },
      { action: "received", detail: "" },
    ]);
  } finally {
    await close();
  }
});

test("without mail set up the request is still saved and the gap is logged", async () => {
  const { db, close } = await openTestDb();
  try {
    const saved = await submitTakedown(db, good, now, { env: {} });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.value.mailed, false);
    const audit = await db.query<{ detail: string }>(
      `select detail from takedown_audit where request_id = $1 and action = 'mailed'`,
      [saved.value.id],
    );
    assert.match(audit[0]!.detail, /not sent/);
  } finally {
    await close();
  }
});

test("only an admin sees the queue and removes; identical copies go too and the hash is blocked", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = randomUUID();
    const member = randomUUID();
    await user(db, admin, "admin");
    await user(db, member, "member");
    const sha = "a".repeat(64);
    const original = await media(db, member, sha);
    const copy = await media(db, member, sha);
    const other = await media(db, member, "b".repeat(64));
    const saved = await submitTakedown(db, good, now, { env: {} });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    assert.equal((await listTakedowns(db, member)).ok, false);
    const queue = await listTakedowns(db, admin);
    assert.equal(queue.ok, true);
    if (queue.ok) assert.equal(queue.value[0]?.id, saved.value.id);

    const byMember = await removeForTakedown(db, {
      userId: member, requestId: saved.value.id, media: [original], note: "Removed it.", now,
    });
    assert.equal(byMember.ok, false);

    const removed = await removeForTakedown(db, {
      userId: admin,
      requestId: saved.value.id,
      media: [`https://api.avouchsocial.com/api/media/${original}`],
      note: "Removed the image and its copy.",
      now,
    });
    assert.equal(removed.ok, true, JSON.stringify(removed));
    if (!removed.ok) return;
    assert.deepEqual(removed.value.removedIds, [original, copy].sort());
    assert.equal(removed.value.request.status, "removed");
    assert.equal(removed.value.request.removedCount, 2);
    const left = await db.query<{ id: string; deleted_at: Date | null }>(
      `select id, deleted_at from media_object where id = $1`,
      [other],
    );
    assert.equal(left[0]?.deleted_at, null);
    assert.equal(await isBlockedHash(db, sha), true);
    assert.equal(await isBlockedHash(db, "b".repeat(64)), false);

    const again = await removeForTakedown(db, {
      userId: admin, requestId: saved.value.id, media: [other], note: "Again.", now,
    });
    assert.equal(again.ok, false);
    const audit = await db.query<{ action: string; actor_user_id: string | null }>(
      `select action, actor_user_id from takedown_audit where request_id = $1 and action = 'removed'`,
      [saved.value.id],
    );
    assert.deepEqual(audit, [{ action: "removed", actor_user_id: admin }]);
  } finally {
    await close();
  }
});

test("an admin can close a request without removing, with a reason", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = randomUUID();
    await user(db, admin, "admin");
    const saved = await submitTakedown(db, good, now, { env: {} });
    if (!saved.ok) return assert.fail("not saved");
    assert.equal((await declineTakedown(db, { userId: admin, requestId: saved.value.id, note: "", now })).ok, false);
    const closed = await declineTakedown(db, {
      userId: admin, requestId: saved.value.id, note: "The link is not on Avouch.", now,
    });
    assert.equal(closed.ok, true);
    if (closed.ok) assert.equal(closed.value.status, "declined");
  } finally {
    await close();
  }
});

test("media ids are read from pasted links; the mail names the ID and the 48 hours", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assert.equal(mediaIdFrom(`https://api.avouchsocial.com/api/media/${id}/file`), id);
  assert.equal(mediaIdFrom(id.toUpperCase()), id);
  const mail = confirmationMail("TD-ABCDEFGHJK", new Date(now.getTime() + TAKEDOWN_WINDOW_MS));
  assert.match(mail.subject, /TD-ABCDEFGHJK/);
  assert.match(mail.text, /48 hours/);
});
