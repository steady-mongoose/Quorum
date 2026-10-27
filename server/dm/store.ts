import { randomUUID } from "node:crypto";
import { guardRoomAudience } from "../board/audience.ts";
import { isUniqueViolation, type Db } from "../db.ts";
import { OBJECT_ID } from "../../src/lib/media/limits.ts";
import {
  BODY_CIPHER_MAX_BYTES,
  DM_MAX_DEVICES,
  DM_MAX_ENVELOPES,
  DM_PREKEY_STOCK_MAX,
  DM_RETENTION_MS,
  SIGNED_PREKEY_MAX_AGE_MS,
  WRAP_CIPHER_MAX_BYTES,
} from "../../src/lib/e2ee/limits.ts";
import {
  backupRecordOk,
  isBoxPublic,
  isMemberId,
  isUuid,
  verifyBodySignature,
  verifyDeviceStatement,
  verifyIdentitySignature,
  verifyPrekey,
  verifySignedPrekey,
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

async function saveIdentity(db: Db, userId: string, signPublic: string): Promise<Result<null>> {
  const existing = await db.query<{ sign_public: string }>(
    `select sign_public from dm_identity where user_id = $1`,
    [userId],
  );
  if (!existing[0]) {
    await db.query(`insert into dm_identity (user_id, sign_public) values ($1, $2)`, [
      userId,
      signPublic,
    ]);
    return { ok: true, value: null };
  }
  if (existing[0].sign_public !== signPublic) return fail(409, "The identity key is already set.");
  return { ok: true, value: null };
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
  identityPublic: string;
  identitySig: string;
  signedPrekey: PublicPrekey;
  prekeys: PublicPrekey[];
};

export type StoredMessage = MessageWire & {
  senderUserId: string;
  senderIdentityPublic: string;
  /** True when the sender account is gone. The client checks its saved identity key. */
  former: boolean;
  createdAt: string;
  sender: PublicDevice | null;
};

type DeviceRow = {
  id: string;
  user_id: string | null;
  label: string;
  sign_public: string;
  box_public: string;
  statement_sig: string;
  identity_sig: string;
  signed_prekey_id: string;
  signed_prekey_public: string;
  signed_prekey_sig: string;
  signed_prekey_rotated_at: Date | string;
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
    identitySig: row.identity_sig,
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
    identitySig: input.identitySig,
  };
  if (!(await verifyDeviceStatement(userId, device)))
    return fail(400, "That device key was not accepted.");
  if (!(await verifyIdentitySignature(input.identityPublic, userId, device))) {
    return fail(400, "That device key was not accepted.");
  }
  if (!(await verifySignedPrekey(input.deviceId, input.signPublic, input.signedPrekey))) {
    return fail(400, "That device key was not accepted.");
  }
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
        row.statement_sig === input.statementSig &&
        row.identity_sig === input.identitySig;
      if (!same) return fail(409, "That device already has different keys.");
      const identity = await tx.query<{ sign_public: string }>(
        `select sign_public from dm_identity where user_id = $1`,
        [userId],
      );
      if (identity[0] && identity[0].sign_public !== input.identityPublic) {
        return fail(409, "The identity key is already set.");
      }
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
    const identitySaved = await saveIdentity(tx, userId, input.identityPublic);
    if (!identitySaved.ok) return identitySaved;
    await tx.query(
      `insert into dm_device (
         id, user_id, label, sign_public, box_public, statement_sig, identity_sig,
         signed_prekey_id, signed_prekey_public, signed_prekey_sig
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.deviceId,
        userId,
        label,
        input.signPublic,
        input.boxPublic,
        input.statementSig,
        input.identitySig,
        input.signedPrekey.id,
        input.signedPrekey.publicKey,
        input.signedPrekey.signature,
      ],
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
  signedPrekey: PublicPrekey | null = null,
  now: Date = new Date(),
): Promise<Result<null>> {
  if (!isUuid(deviceId)) return fail(400, "That device was not recognized.");
  const rows = await db.query<DeviceRow>(
    `select * from dm_device where id = $1 and user_id = $2 and revoked_at is null`,
    [deviceId, userId],
  );
  const device = rows[0];
  if (!device) return fail(404, "That device was not recognized.");
  if (prekeys.length === 0 && !signedPrekey) return fail(400, "That device key was not accepted.");
  if (prekeys.length > 0 && !(await prekeysOk(deviceId, device.sign_public, prekeys))) {
    return fail(400, "That device key was not accepted.");
  }
  if (signedPrekey && !(await verifySignedPrekey(deviceId, device.sign_public, signedPrekey))) {
    return fail(400, "That device key was not accepted.");
  }
  return commit(db, async (tx) => {
    const added = await insertPrekeys(tx, deviceId, prekeys);
    if (!added.ok) return added;
    if (signedPrekey) {
      await tx.query(
        `update dm_device
         set signed_prekey_id = $2, signed_prekey_public = $3, signed_prekey_sig = $4, signed_prekey_rotated_at = $5
         where id = $1`,
        [deviceId, signedPrekey.id, signedPrekey.publicKey, signedPrekey.signature, now],
      );
    }
    return { ok: true, value: null };
  });
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
  await db.query(`delete from dm_prekey where device_id = $1`, [deviceId]);
  return { ok: true, value: null };
}

export async function listOwnDevices(
  db: Db,
  userId: string,
): Promise<
  {
    id: string;
    label: string;
    createdAt: string;
    revokedAt: string | null;
    prekeysLeft: number;
    signedPrekeyRotatedAt: string;
  }[]
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
    signedPrekeyRotatedAt: iso(row.signed_prekey_rotated_at),
  }));
}

function signedPrekeyFor(row: DeviceRow, now: Date): PublicPrekey | null {
  const at = new Date(row.signed_prekey_rotated_at).getTime();
  if (!Number.isFinite(at) || now.getTime() - at > SIGNED_PREKEY_MAX_AGE_MS) return null;
  return {
    id: row.signed_prekey_id,
    publicKey: row.signed_prekey_public,
    signature: row.signed_prekey_sig,
  };
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

/**
 * A real meeting is the earliest hosted post for a non-empty card id, in a
 * room that takes meeting cards, and that post is still up. The host counts.
 * Anyone else counts only after they confirm, and only when the host's post
 * resolved their account at the time it was filed. A later account, or a
 * later rename onto that name, is not attendance. A post id is not a meeting.
 */
const REAL_MEETINGS = `
  with first_host as (
    select distinct on (p.card_id)
      p.card_id as meeting_id,
      p.author_user_id as host_id,
      p.removed,
      p.room_id
    from board_post p
    where p.type = 'hosted'
      and p.card_id <> ''
    order by p.card_id, p.created_at asc, p.id asc
  ),
  host_cards as (
    select f.meeting_id, f.host_id
    from first_host f
    join room r on r.id = f.room_id
    where f.removed = false
      and f.host_id is not null
      and 'meeting' = any (r.card_kinds)
  ),
  named_accounts as (
    select distinct h.meeting_id, h.host_id, n.user_id
    from host_cards h
    join board_post p
      on p.card_id = h.meeting_id
     and p.author_user_id = h.host_id
     and p.type = 'hosted'
     and p.removed = false
    join dm_named_account n on n.post_id = p.id
  )
`;

const VERIFIED_ATTENDANCE = `
  ${REAL_MEETINGS}
  select h.host_id as user_id, h.meeting_id
  from host_cards h
  union
  select n.user_id, n.meeting_id
  from named_accounts n
  join dm_attendance att on att.user_id = n.user_id and att.meeting_id = n.meeting_id
  where n.user_id <> n.host_id
`;

const CONFIRMABLE = `
  ${REAL_MEETINGS}
  select h.meeting_id
  from host_cards h
  where h.host_id = $1
  union
  select n.meeting_id
  from named_accounts n
  where n.user_id = $1
`;

const ATTENDANCE_CARD_CAP = 40;

/** Resolve the names on a hosted post to accounts that exist right now. */
export async function rememberNamedAccounts(db: Db, postId: string): Promise<void> {
  const ready = await db.query<{ ready: string | null }>(
    `select to_regclass('public.dm_named_account') as ready`,
  );
  if (!ready[0]?.ready) return;
  await db.query(
    `insert into dm_named_account (post_id, user_id)
     select p.id, u.id
     from board_post p
     join "user" u on u.name <> '' and u.name = any(p.came)
     where p.id = $1
       and p.type = 'hosted'
       and (select count(*)::int from "user" named where named.name = u.name) = 1
     on conflict do nothing`,
    [postId],
  );
}

export async function recordAttendance(
  db: Db,
  userId: string,
  now: Date,
  cardIds: string[] = [],
): Promise<Result<null>> {
  const requested = [
    ...new Set(cardIds.map((id) => id.trim()).filter((id) => OBJECT_ID.test(id))),
  ].slice(0, ATTENDANCE_CARD_CAP);
  if (requested.length > 0) {
    const meetings = await db.query<{ room_id: string }>(
      `select distinct on (card_id) room_id
       from board_post
       where type = 'hosted' and removed = false and card_id = any($1::text[])
       order by card_id, created_at asc, id asc`,
      [requested],
    );
    for (const meeting of meetings) {
      const gate = await guardRoomAudience(db, {
        userId,
        roomId: meeting.room_id,
        now,
        path: "read",
      });
      if (!gate.ok) {
        if (gate.status === 404) return fail(404, "Not found.");
        return fail(gate.status, gate.error);
      }
    }
  }
  await db.query(`delete from dm_attendance where user_id = $1`, [userId]);
  if (requested.length === 0) return { ok: true, value: null };
  await db.query(
    `insert into dm_attendance (user_id, meeting_id, recorded_at)
     select $1, allowed.meeting_id, $2
     from (${CONFIRMABLE}) allowed
     where allowed.meeting_id = any($3::text[])`,
    [userId, now, requested],
  );
  return { ok: true, value: null };
}

export async function listPeers(db: Db, userId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db.query<{ id: string; name: string }>(
    `select distinct peer.id, peer.name
     from (${VERIFIED_ATTENDANCE}) mine
     join (${VERIFIED_ATTENDANCE}) theirs
       on theirs.meeting_id = mine.meeting_id and theirs.user_id <> mine.user_id
     join "user" peer on peer.id = theirs.user_id
     where mine.user_id = $1
     order by peer.name, peer.id`,
    [userId],
  );
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function sharesMeeting(
  db: Db,
  callerId: string,
  otherUserId: string,
): Promise<boolean> {
  if (!callerId || !otherUserId) return false;
  if (callerId === otherUserId) return true;
  const rows = await db.query<{ meeting_id: string }>(
    `select mine.meeting_id
     from (${VERIFIED_ATTENDANCE}) mine
     join (${VERIFIED_ATTENDANCE}) theirs
       on theirs.meeting_id = mine.meeting_id and theirs.user_id = $2
     where mine.user_id = $1
     limit 1`,
    [callerId, otherUserId],
  );
  return Boolean(rows[0]);
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
    identityPublic: string | null;
    backupPublic: string | null;
    devices: (PublicDevice & { prekey: PublicPrekey | null; signedPrekey: PublicPrekey | null })[];
  }>
> {
  if (!isMemberId(targetUserId)) return fail(400, "That member was not found.");
  if (!(await sharesMeeting(db, callerId, targetUserId))) {
    return fail(403, "You can message someone you have been to a meeting with.");
  }
  if (!(await sharesThread(db, callerId, targetUserId))) {
    return fail(403, "Open the conversation before asking for keys.");
  }
  return db.transaction(async (tx) => {
    const devices = await tx.query<DeviceRow>(
      `select * from dm_device where user_id = $1 and revoked_at is null order by created_at`,
      [targetUserId],
    );
    const identity = await tx.query<{ sign_public: string }>(
      `select sign_public from dm_identity where user_id = $1`,
      [targetUserId],
    );
    const backup = await tx.query<{ box_public: string }>(
      `select box_public from dm_backup where user_id = $1`,
      [targetUserId],
    );
    const packed: (PublicDevice & {
      prekey: PublicPrekey | null;
      signedPrekey: PublicPrekey | null;
    })[] = [];
    for (const device of devices) {
      const taken = await tx.query<{ id: string; public_key: string; signature: string }>(
        `with picked as (
           select id from dm_prekey
           where device_id = $1 and used_at is null
           order by id
           for update skip locked
           limit 1
         )
         update dm_prekey set used_at = $2
         from picked
         where dm_prekey.id = picked.id
         returning dm_prekey.id, dm_prekey.public_key, dm_prekey.signature`,
        [device.id, now],
      );
      const prekey = taken[0];
      packed.push({
        ...asPublic(device),
        prekey: prekey
          ? { id: prekey.id, publicKey: prekey.public_key, signature: prekey.signature }
          : null,
        signedPrekey: signedPrekeyFor(device, now),
      });
    }
    return {
      ok: true,
      value: {
        userId: targetUserId,
        identityPublic: identity[0]?.sign_public ?? null,
        backupPublic: backup[0]?.box_public ?? null,
        devices: packed,
      },
    };
  });
}

/** Public keys only. Does not consume a one-time prekey. */
export async function previewBundle(
  db: Db,
  callerId: string,
  targetUserId: string,
): Promise<
  Result<{
    userId: string;
    identityPublic: string | null;
    backupPublic: string | null;
    devices: PublicDevice[];
  }>
> {
  if (!isMemberId(targetUserId)) return fail(400, "That member was not found.");
  if (!(await sharesMeeting(db, callerId, targetUserId))) {
    return fail(403, "You can message someone you have been to a meeting with.");
  }
  if (!(await sharesThread(db, callerId, targetUserId))) {
    return fail(403, "Open the conversation before asking for keys.");
  }
  const devices = await db.query<DeviceRow>(
    `select * from dm_device where user_id = $1 and revoked_at is null order by created_at`,
    [targetUserId],
  );
  const identity = await db.query<{ sign_public: string }>(
    `select sign_public from dm_identity where user_id = $1`,
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
      identityPublic: identity[0]?.sign_public ?? null,
      backupPublic: backup[0]?.box_public ?? null,
      devices: devices.map(asPublic),
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
    `select id, name from "user" where id in ($1, $2)`,
    [userId, otherUserId],
  );
  const other = people.find((person) => person.id === otherUserId);
  const me = people.find((person) => person.id === userId);
  if (!other || !me) return fail(404, "That member was not found.");
  if (!(await sharesMeeting(db, userId, otherUserId))) {
    return fail(403, "You can message someone you have been to a meeting with.");
  }
  const [low, high] = userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
  const lowName = low === userId ? me.name : other.name;
  const highName = high === userId ? me.name : other.name;
  const existing = await db.query<{ id: string }>(
    `select id from dm_thread where user_a = $1 and user_b = $2`,
    [low, high],
  );
  if (existing[0])
    return { ok: true, value: { id: existing[0].id, otherUserId, otherName: other.name } };
  const id = randomUUID();
  await db.query(
    `insert into dm_thread (id, user_a, user_b, user_a_name, user_b_name, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, low, high, lowName, highName, now],
  );
  return { ok: true, value: { id, otherUserId, otherName: other.name } };
}

