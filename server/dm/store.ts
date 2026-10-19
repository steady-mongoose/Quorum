import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import {
  BODY_CIPHER_MAX_BYTES,
  DM_MAX_DEVICES,
  DM_MAX_ENVELOPES,
  DM_PREKEY_STOCK_MAX,
  DM_RETENTION_MS,
  WRAP_CIPHER_MAX_BYTES,
} from "../../src/lib/e2ee/limits.ts";
import {
  backupRecordOk,
  isBoxPublic,
  isMemberId,
  isUuid,
  verifyBodySignature,
  verifyDeviceStatement,
  verifyPrekey,
  type BackupCipher,
  type EnvelopeWire,
  type MessageWire,
  type PublicDevice,
  type PublicPrekey,
} from "../../src/lib/e2ee/protocol.ts";

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

function fail(status: number, error: string): Result<never> {
  return { ok: false, status, error };
}

class Rejected extends Error {
  result: Result<never>;
  constructor(result: Result<never>) {
    super("rejected");
    this.result = result;
  }
}

async function commit<T>(db: Db, fn: (tx: Db) => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await db.transaction(async (tx) => {
      const result = await fn(tx);
      if (!result.ok) throw new Rejected(result);
      return result;
    });
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}

export type DeviceRegistration = {
  deviceId: string;
  label: string;
  signPublic: string;
  boxPublic: string;
  statementSig: string;
  prekeys: PublicPrekey[];
};

export type StoredMessage = MessageWire & {
  senderUserId: string;
  createdAt: string;
  sender: PublicDevice;
};

type DeviceRow = {
  id: string;
  user_id: string;
  label: string;
  sign_public: string;
  box_public: string;
  statement_sig: string;
  created_at: Date | string;
  revoked_at: Date | string | null;
};

function validLabel(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length < 1 || trimmed.length > 40) return false;
  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return false;
  }
  return true;
}

