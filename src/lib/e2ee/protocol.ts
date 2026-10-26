/**
 * Avouch sealed mail, version 1.
 *
 * Keys are generated here, on the client. The server is given public keys,
 * Ed25519 signatures, and ciphertext. It never receives a private key, a
 * passphrase, or the message text.
 *
 * This is an X3DH-style envelope, not the Signal Double Ratchet:
 * each message uses a fresh X25519 ephemeral key and, when one is left,
 * a one-time prekey. The message key is wrapped with BLAKE2b over those
 * Diffie-Hellman results, then the text is sealed with XSalsa20-Poly1305.
 * A stolen device key does not decrypt old messages whose prekey secrets
 * were deleted. It can still decrypt later messages sent to that device.
 * There is no ratchet heal after a compromise.
 *
 * Every member can also keep a backup X25519 key. Its secret is encrypted
 * with Argon2id and a passphrase before it is uploaded. A new device that
 * opens the backup can read history. The passphrase stays on the device.
 */

import {
  BACKUP_MEMLIMIT_INTERACTIVE,
  BACKUP_MEMLIMIT_MAX,
  BACKUP_MEMLIMIT_MIN,
  BACKUP_OPSLIMIT_INTERACTIVE,
  BACKUP_OPSLIMIT_MAX,
  BACKUP_OPSLIMIT_MIN,
  BODY_CIPHER_MAX_BYTES,
  DM_MAX_ENVELOPES,
  DM_PREKEY_BATCH,
  WRAP_CIPHER_MAX_BYTES,
  dmTextError,
  passphraseError,
} from "./limits.ts";
import { loadSodium, type Sodium as SodiumType } from "./sodium.ts";

type Sodium = SodiumType;

export type PrekeySecret = {
  id: string;
  publicKey: string;
  secretKey: string;
  signature: string;
};

/** Ed25519 identity for one member. It signs every device. The safety number covers it. */
export type IdentityKey = { signPublic: string; signSecret: string };

export type DeviceRecord = {
  deviceId: string;
  label: string;
  signPublic: string;
  signSecret: string;
  boxPublic: string;
  boxSecret: string;
  statementSig: string;
  identityPublic: string;
  identitySecret: string;
  identitySig: string;
  signedPrekey: PrekeySecret;
  previousSignedPrekey: PrekeySecret | null;
  prekeys: PrekeySecret[];
};

export type PublicDevice = {
  deviceId: string;
  signPublic: string;
  boxPublic: string;
  statementSig: string;
  identitySig: string;
};

export type PublicPrekey = {
  id: string;
  publicKey: string;
  signature: string;
};

export type EnvelopeWire = {
  recipientDeviceId: string | null;
  recipientUserBackup: string | null;
  nonce: string;
  ciphertext: string;
  ephemeralPublic: string;
  prekeyId: string | null;
  signedPrekeyId: string | null;
};

export type MessageWire = {
  messageId: string;
  threadId: string;
  senderDeviceId: string;
  bodyNonce: string;
  bodyCiphertext: string;
  bodySig: string;
  envelopes: EnvelopeWire[];
};

export type BackupCipher = {
  kdf: "argon2id";
  opslimit: number;
  memlimit: number;
  salt: string;
  nonce: string;
  ciphertext: string;
};

export type BackupKey = { boxPublic: string; boxSecret: string };

/** Both secrets travel inside the backup ciphertext. The passphrase never does. */
export type BackupSecrets = { boxSecret: string; identitySecret: string };

type Fail = { ok: false; message: string };
type Ok<T> = { ok: true; value: T };

function fail(message: string): Fail {
  return { ok: false, message };
}

async function sodium(): Promise<Sodium> {
  return loadSodium();
}

function encode(lib: Sodium, bytes: Uint8Array): string {
  return lib.to_base64(bytes, lib.base64_variants.ORIGINAL);
}

function decode(lib: Sodium, value: string, maxBytes: number): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxBytes * 2 + 8)
    return null;
  try {
    const bytes = lib.from_base64(value, lib.base64_variants.ORIGINAL);
    if (bytes.length > maxBytes) return null;
    return bytes;
  } catch {
    return null;
  }
}

function decodeFixed(lib: Sodium, value: string, size: number): Uint8Array | null {
  const bytes = decode(lib, value, size);
  if (!bytes || bytes.length !== size) return null;
  return bytes;
}

function wipe(lib: Sodium, ...chunks: Uint8Array[]): void {
  for (const chunk of chunks) lib.memzero(chunk);
}

function dh(lib: Sodium, secret: Uint8Array, pub: Uint8Array): Uint8Array | null {
  try {
    const shared = lib.crypto_scalarmult(secret, pub);
    if (
      shared.length !== lib.crypto_scalarmult_BYTES ||
      shared.every((byte: number) => byte === 0)
    ) {
      return null;
    }
    return shared;
  } catch {
    return null;
  }
}

function derive(lib: Sodium, parts: Uint8Array[]): Uint8Array {
  const state = lib.crypto_generichash_init(null, 32);
  for (const part of parts) {
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, part.length, false);
    lib.crypto_generichash_update(state, prefix);
    lib.crypto_generichash_update(state, part);
  }
  return lib.crypto_generichash_final(state, 32);
}

function utf8(lib: Sodium, value: string): Uint8Array {
  return lib.from_string(value);
}

export function deviceStatement(
  lib: Sodium,
  userId: string,
  deviceId: string,
  signPublic: string,
  boxPublic: string,
): Uint8Array {
  return utf8(lib, `avouch-device-v1\n${userId}\n${deviceId}\n${signPublic}\n${boxPublic}`);
}