export async function listThreads(
  db: Db,
  userId: string,
): Promise<{ id: string; otherUserId: string; otherName: string }[]> {
  const rows = await db.query<{ id: string; other_id: string | null; other_name: string }>(
    `select t.id,
            case when t.user_a = $1 then t.user_b else t.user_a end as other_id,
            case
              when t.user_a = $1 then coalesce(ub.name, nullif(t.user_b_name, ''), 'Former member')
              else coalesce(ua.name, nullif(t.user_a_name, ''), 'Former member')
            end as other_name
     from dm_thread t
     left join "user" ua on ua.id = t.user_a
     left join "user" ub on ub.id = t.user_b
     where t.user_a = $1 or t.user_b = $1
     order by t.created_at`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    otherUserId: row.other_id ?? "",
    otherName: row.other_name,
  }));
}

async function threadFor(
  db: Db,
  threadId: string,
  userId: string,
): Promise<{ id: string; user_a: string | null; user_b: string | null } | null> {
  const rows = await db.query<{ id: string; user_a: string | null; user_b: string | null }>(
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
  if (!otherUserId || !(await sharesMeeting(db, userId, otherUserId))) {
    return fail(403, "You can message someone you have been to a meeting with.");
  }
  const devices = await db.query<DeviceRow>(`select * from dm_device where id = $1`, [
    message.senderDeviceId,
  ]);
  const sender = devices[0];
  if (!sender || sender.user_id !== userId || sender.revoked_at)
    return fail(400, "That device was not recognized.");
  if (!(await verifyBodySignature(message, sender.sign_public)))
    return fail(400, "That message was not accepted.");
  const identity = await db.query<{ sign_public: string }>(
    `select sign_public from dm_identity where user_id = $1`,
    [userId],
  );
  const senderIdentityPublic = identity[0]?.sign_public;
  if (!senderIdentityPublic) return fail(400, "That device was not recognized.");

  const reachesOther = await envelopesOk(db, message.envelopes, thread, otherUserId);
  if (!reachesOther.ok) return reachesOther;

  const expires = new Date(now.getTime() + DM_RETENTION_MS);
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into dm_message (
           id, thread_id, sender_user_id, sender_device_id, sender_identity_public, body_nonce, body_ciphertext, body_sig, created_at, expires_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          message.messageId,
          threadId,
          userId,
          message.senderDeviceId,
          senderIdentityPublic,
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
             id, message_id, recipient_device_id, recipient_user_backup, nonce, ciphertext, ephemeral_public, prekey_id, signed_prekey_id
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomUUID(),
            message.messageId,
            envelope.recipientDeviceId,
            envelope.recipientUserBackup,
            envelope.nonce,
            envelope.ciphertext,
            envelope.ephemeralPublic,
            envelope.prekeyId,
            envelope.signedPrekeyId,
          ],
        );
      }
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (/dm_envelope_prekey_once/i.test(text)) {
      return fail(409, "That one-time key was already used.");
    }
    if (isUniqueViolation(error)) return fail(409, "That message was already sent.");
    throw error;
  }
  return { ok: true, value: { id: message.messageId } };
}