function bounded(value: string, maxChars: number): boolean {
  return value.length > 0 && value.length <= maxChars;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function asPublic(row: DeviceRow): PublicDevice {
  return {
    deviceId: row.id,
    signPublic: row.sign_public,
    boxPublic: row.box_public,
    statementSig: row.statement_sig,
  };
}

async function prekeysOk(
  deviceId: string,
  signPublic: string,
  prekeys: PublicPrekey[],
): Promise<boolean> {
  if (prekeys.length < 1 || prekeys.length > 20) return false;
  const ids = new Set<string>();
  for (const prekey of prekeys) {
    if (!isUuid(prekey.id) || ids.has(prekey.id)) return false;
    ids.add(prekey.id);
    if (!(await verifyPrekey(deviceId, signPublic, prekey))) return false;
  }
  return true;
}

export async function registerDevice(
  db: Db,
  userId: string,
  input: DeviceRegistration,
): Promise<Result<{ deviceId: string }>> {
  if (!isUuid(input.deviceId) || !validLabel(input.label))
    return fail(400, "That device was not recognized.");
  const device = {
    deviceId: input.deviceId,
    signPublic: input.signPublic,
    boxPublic: input.boxPublic,
    statementSig: input.statementSig,
  };
  if (!(await verifyDeviceStatement(userId, device)))
    return fail(400, "That device key was not accepted.");
  if (!(await prekeysOk(input.deviceId, input.signPublic, input.prekeys))) {
    return fail(400, "That device key was not accepted.");
  }
  const label = input.label.trim();
  return commit(db, async (tx) => {
    const existing = await tx.query<DeviceRow>(`select * from dm_device where id = $1`, [
      input.deviceId,
    ]);
    const row = existing[0];
    if (row) {
      if (row.user_id !== userId) return fail(403, "That device belongs to someone else.");
      if (row.revoked_at) return fail(400, "That device was revoked.");
      const same =
        row.sign_public === input.signPublic &&
        row.box_public === input.boxPublic &&
        row.statement_sig === input.statementSig;
      if (!same) return fail(409, "That device already has different keys.");
      const added = await insertPrekeys(tx, input.deviceId, input.prekeys);
      if (!added.ok) return added;
      return { ok: true, value: { deviceId: input.deviceId } };
    }
    const active = await tx.query<{ count: number | string }>(
      `select count(*)::int as count from dm_device where user_id = $1 and revoked_at is null`,
      [userId],
    );
    if (Number(active[0]?.count ?? 0) >= DM_MAX_DEVICES) {
      return fail(400, `A member can have ${DM_MAX_DEVICES} devices.`);
    }
    await tx.query(
      `insert into dm_device (id, user_id, label, sign_public, box_public, statement_sig)
       values ($1, $2, $3, $4, $5, $6)`,
      [input.deviceId, userId, label, input.signPublic, input.boxPublic, input.statementSig],
    );
    const added = await insertPrekeys(tx, input.deviceId, input.prekeys);
    if (!added.ok) return added;
    return { ok: true, value: { deviceId: input.deviceId } };
  });
}

async function insertPrekeys(
  db: Db,
  deviceId: string,
  prekeys: PublicPrekey[],
): Promise<Result<null>> {
  const stock = await db.query<{ count: number | string }>(
    `select count(*)::int as count from dm_prekey where device_id = $1 and used_at is null`,
    [deviceId],
  );
  const known = await db.query<{ id: string }>(`select id from dm_prekey where device_id = $1`, [
    deviceId,
  ]);
  const have = new Set(known.map((row) => row.id));
  const fresh = prekeys.filter((prekey) => !have.has(prekey.id));
  if (Number(stock[0]?.count ?? 0) + fresh.length > DM_PREKEY_STOCK_MAX) {
    return fail(400, "This device already has enough one-time keys.");
  }
  for (const prekey of fresh) {
    await db.query(
      `insert into dm_prekey (id, device_id, public_key, signature) values ($1, $2, $3, $4)`,
      [prekey.id, deviceId, prekey.publicKey, prekey.signature],
    );
  }
  return { ok: true, value: null };
}

export async function addPrekeys(
  db: Db,
  userId: string,
  deviceId: string,
  prekeys: PublicPrekey[],
): Promise<Result<null>> {
  if (!isUuid(deviceId)) return fail(400, "That device was not recognized.");
  const rows = await db.query<DeviceRow>(
    `select * from dm_device where id = $1 and user_id = $2 and revoked_at is null`,
    [deviceId, userId],
  );
  const device = rows[0];
  if (!device) return fail(404, "That device was not recognized.");
  if (!(await prekeysOk(deviceId, device.sign_public, prekeys))) {
    return fail(400, "That device key was not accepted.");
  }
  return commit(db, async (tx) => insertPrekeys(tx, deviceId, prekeys));
}

export async function revokeDevice(
  db: Db,
  userId: string,
  deviceId: string,
  now: Date,
): Promise<Result<null>> {
  if (!isUuid(deviceId)) return fail(400, "That device was not recognized.");
  const updated = await db.query<{ id: string }>(
    `update dm_device set revoked_at = $3 where id = $1 and user_id = $2 and revoked_at is null returning id`,
    [deviceId, userId, now],
  );
  if (!updated[0]) return fail(404, "That device was not recognized.");
  return { ok: true, value: null };
}

export async function listOwnDevices(
  db: Db,
  userId: string,
): Promise<
  { id: string; label: string; createdAt: string; revokedAt: string | null; prekeysLeft: number }[]
> {
  const rows = await db.query<DeviceRow & { prekeys_left: number | string }>(
    `select d.*, (
       select count(*)::int from dm_prekey p where p.device_id = d.id and p.used_at is null
     ) as prekeys_left
     from dm_device d where d.user_id = $1 order by d.created_at`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: iso(row.created_at),
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
    prekeysLeft: Number(row.prekeys_left ?? 0),
  }));
}

export async function putBackup(
  db: Db,
  userId: string,
  boxPublic: string,
  record: BackupCipher,
  now: Date,
): Promise<Result<null>> {
  if (!(await backupRecordOk(boxPublic, record)))
    return fail(400, "That key backup was not accepted.");
  const existing = await db.query<{ box_public: string }>(
    `select box_public from dm_backup where user_id = $1`,
    [userId],
  );
  if (existing[0] && existing[0].box_public !== boxPublic) {
    return fail(409, "The backup key is already set. It cannot be replaced from here.");
  }
  await db.query(
    `insert into dm_backup (user_id, box_public, kdf, opslimit, memlimit, salt, nonce, ciphertext, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (user_id) do update set
       kdf = excluded.kdf,
       opslimit = excluded.opslimit,
       memlimit = excluded.memlimit,
       salt = excluded.salt,
       nonce = excluded.nonce,
       ciphertext = excluded.ciphertext,
       updated_at = excluded.updated_at`,
    [
      userId,
      boxPublic,
      record.kdf,
      record.opslimit,
      record.memlimit,
      record.salt,
      record.nonce,
      record.ciphertext,
      now,
    ],
  );
  return { ok: true, value: null };
}