export function identityDeviceStatement(
  lib: Sodium,
  userId: string,
  deviceId: string,
  signPublic: string,
  boxPublic: string,
): Uint8Array {
  return utf8(
    lib,
    `avouch-identity-device-v1\n${userId}\n${deviceId}\n${signPublic}\n${boxPublic}`,
  );
}

function prekeyStatement(
  lib: Sodium,
  deviceId: string,
  prekeyId: string,
  publicKey: string,
): Uint8Array {
  return utf8(lib, `avouch-prekey-v1\n${deviceId}\n${prekeyId}\n${publicKey}`);
}

function signedPrekeyStatement(
  lib: Sodium,
  deviceId: string,
  prekeyId: string,
  publicKey: string,
): Uint8Array {
  return utf8(lib, `avouch-signed-prekey-v1\n${deviceId}\n${prekeyId}\n${publicKey}`);
}

/** Sorted wrap lines. The body signature covers this, so a dropped envelope fails. */
export function wrapListCanonical(envelopes: EnvelopeWire[]): string {
  return envelopes
    .map((envelope) => {
      const who = envelope.recipientDeviceId
        ? `device:${envelope.recipientDeviceId}`
        : `backup:${envelope.recipientUserBackup ?? ""}`;
      return `${who}|${envelope.prekeyId ?? ""}|${envelope.signedPrekeyId ?? ""}|${envelope.ephemeralPublic}`;
    })
    .sort()
    .join("\n");
}