async function envelopesOk(
  db: Db,
  envelopes: EnvelopeWire[],
  thread: { user_a: string | null; user_b: string | null },
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
      if (envelope.signedPrekeyId) {
        if (envelope.signedPrekeyId !== device.signed_prekey_id) {
          return fail(400, "That message was not accepted.");
        }
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
      if (envelope.prekeyId || envelope.signedPrekeyId)
        return fail(400, "That message was not accepted.");
      if (envelope.recipientUserBackup === otherUserId) reachesOther = true;
    }
  }
  if (!reachesOther) return fail(400, "Messages are between two people.");
  return { ok: true, value: null };
}

let lastSweepAt = Number.NEGATIVE_INFINITY;
const SWEEP_GAP_MS = 60 * 60 * 1000;

/** Delete expired messages in batches. Not called from the message list itself. */
export async function sweepExpired(db: Db, now: Date): Promise<number> {
  let removed = 0;
  for (let batch = 0; batch < 20; batch += 1) {
    const rows = await db.query<{ id: string }>(
      `delete from dm_message where id in (
         select id from dm_message where expires_at <= $1 order by expires_at limit 200
       ) returning id`,
      [now],
    );
    removed += rows.length;
    if (rows.length < 200) break;
  }
  return removed;
}

/** Run the sweep when the clock has moved at least an hour since the last one. */
export async function sweepIfDue(db: Db, now: Date): Promise<void> {
  const time = now.getTime();
  if (time - lastSweepAt < SWEEP_GAP_MS) return;
  lastSweepAt = time;
  await sweepExpired(db, now);
}