export async function getBackup(
  db: Db,
  userId: string,
): Promise<{
  boxPublic: string;
  kdf: "argon2id";
  opslimit: number;
  memlimit: number;
  salt: string;
  nonce: string;
  ciphertext: string;
} | null> {
  const rows = await db.query<{
    box_public: string;
    kdf: "argon2id";
    opslimit: number;
    memlimit: number;
    salt: string;
    nonce: string;
    ciphertext: string;
  }>(
    `select box_public, kdf, opslimit, memlimit, salt, nonce, ciphertext from dm_backup where user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    boxPublic: row.box_public,
    kdf: "argon2id",
    opslimit: Number(row.opslimit),
    memlimit: Number(row.memlimit),
    salt: row.salt,
    nonce: row.nonce,
    ciphertext: row.ciphertext,
  };
}

async function sharesThread(db: Db, callerId: string, otherUserId: string): Promise<boolean> {
  if (callerId === otherUserId) return true;
  const [low, high] = callerId < otherUserId ? [callerId, otherUserId] : [otherUserId, callerId];
  const rows = await db.query<{ id: string }>(
    `select id from dm_thread where user_a = $1 and user_b = $2`,
    [low, high],
  );
  return Boolean(rows[0]);
}

export async function claimBundle(
  db: Db,
  callerId: string,
  targetUserId: string,
  now: Date,
): Promise<
  Result<{
    userId: string;
    backupPublic: string | null;
    devices: (PublicDevice & { prekey: PublicPrekey | null })[];
  }>
> {
  if (!isMemberId(targetUserId)) return fail(400, "That member was not found.");
  if (!(await sharesThread(db, callerId, targetUserId))) {
    return fail(403, "Open the conversation before asking for keys.");
  }
  return db.transaction(async (tx) => {
    const devices = await tx.query<DeviceRow>(
      `select * from dm_device where user_id = $1 and revoked_at is null order by created_at`,
      [targetUserId],
    );
    const backup = await tx.query<{ box_public: string }>(
      `select box_public from dm_backup where user_id = $1`,
      [targetUserId],
    );
    const packed: (PublicDevice & { prekey: PublicPrekey | null })[] = [];
    for (const device of devices) {
      const prekeys = await tx.query<{ id: string; public_key: string; signature: string }>(
        `select id, public_key, signature from dm_prekey
         where device_id = $1 and used_at is null order by id limit 1`,
        [device.id],
      );
      const prekey = prekeys[0];
      if (prekey) {
        await tx.query(`update dm_prekey set used_at = $2 where id = $1 and used_at is null`, [
          prekey.id,
          now,
        ]);
      }
      packed.push({
        ...asPublic(device),
        prekey: prekey
          ? { id: prekey.id, publicKey: prekey.public_key, signature: prekey.signature }
          : null,
      });
    }
    return {
      ok: true,
      value: { userId: targetUserId, backupPublic: backup[0]?.box_public ?? null, devices: packed },
    };
  });
}

/** Public keys only. Does not consume a one-time prekey. */
export async function previewBundle(
  db: Db,
  callerId: string,
  targetUserId: string,
): Promise<Result<{ userId: string; backupPublic: string | null; deviceCount: number }>> {
  if (!isMemberId(targetUserId)) return fail(400, "That member was not found.");
  if (!(await sharesThread(db, callerId, targetUserId))) {
    return fail(403, "Open the conversation before asking for keys.");
  }
  const devices = await db.query<{ count: number | string }>(
    `select count(*)::int as count from dm_device where user_id = $1 and revoked_at is null`,
    [targetUserId],
  );
  const backup = await db.query<{ box_public: string }>(
    `select box_public from dm_backup where user_id = $1`,
    [targetUserId],
  );
  return {
    ok: true,
    value: {
      userId: targetUserId,
      backupPublic: backup[0]?.box_public ?? null,
      deviceCount: Number(devices[0]?.count ?? 0),
    },
  };
}

export async function lookupMembers(
  db: Db,
  name: string,
): Promise<Result<{ matches: { id: string; name: string }[] }>> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) return fail(400, "That member was not found.");
  const rows = await db.query<{ id: string; name: string }>(
    `select id, name from "user" where name = $1 order by id limit 3`,
    [trimmed],
  );
  if (rows.length > 2) return fail(409, "More than one member has that name.");
  return {
    ok: true,
    value: { matches: rows.slice(0, 2).map((row) => ({ id: row.id, name: row.name })) },
  };
}

export async function openThread(
  db: Db,
  userId: string,
  otherUserId: string,
  now: Date,
): Promise<Result<{ id: string; otherUserId: string; otherName: string }>> {
  if (!isMemberId(otherUserId) || otherUserId === userId)
    return fail(400, "Messages are between two people.");
  const people = await db.query<{ id: string; name: string }>(
    `select id, name from "user" where id = $1`,
    [otherUserId],
  );
  const other = people[0];
  if (!other) return fail(404, "That member was not found.");
  const [low, high] = userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
  const existing = await db.query<{ id: string }>(
    `select id from dm_thread where user_a = $1 and user_b = $2`,
    [low, high],
  );
  if (existing[0])
    return { ok: true, value: { id: existing[0].id, otherUserId, otherName: other.name } };
  const id = randomUUID();
  await db.query(`insert into dm_thread (id, user_a, user_b, created_at) values ($1, $2, $3, $4)`, [
    id,
    low,
    high,
    now,
  ]);
  return { ok: true, value: { id, otherUserId, otherName: other.name } };
}

export async function listThreads(
  db: Db,
  userId: string,
): Promise<{ id: string; otherUserId: string; otherName: string }[]> {
  const rows = await db.query<{ id: string; other_id: string; other_name: string }>(
    `select t.id,
            case when t.user_a = $1 then t.user_b else t.user_a end as other_id,
            u.name as other_name
     from dm_thread t
     join "user" u on u.id = case when t.user_a = $1 then t.user_b else t.user_a end
     where t.user_a = $1 or t.user_b = $1
     order by t.created_at`,
    [userId],
  );
  return rows.map((row) => ({ id: row.id, otherUserId: row.other_id, otherName: row.other_name }));
}

async function threadFor(
  db: Db,
  threadId: string,
  userId: string,
): Promise<{ id: string; user_a: string; user_b: string } | null> {
  const rows = await db.query<{ id: string; user_a: string; user_b: string }>(
    `select id, user_a, user_b from dm_thread where id = $1 and (user_a = $2 or user_b = $2)`,
    [threadId, userId],
  );
  return rows[0] ?? null;
}

export async function postMessage(
  db: Db,
  userId: string,
  threadId: string,
  message: MessageWire,
  now: Date,
): Promise<Result<{ id: string }>> {
  if (!isUuid(threadId) || message.threadId !== threadId || !isUuid(message.messageId)) {
    return fail(400, "That message was not accepted.");
  }
  if (message.envelopes.length < 1 || message.envelopes.length > DM_MAX_ENVELOPES) {
    return fail(400, "That message was not accepted.");
  }
  if (
    !bounded(message.bodyCiphertext, BODY_CIPHER_MAX_BYTES * 2) ||
    !bounded(message.bodyNonce, 80) ||
    !bounded(message.bodySig, 200)
  ) {
    return fail(413, "The ciphertext is too large.");
  }
  const thread = await threadFor(db, threadId, userId);
  if (!thread) return fail(404, "That conversation was not found.");
  const otherUserId = thread.user_a === userId ? thread.user_b : thread.user_a;
  const devices = await db.query<DeviceRow>(`select * from dm_device where id = $1`, [
    message.senderDeviceId,
  ]);
  const sender = devices[0];
  if (!sender || sender.user_id !== userId || sender.revoked_at)
    return fail(400, "That device was not recognized.");
  if (!(await verifyBodySignature(message, sender.sign_public)))
    return fail(400, "That message was not accepted.");

  const reachesOther = await envelopesOk(db, message.envelopes, thread, otherUserId);
  if (!reachesOther.ok) return reachesOther;

  const expires = new Date(now.getTime() + DM_RETENTION_MS);
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into dm_message (
           id, thread_id, sender_user_id, sender_device_id, body_nonce, body_ciphertext, body_sig, created_at, expires_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          message.messageId,
          threadId,
          userId,
          message.senderDeviceId,
          message.bodyNonce,
          message.bodyCiphertext,
          message.bodySig,
          now,
          expires,
        ],
      );
      for (const envelope of message.envelopes) {
        await tx.query(
          `insert into dm_envelope (
             id, message_id, recipient_device_id, recipient_user_backup, nonce, ciphertext, ephemeral_public, prekey_id
           ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            message.messageId,
            envelope.recipientDeviceId,
            envelope.recipientUserBackup,
            envelope.nonce,
            envelope.ciphertext,
            envelope.ephemeralPublic,
            envelope.prekeyId,
          ],
        );
      }
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (/duplicate key|unique constraint/i.test(text))
      return fail(409, "That message was already sent.");
    throw error;
  }
  return { ok: true, value: { id: message.messageId } };
}