function bodyStatement(lib: Sodium, message: MessageWire): Uint8Array {
  return utf8(
    lib,
    `avouch-body-v2\n${message.threadId}\n${message.messageId}\n${message.senderDeviceId}\n${message.bodyNonce}\n${message.bodyCiphertext}\n${wrapListCanonical(message.envelopes)}`,
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Better Auth ids are 32 letters, and tests use uuids. Both are member ids. */
export function isMemberId(value: string): boolean {
  return /^[A-Za-z0-9-]{8,64}$/.test(value);
}

/** The Ed25519 secret is the seed plus the public key. Restore uses that public half. */
export async function identityKeyFromSecret(signSecret: string): Promise<IdentityKey | null> {
  const lib = await sodium();
  const secret = decodeFixed(lib, signSecret, lib.crypto_sign_SECRETKEYBYTES);
  if (!secret || secret.length !== 64) return null;
  const signPublic = encode(lib, secret.subarray(32));
  wipe(lib, secret);
  return { signPublic, signSecret };
}

export async function createIdentity(): Promise<IdentityKey> {
  const lib = await sodium();
  const sign = lib.crypto_sign_keypair();
  const key = { signPublic: encode(lib, sign.publicKey), signSecret: encode(lib, sign.privateKey) };
  wipe(lib, sign.privateKey);
  return key;
}

async function signIdentity(
  identity: IdentityKey,
  userId: string,
  deviceId: string,
  signPublic: string,
  boxPublic: string,
): Promise<string | null> {
  const lib = await sodium();
  const secret = decodeFixed(lib, identity.signSecret, lib.crypto_sign_SECRETKEYBYTES);
  if (!secret) return null;
  const signature = encode(
    lib,
    lib.crypto_sign_detached(
      identityDeviceStatement(lib, userId, deviceId, signPublic, boxPublic),
      secret,
    ),
  );
  wipe(lib, secret);
  return signature;
}

export async function createDevice(input: {
  userId: string;
  label?: string;
  prekeyCount?: number;
  deviceId?: string;
  identity?: IdentityKey;
}): Promise<DeviceRecord> {
  const lib = await sodium();
  const identity = input.identity ?? (await createIdentity());
  const sign = lib.crypto_sign_keypair();
  const box = lib.crypto_box_keypair();
  const deviceId = input.deviceId ?? crypto.randomUUID();
  const signPublic = encode(lib, sign.publicKey);
  const boxPublic = encode(lib, box.publicKey);
  const signSecret = encode(lib, sign.privateKey);
  const boxSecret = encode(lib, box.privateKey);
  const statementSig = encode(
    lib,
    lib.crypto_sign_detached(
      deviceStatement(lib, input.userId, deviceId, signPublic, boxPublic),
      sign.privateKey,
    ),
  );
  const identitySig = await signIdentity(identity, input.userId, deviceId, signPublic, boxPublic);
  if (!identitySig) {
    wipe(lib, sign.privateKey, box.privateKey);
    throw new Error("The identity key is not valid.");
  }
  const device: DeviceRecord = {
    deviceId,
    label: (input.label ?? "This browser").slice(0, 40),
    signPublic,
    signSecret,
    boxPublic,
    boxSecret,
    statementSig,
    identityPublic: identity.signPublic,
    identitySecret: identity.signSecret,
    identitySig,
    signedPrekey: {
      id: crypto.randomUUID(),
      publicKey: "",
      secretKey: "",
      signature: "",
    },
    previousSignedPrekey: null,
    prekeys: [],
  };
  device.signedPrekey = await createSignedPrekey(device);
  device.prekeys = await createPrekeys(device, input.prekeyCount ?? DM_PREKEY_BATCH);
  wipe(lib, sign.privateKey, box.privateKey);
  return device;
}

export async function createSignedPrekey(device: DeviceRecord): Promise<PrekeySecret> {
  const lib = await sodium();
  const signSecret = decodeFixed(lib, device.signSecret, lib.crypto_sign_SECRETKEYBYTES);
  if (!signSecret) throw new Error("The keys on this device are not valid.");
  const pair = lib.crypto_box_keypair();
  const id = crypto.randomUUID();
  const publicKey = encode(lib, pair.publicKey);
  const signature = encode(
    lib,
    lib.crypto_sign_detached(
      signedPrekeyStatement(lib, device.deviceId, id, publicKey),
      signSecret,
    ),
  );
  const prekey = { id, publicKey, secretKey: encode(lib, pair.privateKey), signature };
  wipe(lib, pair.privateKey, signSecret);
  return prekey;
}

export async function createPrekeys(device: DeviceRecord, count: number): Promise<PrekeySecret[]> {
  const lib = await sodium();
  const signSecret = decodeFixed(lib, device.signSecret, lib.crypto_sign_SECRETKEYBYTES);
  if (!signSecret) return [];
  const prekeys: PrekeySecret[] = [];
  for (let i = 0; i < count; i += 1) {
    const pair = lib.crypto_box_keypair();
    const id = crypto.randomUUID();
    const publicKey = encode(lib, pair.publicKey);
    const signature = encode(
      lib,
      lib.crypto_sign_detached(prekeyStatement(lib, device.deviceId, id, publicKey), signSecret),
    );
    prekeys.push({
      id,
      publicKey,
      secretKey: encode(lib, pair.privateKey),
      signature,
    });
    wipe(lib, pair.privateKey);
  }
  wipe(lib, signSecret);
  return prekeys;
}

export async function verifyDeviceStatement(
  userId: string,
  device: PublicDevice,
): Promise<boolean> {
  const lib = await sodium();
  const signPublic = decodeFixed(lib, device.signPublic, lib.crypto_sign_PUBLICKEYBYTES);
  const boxPublic = decodeFixed(lib, device.boxPublic, lib.crypto_box_PUBLICKEYBYTES);
  const signature = decodeFixed(lib, device.statementSig, lib.crypto_sign_BYTES);
  if (!signPublic || !boxPublic || !signature || !isUuid(device.deviceId)) return false;
  try {
    return lib.crypto_sign_verify_detached(
      signature,
      deviceStatement(lib, userId, device.deviceId, device.signPublic, device.boxPublic),
      signPublic,
    );
  } catch {
    return false;
  }
}

export async function verifyIdentitySignature(
  identityPublic: string,
  userId: string,
  device: PublicDevice,
): Promise<boolean> {
  const lib = await sodium();
  const identity = decodeFixed(lib, identityPublic, lib.crypto_sign_PUBLICKEYBYTES);
  const signature = decodeFixed(lib, device.identitySig, lib.crypto_sign_BYTES);
  if (!identity || !signature || !isUuid(device.deviceId)) return false;
  try {
    return lib.crypto_sign_verify_detached(
      signature,
      identityDeviceStatement(lib, userId, device.deviceId, device.signPublic, device.boxPublic),
      identity,
    );
  } catch {
    return false;
  }
}

export async function verifySignedPrekey(
  deviceId: string,
  signPublicB64: string,
  prekey: PublicPrekey,
): Promise<boolean> {
  const lib = await sodium();
  const signPublic = decodeFixed(lib, signPublicB64, lib.crypto_sign_PUBLICKEYBYTES);
  const publicKey = decodeFixed(lib, prekey.publicKey, lib.crypto_box_PUBLICKEYBYTES);
  const signature = decodeFixed(lib, prekey.signature, lib.crypto_sign_BYTES);
  if (!signPublic || !publicKey || !signature || !isUuid(deviceId) || !isUuid(prekey.id))
    return false;
  try {
    return lib.crypto_sign_verify_detached(
      signature,
      signedPrekeyStatement(lib, deviceId, prekey.id, prekey.publicKey),
      signPublic,
    );
  } catch {
    return false;
  }
}

export async function verifyPrekey(
  deviceId: string,
  signPublicB64: string,
  prekey: PublicPrekey,
): Promise<boolean> {
  const lib = await sodium();
  const signPublic = decodeFixed(lib, signPublicB64, lib.crypto_sign_PUBLICKEYBYTES);
  const publicKey = decodeFixed(lib, prekey.publicKey, lib.crypto_box_PUBLICKEYBYTES);
  const signature = decodeFixed(lib, prekey.signature, lib.crypto_sign_BYTES);
  if (!signPublic || !publicKey || !signature || !isUuid(deviceId) || !isUuid(prekey.id))
    return false;
  try {
    return lib.crypto_sign_verify_detached(
      signature,
      prekeyStatement(lib, deviceId, prekey.id, prekey.publicKey),
      signPublic,
    );
  } catch {
    return false;
  }
}

export async function verifyBodySignature(
  message: MessageWire,
  signPublicB64: string,
): Promise<boolean> {
  const lib = await sodium();
  const signPublic = decodeFixed(lib, signPublicB64, lib.crypto_sign_PUBLICKEYBYTES);
  const signature = decodeFixed(lib, message.bodySig, lib.crypto_sign_BYTES);
  const nonce = decodeFixed(lib, message.bodyNonce, lib.crypto_secretbox_NONCEBYTES);
  const body = decode(lib, message.bodyCiphertext, BODY_CIPHER_MAX_BYTES);
  if (!signPublic || !signature || !nonce || !body) return false;
  if (body.length <= lib.crypto_secretbox_MACBYTES) return false;
  try {
    return lib.crypto_sign_verify_detached(signature, bodyStatement(lib, message), signPublic);
  } catch {
    return false;
  }
}

export async function createBackupKey(): Promise<BackupKey> {
  const lib = await sodium();
  const pair = lib.crypto_box_keypair();
  const key = { boxPublic: encode(lib, pair.publicKey), boxSecret: encode(lib, pair.privateKey) };
  wipe(lib, pair.privateKey);
  return key;
}

export function backupPlaintext(secrets: BackupSecrets): string {
  return `avouch-backup-v2\n${secrets.boxSecret}\n${secrets.identitySecret}`;
}

export async function encryptBackupSecret(
  secrets: BackupSecrets,
  passphrase: string,
): Promise<Ok<BackupCipher> | Fail> {
  const problem = passphraseError(passphrase);
  if (problem) return fail(problem);
  const lib = await sodium();
  const box = decodeFixed(lib, secrets.boxSecret, lib.crypto_box_SECRETKEYBYTES);
  const identity = decodeFixed(lib, secrets.identitySecret, lib.crypto_sign_SECRETKEYBYTES);
  if (!box || !identity) return fail("The backup key is not valid.");
  const opslimit = BACKUP_OPSLIMIT_INTERACTIVE;
  const memlimit = BACKUP_MEMLIMIT_INTERACTIVE;
  const secret = utf8(lib, backupPlaintext(secrets));
  const salt = lib.randombytes_buf(lib.crypto_pwhash_SALTBYTES);
  const nonce = lib.randombytes_buf(lib.crypto_secretbox_NONCEBYTES);
  const key = lib.crypto_pwhash(
    32,
    passphrase,
    salt,
    opslimit,
    memlimit,
    lib.crypto_pwhash_ALG_ARGON2ID13,
  );
  const ciphertext = lib.crypto_secretbox_easy(secret, nonce, key);
  const record: BackupCipher = {
    kdf: "argon2id",
    opslimit,
    memlimit,
    salt: encode(lib, salt),
    nonce: encode(lib, nonce),
    ciphertext: encode(lib, ciphertext),
  };
  wipe(lib, box, identity, secret, key);
  return { ok: true, value: record };
}

export async function decryptBackupSecret(
  record: BackupCipher,
  passphrase: string,
): Promise<BackupSecrets | null> {
  if (passphraseError(passphrase)) return null;
  if (record.kdf !== "argon2id") return null;
  if (
    !Number.isInteger(record.opslimit) ||
    record.opslimit < BACKUP_OPSLIMIT_MIN ||
    record.opslimit > BACKUP_OPSLIMIT_MAX
  ) {
    return null;
  }
  if (
    !Number.isInteger(record.memlimit) ||
    record.memlimit < BACKUP_MEMLIMIT_MIN ||
    record.memlimit > BACKUP_MEMLIMIT_MAX
  ) {
    return null;
  }
  const lib = await sodium();
  const salt = decodeFixed(lib, record.salt, lib.crypto_pwhash_SALTBYTES);
  const nonce = decodeFixed(lib, record.nonce, lib.crypto_secretbox_NONCEBYTES);
  const ciphertext = decode(lib, record.ciphertext, 512);
  if (!salt || !nonce || !ciphertext) return null;
  let key: Uint8Array | null = null;
  try {
    key = lib.crypto_pwhash(
      32,
      passphrase,
      salt,
      record.opslimit,
      record.memlimit,
      lib.crypto_pwhash_ALG_ARGON2ID13,
    );
    const secret = lib.crypto_secretbox_open_easy(ciphertext, nonce, key);
    const text = lib.to_string(secret);
    wipe(lib, secret);
    const lines = text.split("\n");
    if (lines.length !== 3 || lines[0] !== "avouch-backup-v2") return null;
    const boxSecret = lines[1] ?? "";
    const identitySecret = lines[2] ?? "";
    if (!decodeFixed(lib, boxSecret, lib.crypto_box_SECRETKEYBYTES)) return null;
    if (!decodeFixed(lib, identitySecret, lib.crypto_sign_SECRETKEYBYTES)) return null;
    return { boxSecret, identitySecret };
  } catch {
    return null;
  } finally {
    if (key) wipe(lib, key);
  }
}

export type SealDestination =
  | {
      kind: "device";
      userId: string;
      identityPublic: string;
      device: PublicDevice;
      prekey: PublicPrekey | null;
      signedPrekey: PublicPrekey | null;
    }
  | { kind: "backup"; userId: string; boxPublic: string };

async function destinationsOk(destinations: SealDestination[]): Promise<string | null> {
  for (const destination of destinations) {
    if (destination.kind !== "device") continue;
    if (!(await verifyDeviceStatement(destination.userId, destination.device))) {
      return "A device key did not check out. The message was not sent.";
    }
    if (
      !(await verifyIdentitySignature(
        destination.identityPublic,
        destination.userId,
        destination.device,
      ))
    ) {
      return "A device key did not check out. The message was not sent.";
    }
    if (
      destination.prekey &&
      !(await verifyPrekey(
        destination.device.deviceId,
        destination.device.signPublic,
        destination.prekey,
      ))
    ) {
      return "A one-time key did not check out. The message was not sent.";
    }
    const signed = destination.prekey ? null : destination.signedPrekey;
    if (!destination.prekey && !signed)
      return "A signed prekey is missing. The message was not sent.";
    if (
      signed &&
      !(await verifySignedPrekey(
        destination.device.deviceId,
        destination.device.signPublic,
        signed,
      ))
    ) {
      return "A signed prekey did not check out. The message was not sent.";
    }
  }
  return null;
}

function zeros(size: number): Uint8Array {
  return new Uint8Array(size);
}

async function wrapKey(
  lib: Sodium,
  messageKey: Uint8Array,
  senderBoxSecret: Uint8Array,
  senderBoxPublic: string,
  recipientBoxPublic: string,
  prekeyPublic: string | null,
  message: Pick<MessageWire, "messageId" | "threadId">,
  recipientTag: string,
): Promise<{ nonce: string; ciphertext: string; ephemeralPublic: string } | null> {
  const recipientPub = decodeFixed(lib, recipientBoxPublic, lib.crypto_box_PUBLICKEYBYTES);
  const senderPub = decodeFixed(lib, senderBoxPublic, lib.crypto_box_PUBLICKEYBYTES);
  const prekeyPub = prekeyPublic
    ? decodeFixed(lib, prekeyPublic, lib.crypto_box_PUBLICKEYBYTES)
    : null;
  if (!recipientPub || !senderPub || (prekeyPublic && !prekeyPub)) return null;
  const ephemeral = lib.crypto_box_keypair();
  const dh1 = dh(lib, ephemeral.privateKey, recipientPub);
  const dh2 = dh(lib, senderBoxSecret, recipientPub);
  const dh3 = prekeyPub
    ? dh(lib, ephemeral.privateKey, prekeyPub)
    : zeros(lib.crypto_scalarmult_BYTES);
  if (!dh1 || !dh2 || !dh3) {
    wipe(lib, ephemeral.privateKey);
    return null;
  }
  const shared = derive(lib, [
    utf8(lib, "avouch-envelope-v1"),
    dh1,
    dh2,
    dh3,
    senderPub,
    recipientPub,
    ephemeral.publicKey,
    prekeyPub ?? zeros(lib.crypto_box_PUBLICKEYBYTES),
    utf8(lib, message.messageId),
    utf8(lib, message.threadId),
    utf8(lib, recipientTag),
  ]);
  const nonce = lib.randombytes_buf(lib.crypto_secretbox_NONCEBYTES);
  const ciphertext = lib.crypto_secretbox_easy(messageKey, nonce, shared);
  const wrapped = {
    nonce: encode(lib, nonce),
    ciphertext: encode(lib, ciphertext),
    ephemeralPublic: encode(lib, ephemeral.publicKey),
  };
  wipe(lib, ephemeral.privateKey, dh1, dh2, dh3, shared);
  return wrapped;
}

function prekeyChoice(destination: SealDestination): {
  publicKey: string | null;
  prekeyId: string | null;
  signedPrekeyId: string | null;
} {
  if (destination.kind !== "device")
    return { publicKey: null, prekeyId: null, signedPrekeyId: null };
  if (destination.prekey) {
    return {
      publicKey: destination.prekey.publicKey,
      prekeyId: destination.prekey.id,
      signedPrekeyId: null,
    };
  }
  return {
    publicKey: destination.signedPrekey?.publicKey ?? null,
    prekeyId: null,
    signedPrekeyId: destination.signedPrekey?.id ?? null,
  };
}

async function wrapDestination(
  lib: Sodium,
  messageKey: Uint8Array,
  senderBoxSecret: Uint8Array,
  senderBoxPublic: string,
  message: Pick<MessageWire, "messageId" | "threadId">,
  destination: SealDestination,
): Promise<EnvelopeWire | null> {
  const recipientBoxPublic =
    destination.kind === "device" ? destination.device.boxPublic : destination.boxPublic;
  const chosen = prekeyChoice(destination);
  const tag =
    destination.kind === "device"
      ? `device:${destination.device.deviceId}`
      : `backup:${destination.userId}`;
  const wrapped = await wrapKey(
    lib,
    messageKey,
    senderBoxSecret,
    senderBoxPublic,
    recipientBoxPublic,
    chosen.publicKey,
    message,
    tag,
  );
  if (!wrapped) return null;
  return {
    recipientDeviceId: destination.kind === "device" ? destination.device.deviceId : null,
    recipientUserBackup: destination.kind === "backup" ? destination.userId : null,
    nonce: wrapped.nonce,
    ciphertext: wrapped.ciphertext,
    ephemeralPublic: wrapped.ephemeralPublic,
    prekeyId: chosen.prekeyId,
    signedPrekeyId: chosen.signedPrekeyId,
  };
}

export async function sealMessage(input: {
  messageId: string;
  threadId: string;
  sender: DeviceRecord;
  text: string;
  destinations: SealDestination[];
}): Promise<Ok<MessageWire> | Fail> {
  const problem = dmTextError(input.text);
  if (problem) return fail(problem);
  if (!isUuid(input.messageId) || !isUuid(input.threadId))
    return fail("That message was not accepted.");
  if (input.destinations.length === 0) return fail("That member has no device yet.");
  const lib = await sodium();
  const senderBoxSecret = decodeFixed(lib, input.sender.boxSecret, lib.crypto_box_SECRETKEYBYTES);
  const signSecret = decodeFixed(lib, input.sender.signSecret, lib.crypto_sign_SECRETKEYBYTES);
  if (!senderBoxSecret || !signSecret) return fail("The keys on this device are not valid.");

  const refused = await destinationsOk(input.destinations);
  if (refused) {
    wipe(lib, senderBoxSecret, signSecret);
    return fail(refused);
  }

  const messageKey = lib.randombytes_buf(lib.crypto_secretbox_KEYBYTES);
  const bodyNonce = lib.randombytes_buf(lib.crypto_secretbox_NONCEBYTES);
  const body = lib.crypto_secretbox_easy(utf8(lib, input.text.trim()), bodyNonce, messageKey);
  const wire: MessageWire = {
    messageId: input.messageId,
    threadId: input.threadId,
    senderDeviceId: input.sender.deviceId,
    bodyNonce: encode(lib, bodyNonce),
    bodyCiphertext: encode(lib, body),
    bodySig: "",
    envelopes: [],
  };

  for (const destination of input.destinations) {
    const wrapped = await wrapDestination(
      lib,
      messageKey,
      senderBoxSecret,
      input.sender.boxPublic,
      wire,
      destination,
    );
    if (!wrapped) {
      wipe(lib, senderBoxSecret, signSecret, messageKey);
      return fail("The message could not be sealed.");
    }
    wire.envelopes.push(wrapped);
  }
  wire.bodySig = encode(lib, lib.crypto_sign_detached(bodyStatement(lib, wire), signSecret));

  wipe(lib, senderBoxSecret, signSecret, messageKey);
  return { ok: true, value: wire };
}

/** Wrap a picture or video key for the same devices as a text message. */
export async function sealContentKey(input: {
  mediaId: string;
  binding: string;
  sender: DeviceRecord;
  contentKey: Uint8Array;
  destinations: SealDestination[];
}): Promise<Ok<EnvelopeWire[]> | Fail> {
  if (!isUuid(input.mediaId) || input.binding.length < 1 || input.binding.length > 400) {
    return fail("That picture could not be sealed.");
  }
  if (input.destinations.length === 0) return fail("That member has no device yet.");
  if (input.destinations.length > DM_MAX_ENVELOPES) return fail("That wrapped key is too long.");
  const lib = await sodium();
  if (input.contentKey.length !== lib.crypto_secretbox_KEYBYTES) {
    return fail("That picture could not be sealed.");
  }
  const senderBoxSecret = decodeFixed(lib, input.sender.boxSecret, lib.crypto_box_SECRETKEYBYTES);
  if (!senderBoxSecret) return fail("The keys on this device are not valid.");

  const refused = await destinationsOk(input.destinations);
  if (refused) {
    wipe(lib, senderBoxSecret);
    return fail(refused);
  }

  const wire = { messageId: input.mediaId, threadId: input.binding };
  const envelopes: EnvelopeWire[] = [];
  for (const destination of input.destinations) {
    const wrapped = await wrapDestination(
      lib,
      input.contentKey,
      senderBoxSecret,
      input.sender.boxPublic,
      wire,
      destination,
    );
    if (!wrapped) {
      wipe(lib, senderBoxSecret);
      return fail("That picture could not be sealed.");
    }
    envelopes.push(wrapped);
  }
  wipe(lib, senderBoxSecret);
  return { ok: true, value: envelopes };
}

function findDeviceEnvelope(message: MessageWire, deviceId: string): EnvelopeWire | null {
  return message.envelopes.find((envelope) => envelope.recipientDeviceId === deviceId) ?? null;
}

function findBackupEnvelope(message: MessageWire, userId: string): EnvelopeWire | null {
  return (
    message.envelopes.find(
      (envelope) => envelope.recipientDeviceId === null && envelope.recipientUserBackup === userId,
    ) ?? null
  );
}

async function openWrap(
  lib: Sodium,
  envelope: EnvelopeWire,
  senderBoxPublic: string,
  recipientBoxSecret: Uint8Array,
  recipientBoxPublic: string,
  prekey: { publicKey: string; secretKey: string } | null,
  message: Pick<MessageWire, "messageId" | "threadId">,
  recipientTag: string,
): Promise<Uint8Array | null> {
  const senderPub = decodeFixed(lib, senderBoxPublic, lib.crypto_box_PUBLICKEYBYTES);
  const recipientPub = decodeFixed(lib, recipientBoxPublic, lib.crypto_box_PUBLICKEYBYTES);
  const ephemeralPub = decodeFixed(lib, envelope.ephemeralPublic, lib.crypto_box_PUBLICKEYBYTES);
  const nonce = decodeFixed(lib, envelope.nonce, lib.crypto_secretbox_NONCEBYTES);
  const ciphertext = decode(lib, envelope.ciphertext, WRAP_CIPHER_MAX_BYTES);
  const prekeySecret = prekey
    ? decodeFixed(lib, prekey.secretKey, lib.crypto_box_SECRETKEYBYTES)
    : null;
  const prekeyPub = prekey
    ? decodeFixed(lib, prekey.publicKey, lib.crypto_box_PUBLICKEYBYTES)
    : null;
  if (!senderPub || !recipientPub || !ephemeralPub || !nonce || !ciphertext) return null;
  if (prekey && (!prekeySecret || !prekeyPub)) return null;
  const namesPrekey = Boolean(envelope.prekeyId || envelope.signedPrekeyId);
  if (namesPrekey !== Boolean(prekey)) return null;
  const dh1 = dh(lib, recipientBoxSecret, ephemeralPub);
  const dh2 = dh(lib, recipientBoxSecret, senderPub);
  const dh3 = prekeySecret
    ? dh(lib, prekeySecret, ephemeralPub)
    : zeros(lib.crypto_scalarmult_BYTES);
  if (!dh1 || !dh2 || !dh3) {
    if (prekeySecret) wipe(lib, prekeySecret);
    return null;
  }
  const shared = derive(lib, [
    utf8(lib, "avouch-envelope-v1"),
    dh1,
    dh2,
    dh3,
    senderPub,
    recipientPub,
    ephemeralPub,
    prekeyPub ?? zeros(lib.crypto_box_PUBLICKEYBYTES),
    utf8(lib, message.messageId),
    utf8(lib, message.threadId),
    utf8(lib, recipientTag),
  ]);
  try {
    const messageKey = lib.crypto_secretbox_open_easy(ciphertext, nonce, shared);
    if (messageKey.length !== lib.crypto_secretbox_KEYBYTES) return null;
    return messageKey;
  } catch {
    return null;
  } finally {
    wipe(lib, dh1, dh2, dh3, shared);
    if (prekeySecret) wipe(lib, prekeySecret);
  }
}

function prekeyOnDevice(
  device: DeviceRecord,
  envelope: EnvelopeWire,
  spentPrekeyIds: string[],
): { prekey: PrekeySecret | null; skip: boolean; reused: boolean } {
  if (envelope.prekeyId) {
    const prekey = device.prekeys.find((item) => item.id === envelope.prekeyId) ?? null;
    if (!prekey)
      return { prekey: null, skip: true, reused: spentPrekeyIds.includes(envelope.prekeyId) };
    return { prekey, skip: false, reused: false };
  }
  if (envelope.signedPrekeyId) {
    const prekey =
      device.signedPrekey.id === envelope.signedPrekeyId
        ? device.signedPrekey
        : device.previousSignedPrekey?.id === envelope.signedPrekeyId
          ? device.previousSignedPrekey
          : null;
    if (!prekey) return { prekey: null, skip: true, reused: false };
    return { prekey, skip: false, reused: false };
  }
  return { prekey: null, skip: false, reused: false };
}

export async function openMessage(input: {
  message: MessageWire;
  senderUserId: string;
  senderIdentityPublic: string;
  sender: PublicDevice;
  recipientDevice: DeviceRecord | null;
  backup: (BackupKey & { userId: string }) | null;
  spentPrekeyIds?: string[];
}): Promise<{ ok: true; text: string; consumedPrekeyId: string | null } | Fail> {
  if (input.sender.deviceId !== input.message.senderDeviceId)
    return fail("This message could not be read.");
  if (!(await verifyDeviceStatement(input.senderUserId, input.sender))) {
    return fail("This message could not be read.");
  }
  if (
    !(await verifyIdentitySignature(input.senderIdentityPublic, input.senderUserId, input.sender))
  ) {
    return fail("This message could not be read.");
  }
  if (!(await verifyBodySignature(input.message, input.sender.signPublic))) {
    return fail("This message could not be read.");
  }
  const spent = input.spentPrekeyIds ?? [];
  const ownListed =
    !input.recipientDevice ||
    input.message.envelopes.some(
      (envelope) => envelope.recipientDeviceId === input.recipientDevice?.deviceId,
    );
  if (input.recipientDevice && !ownListed && !input.backup) {
    return fail("This message could not be read.");
  }
  const lib = await sodium();
  const attempts: {
    envelope: EnvelopeWire;
    secret: Uint8Array;
    publicKey: string;
    prekey: PrekeySecret | null;
    tag: string;
  }[] = [];
  let reusedPrekey = false;

  if (input.recipientDevice && ownListed) {
    const envelope = findDeviceEnvelope(input.message, input.recipientDevice.deviceId);
    const secret = envelope
      ? decodeFixed(lib, input.recipientDevice.boxSecret, lib.crypto_box_SECRETKEYBYTES)
      : null;
    if (envelope && secret) {
      const found = prekeyOnDevice(input.recipientDevice, envelope, spent);
      if (found.reused) reusedPrekey = true;
      if (found.skip) {
        wipe(lib, secret);
      } else {
        attempts.push({
          envelope,
          secret,
          publicKey: input.recipientDevice.boxPublic,
          prekey: found.prekey,
          tag: `device:${input.recipientDevice.deviceId}`,
        });
      }
    }
  }

  if (input.backup) {
    const backupEnvelope = findBackupEnvelope(input.message, input.backup.userId);
    if (backupEnvelope) {
      const secret = decodeFixed(lib, input.backup.boxSecret, lib.crypto_box_SECRETKEYBYTES);
      if (secret) {
        attempts.push({
          envelope: backupEnvelope,
          secret,
          publicKey: input.backup.boxPublic,
          prekey: null,
          tag: `backup:${input.backup.userId}`,
        });
      }
    }
  }

  const bodyNonce = decodeFixed(lib, input.message.bodyNonce, lib.crypto_secretbox_NONCEBYTES);
  const body = decode(lib, input.message.bodyCiphertext, BODY_CIPHER_MAX_BYTES);
  if (!bodyNonce || !body) {
    for (const attempt of attempts) wipe(lib, attempt.secret);
    return fail("This message could not be read.");
  }

  for (const attempt of attempts) {
    if (attempt.envelope.prekeyId && !attempt.prekey) {
      wipe(lib, attempt.secret);
      continue;
    }
    const messageKey = await openWrap(
      lib,
      attempt.envelope,
      input.sender.boxPublic,
      attempt.secret,
      attempt.publicKey,
      attempt.prekey,
      input.message,
      attempt.tag,
    );
    wipe(lib, attempt.secret);
    if (!messageKey) continue;
    try {
      const plain = lib.crypto_secretbox_open_easy(body, bodyNonce, messageKey);
      const text = lib.to_string(plain);
      wipe(lib, plain, messageKey);
      return {
        ok: true,
        text,
        consumedPrekeyId: attempt.envelope.prekeyId ? (attempt.prekey?.id ?? null) : null,
      };
    } catch {
      wipe(lib, messageKey);
    }
  }
  if (reusedPrekey) return fail("A one-time key was reused.");
  return fail("This message could not be read.");
}

/** Open a picture or video key that `sealContentKey` wrapped. */
export async function openContentKey(input: {
  mediaId: string;
  binding: string;
  envelopes: EnvelopeWire[];
  senderBoxPublic: string;
  recipientDevice: DeviceRecord | null;
  backup: (BackupKey & { userId: string }) | null;
}): Promise<{ ok: true; key: Uint8Array; consumedPrekeyId: string | null } | Fail> {
  if (!isUuid(input.mediaId) || input.binding.length < 1) {
    return fail("That picture could not be read.");
  }
  const lib = await sodium();
  const message = { messageId: input.mediaId, threadId: input.binding };
  const attempts: {
    envelope: EnvelopeWire;
    secret: Uint8Array;
    publicKey: string;
    prekey: PrekeySecret | null;
    tag: string;
  }[] = [];

  if (input.recipientDevice) {
    const envelope =
      input.envelopes.find((item) => item.recipientDeviceId === input.recipientDevice?.deviceId) ??
      null;
    const secret = envelope
      ? decodeFixed(lib, input.recipientDevice.boxSecret, lib.crypto_box_SECRETKEYBYTES)
      : null;
    if (envelope && secret) {
      const found = prekeyOnDevice(input.recipientDevice, envelope, []);
      if (found.skip) {
        wipe(lib, secret);
      } else {
        attempts.push({
          envelope,
          secret,
          publicKey: input.recipientDevice.boxPublic,
          prekey: found.prekey,
          tag: `device:${input.recipientDevice.deviceId}`,
        });
      }
    }
  }

  if (input.backup) {
    const backupEnvelope =
      input.envelopes.find(
        (item) =>
          item.recipientDeviceId === null && item.recipientUserBackup === input.backup?.userId,
      ) ?? null;
    if (backupEnvelope) {
      const secret = decodeFixed(lib, input.backup.boxSecret, lib.crypto_box_SECRETKEYBYTES);
      if (secret) {
        attempts.push({
          envelope: backupEnvelope,
          secret,
          publicKey: input.backup.boxPublic,
          prekey: null,
          tag: `backup:${input.backup.userId}`,
        });
      }
    }
  }

  for (const attempt of attempts) {
    if (attempt.envelope.prekeyId && !attempt.prekey) {
      wipe(lib, attempt.secret);
      continue;
    }
    const key = await openWrap(
      lib,
      attempt.envelope,
      input.senderBoxPublic,
      attempt.secret,
      attempt.publicKey,
      attempt.prekey,
      message,
      attempt.tag,
    );
    wipe(lib, attempt.secret);
    if (!key) continue;
    return { ok: true, key, consumedPrekeyId: attempt.prekey?.id ?? null };
  }
  return fail("That picture could not be read.");
}

export async function isBoxPublic(value: string): Promise<boolean> {
  const lib = await sodium();
  return decodeFixed(lib, value, lib.crypto_box_PUBLICKEYBYTES) !== null;
}

/** The backup upload is ciphertext plus the Argon2id parameters. No passphrase. */
export async function backupRecordOk(boxPublic: string, record: BackupCipher): Promise<boolean> {
  if (record.kdf !== "argon2id") return false;
  if (
    !Number.isInteger(record.opslimit) ||
    record.opslimit < BACKUP_OPSLIMIT_MIN ||
    record.opslimit > BACKUP_OPSLIMIT_MAX
  ) {
    return false;
  }
  if (
    !Number.isInteger(record.memlimit) ||
    record.memlimit < BACKUP_MEMLIMIT_MIN ||
    record.memlimit > BACKUP_MEMLIMIT_MAX
  ) {
    return false;
  }
  const lib = await sodium();
  const salt = decodeFixed(lib, record.salt, lib.crypto_pwhash_SALTBYTES);
  const nonce = decodeFixed(lib, record.nonce, lib.crypto_secretbox_NONCEBYTES);
  const sample = backupPlaintext({
    boxSecret: encode(lib, new Uint8Array(lib.crypto_box_SECRETKEYBYTES)),
    identitySecret: encode(lib, new Uint8Array(lib.crypto_sign_SECRETKEYBYTES)),
  });
  const expected = utf8(lib, sample).length + lib.crypto_secretbox_MACBYTES;
  const ciphertext = decode(lib, record.ciphertext, expected);
  return Boolean(
    (await isBoxPublic(boxPublic)) && salt && nonce && ciphertext && ciphertext.length === expected,
  );
}

export type SafetyParty = {
  identityPublic: string;
  /** Empty when this person has no backup key. A change here changes the number. */
  backupPublic?: string | null;
  devices: { deviceId: string; signPublic: string }[];
};

function safetyCanon(party: SafetyParty): string {
  const devices = [...party.devices].sort((left, right) =>
    left.deviceId < right.deviceId ? -1 : left.deviceId > right.deviceId ? 1 : 0,
  );
  return `${party.identityPublic}\n${party.backupPublic ?? ""}\n${devices.map((device) => `${device.deviceId}|${device.signPublic}`).join("\n")}`;
}

export async function safetyNumber(
  first: SafetyParty,
  second: SafetyParty,
): Promise<string | null> {
  const lib = await sodium();
  for (const party of [first, second]) {
    if (!decodeFixed(lib, party.identityPublic, lib.crypto_sign_PUBLICKEYBYTES)) return null;
    const backup = party.backupPublic ?? "";
    if (backup && !(await isBoxPublic(backup))) return null;
    for (const device of party.devices) {
      if (!isUuid(device.deviceId)) return null;
      if (!decodeFixed(lib, device.signPublic, lib.crypto_sign_PUBLICKEYBYTES)) return null;
    }
  }
  const [low, high] = [safetyCanon(first), safetyCanon(second)].sort();
  const hash = lib.crypto_generichash(30, utf8(lib, `avouch-safety-v3\n${low}\n${high}`));
  const groups: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    let value = 0;
    for (let j = 0; j < 5; j += 1) value = (value * 256 + hash[i * 5 + j]) % 100_000;
    groups.push(String(value).padStart(5, "0"));
  }
  return groups.join(" ");
}