export async function listMessages(
  db: Db,
  userId: string,
  threadId: string,
  now: Date,
): Promise<Result<StoredMessage[]>> {
  if (!isUuid(threadId)) return fail(404, "That conversation was not found.");
  const thread = await threadFor(db, threadId, userId);
  if (!thread) return fail(404, "That conversation was not found.");
  const messages = await db.query<{
    id: string;
    sender_user_id: string | null;
    sender_device_id: string | null;
    sender_identity_public: string | null;
    body_nonce: string;
    body_ciphertext: string;
    body_sig: string;
    created_at: Date | string;
  }>(
    `select id, sender_user_id, sender_device_id, sender_identity_public, body_nonce, body_ciphertext, body_sig, created_at
     from (
       select * from dm_message where thread_id = $1 and expires_at > $2 order by created_at desc limit 200
     ) recent
     order by created_at asc`,
    [threadId, now],
  );
  if (messages.length === 0) return { ok: true, value: [] };
  const deviceIds = [
    ...new Set(
      messages.flatMap((message) => (message.sender_device_id ? [message.sender_device_id] : [])),
    ),
  ];
  const messageIds = messages.map((message) => message.id);
  const devices =
    deviceIds.length === 0
      ? []
      : await db.query<DeviceRow>(
          `select * from dm_device where id in (${placeholders(deviceIds.length)})`,
          deviceIds,
        );
  const envelopes = await db.query<{
    message_id: string;
    recipient_device_id: string | null;
    recipient_user_backup: string | null;
    nonce: string;
    ciphertext: string;
    ephemeral_public: string;
    prekey_id: string | null;
    signed_prekey_id: string | null;
  }>(
    `select message_id, recipient_device_id, recipient_user_backup, nonce, ciphertext, ephemeral_public, prekey_id, signed_prekey_id
     from dm_envelope
     where message_id in (${placeholders(messageIds.length)})`,
    messageIds,
  );
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const stored: StoredMessage[] = [];
  for (const message of messages) {
    const wire = envelopes
      .filter((envelope) => envelope.message_id === message.id)
      .map((envelope) => ({
        recipientDeviceId: envelope.recipient_device_id,
        recipientUserBackup: envelope.recipient_user_backup,
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext,
        ephemeralPublic: envelope.ephemeral_public,
        prekeyId: envelope.prekey_id,
        signedPrekeyId: envelope.signed_prekey_id,
      }));
    const sender = message.sender_device_id ? deviceById.get(message.sender_device_id) : undefined;
    if (!message.sender_device_id || !message.sender_identity_public || !sender) {
      stored.push({
        messageId: message.id,
        threadId,
        senderDeviceId: "",
        senderUserId: "",
        senderIdentityPublic: "",
        former: true,
        createdAt: iso(message.created_at),
        sender: null,
        bodyNonce: message.body_nonce,
        bodyCiphertext: message.body_ciphertext,
        bodySig: message.body_sig,
        envelopes: wire,
      });
      continue;
    }
    stored.push({
      messageId: message.id,
      threadId,
      senderDeviceId: message.sender_device_id,
      senderUserId: message.sender_user_id ?? "",
      senderIdentityPublic: message.sender_identity_public,
      former: false,
      createdAt: iso(message.created_at),
      sender: asPublic(sender),
      bodyNonce: message.body_nonce,
      bodyCiphertext: message.body_ciphertext,
      bodySig: message.body_sig,
      envelopes: wire,
    });
  }
  return { ok: true, value: stored };
}

function placeholders(count: number, offset = 0): string {
  return Array.from({ length: count }, (_, index) => `$${index + 1 + offset}`).join(", ");
}