async function envelopesOk(
  db: Db,
  envelopes: EnvelopeWire[],
  thread: { user_a: string; user_b: string },
  otherUserId: string,
): Promise<Result<null>> {
  let reachesOther = false;
  for (const envelope of envelopes) {
    const deviceSet = Boolean(envelope.recipientDeviceId);
    const backupSet = Boolean(envelope.recipientUserBackup);
    if (deviceSet === backupSet) return fail(400, "That message was not accepted.");
    if (!bounded(envelope.ciphertext, WRAP_CIPHER_MAX_BYTES * 2) || !bounded(envelope.nonce, 80)) {
      return fail(413, "The ciphertext is too large.");
    }
    if (!(await isBoxPublic(envelope.ephemeralPublic)))
      return fail(400, "That message was not accepted.");
    if (envelope.recipientDeviceId) {
      if (!isUuid(envelope.recipientDeviceId)) return fail(400, "That message was not accepted.");
      const rows = await db.query<DeviceRow>(`select * from dm_device where id = $1`, [
        envelope.recipientDeviceId,
      ]);
      const device = rows[0];
      if (!device || device.revoked_at) return fail(400, "That message was not accepted.");
      if (device.user_id !== thread.user_a && device.user_id !== thread.user_b) {
        return fail(400, "Messages are between two people.");
      }
      if (device.user_id === otherUserId) reachesOther = true;
      if (envelope.prekeyId) {
        if (!isUuid(envelope.prekeyId)) return fail(400, "That message was not accepted.");
        const prekeys = await db.query<{ id: string }>(
          `select id from dm_prekey where id = $1 and device_id = $2`,
          [envelope.prekeyId, device.id],
        );
        if (!prekeys[0]) return fail(400, "That message was not accepted.");
      }
    } else if (envelope.recipientUserBackup) {
      if (
        envelope.recipientUserBackup !== thread.user_a &&
        envelope.recipientUserBackup !== thread.user_b
      ) {
        return fail(400, "Messages are between two people.");
      }
      const backups = await db.query<{ user_id: string }>(
        `select user_id from dm_backup where user_id = $1`,
        [envelope.recipientUserBackup],
      );
      if (!backups[0]) return fail(400, "That message was not accepted.");
      if (envelope.prekeyId) return fail(400, "That message was not accepted.");
      if (envelope.recipientUserBackup === otherUserId) reachesOther = true;
    }
  }
  if (!reachesOther) return fail(400, "Messages are between two people.");
  return { ok: true, value: null };
}

export async function listMessages(
  db: Db,
  userId: string,
  threadId: string,
  now: Date,
): Promise<Result<StoredMessage[]>> {
  if (!isUuid(threadId)) return fail(404, "That conversation was not found.");
  await db.query(`delete from dm_message where expires_at <= $1`, [now]);
  const thread = await threadFor(db, threadId, userId);
  if (!thread) return fail(404, "That conversation was not found.");
  const messages = await db.query<{
    id: string;
    sender_user_id: string;
    sender_device_id: string;
    body_nonce: string;
    body_ciphertext: string;
    body_sig: string;
    created_at: Date | string;
  }>(
    `select id, sender_user_id, sender_device_id, body_nonce, body_ciphertext, body_sig, created_at
     from (
       select * from dm_message where thread_id = $1 and expires_at > $2 order by created_at desc limit 200
     ) recent
     order by created_at asc`,
    [threadId, now],
  );
  const stored: StoredMessage[] = [];
  for (const message of messages) {
    const devices = await db.query<DeviceRow>(`select * from dm_device where id = $1`, [
      message.sender_device_id,
    ]);
    const sender = devices[0];
    if (!sender) continue;
    const envelopes = await db.query<{
      recipient_device_id: string | null;
      recipient_user_backup: string | null;
      nonce: string;
      ciphertext: string;
      ephemeral_public: string;
      prekey_id: string | null;
    }>(
      `select recipient_device_id, recipient_user_backup, nonce, ciphertext, ephemeral_public, prekey_id
       from dm_envelope
       where message_id = $1
         and (
           recipient_user_backup = $2
           or recipient_device_id in (select id from dm_device where user_id = $2)
         )`,
      [message.id, userId],
    );
    stored.push({
      messageId: message.id,
      threadId,
      senderDeviceId: message.sender_device_id,
      senderUserId: message.sender_user_id,
      createdAt: iso(message.created_at),
      sender: asPublic(sender),
      bodyNonce: message.body_nonce,
      bodyCiphertext: message.body_ciphertext,
      bodySig: message.body_sig,
      envelopes: envelopes.map((envelope) => ({
        recipientDeviceId: envelope.recipient_device_id,
        recipientUserBackup: envelope.recipient_user_backup,
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext,
        ephemeralPublic: envelope.ephemeral_public,
        prekeyId: envelope.prekey_id,
      })),
    });
  }
  return { ok: true, value: stored };
}
