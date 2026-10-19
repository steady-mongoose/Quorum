/**
 * DmMediaCrypto for direct-message pictures and video.
 *
 * The media page owns the registry (`registerDmMediaCrypto` in
 * src/lib/media/e2e.ts). This object is what that registry should hold:
 * `seal` and `open`, and an opaque `keyEnvelope` of at most 4096 characters.
 * `installDmMediaCrypto` registers it when that module is in the build.
 *
 * The file bytes are stripped on this device first. See media-strip.ts for
 * the container metadata that is removed and for what a video can still carry.
 * The content key is then sealed to both members' devices and key backups
 * with the same envelope as a text message. The server is given ciphertext
 * and the opaque envelope. It does not get the content key.
 */

import {
  isMemberId,
  isUuid,
  openContentKey,
  sealContentKey,
  verifyDeviceStatement,
  verifyIdentitySignature,
  wrapListCanonical,
} from "./protocol.ts";
import { stripBeforeSeal } from "./media-strip.ts";
import { loadSodium, type Sodium } from "./sodium.ts";
import {
  messageDestinations,
  openEncryptedThread,
  type DmTransport,
  type VaultStore,
} from "./mailbox.ts";

/** The media contract's cap. The server stores this string and does not parse it. */
export const KEY_ENVELOPE_MAX = 4096;

const IMAGE_BYTES = 8 * 1024 * 1024;
const VIDEO_BYTES = 32 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);

export type DmMediaSealInput = {
  bytes: Uint8Array;
  kind: "image" | "video";
  contentType: string;
  peerUserId: string;
};

export type DmMediaSealed = {
  ciphertext: Uint8Array;
  keyEnvelope: string;
};

export type DmMediaCrypto = {
  seal(input: DmMediaSealInput): Promise<DmMediaSealed>;
  open(input: {
    ciphertext: Uint8Array;
    keyEnvelope: string;
    peerUserId: string;
  }): Promise<Uint8Array>;
};

type DecodedEnvelope = {
  mediaId: string;
  senderUserId: string;
  senderDeviceId: string;
  boxPublic: Uint8Array;
  signPublic: Uint8Array;
  statementSig: Uint8Array;
  identityPublic: Uint8Array;
  identitySig: Uint8Array;
  mediaSig: Uint8Array;
  contentNonce: Uint8Array;
  kind: "image" | "video";
  contentType: string;
  wraps: {
    recipientDeviceId: string | null;
    recipientUserBackup: string | null;
    prekeyId: string | null;
    signedPrekeyId: string | null;
    ephemeralPublic: Uint8Array;
    nonce: Uint8Array;
    ciphertext: Uint8Array;
  }[];
};

function cleanType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function mediaBinding(userA: string, userB: string): string {
  const [low, high] = userA < userB ? [userA, userB] : [userB, userA];
  return `avouch-media-v1\n${low}\n${high}`;
}

function uuidToBytes(id: string): Uint8Array | null {
  if (!isUuid(id)) return null;
  const hex = id.replaceAll("-", "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class Writer {
  private readonly parts: Uint8Array[] = [];

  u8(value: number): void {
    this.parts.push(Uint8Array.of(value));
  }

  bytes(value: Uint8Array): void {
    this.parts.push(value);
  }

  text(value: string): void {
    const raw = new TextEncoder().encode(value);
    if (raw.length > 255) throw new Error("That picture could not be sealed.");
    this.u8(raw.length);
    this.bytes(raw);
  }

  uuid(value: string): void {
    const raw = uuidToBytes(value);
    if (!raw) throw new Error("That picture could not be sealed.");
    this.bytes(raw);
  }

  finish(): Uint8Array {
    let size = 0;
    for (const part of this.parts) size += part.length;
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

class Reader {
  private offset = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  u8(): number | null {
    if (this.offset >= this.bytes.length) return null;
    const value = this.bytes[this.offset] ?? 0;
    this.offset += 1;
    return value;
  }

  take(length: number): Uint8Array | null {
    if (this.offset + length > this.bytes.length) return null;
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  text(): string | null {
    const length = this.u8();
    if (length === null) return null;
    const raw = this.take(length);
    if (!raw) return null;
    return new TextDecoder().decode(raw);
  }

  done(): boolean {
    return this.offset === this.bytes.length;
  }
}

function b64(lib: Sodium, bytes: Uint8Array): string {
  return lib.to_base64(bytes, lib.base64_variants.ORIGINAL);
}

function raw(lib: Sodium, value: string, size: number): Uint8Array | null {
  try {
    const bytes = lib.from_base64(value, lib.base64_variants.ORIGINAL);
    if (bytes.length !== size) return null;
    return bytes;
  } catch {
    return null;
  }
}

function mediaStatement(
  lib: Sodium,
  input: {
    mediaId: string;
    senderDeviceId: string;
    binding: string;
    kind: string;
    contentType: string;
    contentNonce: Uint8Array;
    ciphertext: Uint8Array;
    wrapsCanonical: string;
  },
): Uint8Array {
  const hash = lib.crypto_generichash(32, input.ciphertext);
  const text = [
    "avouch-media-body-v2",
    input.mediaId,
    input.senderDeviceId,
    input.binding,
    input.kind,
    input.contentType,
    b64(lib, input.contentNonce),
    b64(lib, hash),
    input.wrapsCanonical,
  ].join("\n");
  lib.memzero(hash);
  return lib.from_string(text);
}

function encodeEnvelope(lib: Sodium, decoded: DecodedEnvelope): string {
  const writer = new Writer();
  writer.u8(2);
  writer.uuid(decoded.mediaId);
  writer.text(decoded.senderUserId);
  writer.uuid(decoded.senderDeviceId);
  writer.bytes(decoded.boxPublic);
  writer.bytes(decoded.signPublic);
  writer.bytes(decoded.statementSig);
  writer.bytes(decoded.identityPublic);
  writer.bytes(decoded.identitySig);
  writer.bytes(decoded.mediaSig);
  writer.bytes(decoded.contentNonce);
  writer.u8(decoded.kind === "image" ? 1 : 2);
  writer.text(decoded.contentType);
  writer.u8(decoded.wraps.length);
  for (const wrap of decoded.wraps) {
    if (wrap.recipientDeviceId) {
      writer.u8(1);
      writer.uuid(wrap.recipientDeviceId);
      if (wrap.prekeyId) {
        writer.u8(1);
        writer.uuid(wrap.prekeyId);
      } else if (wrap.signedPrekeyId) {
        writer.u8(2);
        writer.uuid(wrap.signedPrekeyId);
      } else {
        writer.u8(0);
      }
    } else if (wrap.recipientUserBackup) {
      writer.u8(2);
      writer.text(wrap.recipientUserBackup);
      writer.u8(0);
    } else {
      throw new Error("That picture could not be sealed.");
    }
    writer.bytes(wrap.ephemeralPublic);
    writer.bytes(wrap.nonce);
    writer.bytes(wrap.ciphertext);
  }
  return b64(lib, writer.finish());
}

function decodeEnvelope(lib: Sodium, value: string): DecodedEnvelope | null {
  if (value.length < 1 || value.length > KEY_ENVELOPE_MAX || value.includes("\u0000")) return null;
  let bytes: Uint8Array;
  try {
    bytes = lib.from_base64(value, lib.base64_variants.ORIGINAL);
  } catch {
    return null;
  }
  const reader = new Reader(bytes);
  if (reader.u8() !== 2) return null;
  const mediaId = reader.take(16);
  const senderUserId = reader.text();
  const senderDeviceId = reader.take(16);
  const boxPublic = reader.take(32);
  const signPublic = reader.take(32);
  const statementSig = reader.take(64);
  const identityPublic = reader.take(32);
  const identitySig = reader.take(64);
  const mediaSig = reader.take(64);
  const contentNonce = reader.take(24);
  const kindByte = reader.u8();
  const contentType = reader.text();
  const wrapCount = reader.u8();
  if (
    !mediaId ||
    !senderUserId ||
    !senderDeviceId ||
    !boxPublic ||
    !signPublic ||
    !statementSig ||
    !identityPublic ||
    !identitySig ||
    !mediaSig ||
    !contentNonce ||
    !contentType ||
    wrapCount === null
  ) {
    return null;
  }
  if (!isUuid(bytesToUuid(mediaId)) || !isUuid(bytesToUuid(senderDeviceId))) return null;
  if (!isMemberId(senderUserId)) return null;
  if (kindByte !== 1 && kindByte !== 2) return null;
  const wraps: DecodedEnvelope["wraps"] = [];
  for (let i = 0; i < wrapCount; i += 1) {
    const dest = reader.u8();
    let recipientDeviceId: string | null = null;
    let recipientUserBackup: string | null = null;
    if (dest === 1) {
      const id = reader.take(16);
      if (!id) return null;
      recipientDeviceId = bytesToUuid(id);
      if (!isUuid(recipientDeviceId)) return null;
    } else if (dest === 2) {
      recipientUserBackup = reader.text();
      if (!recipientUserBackup || !isMemberId(recipientUserBackup)) return null;
    } else {
      return null;
    }
    const flag = reader.u8();
    let prekeyId: string | null = null;
    let signedPrekeyId: string | null = null;
    if (flag === 1 || flag === 2) {
      const id = reader.take(16);
      if (!id) return null;
      const parsed = bytesToUuid(id);
      if (!isUuid(parsed)) return null;
      if (flag === 1) prekeyId = parsed;
      else signedPrekeyId = parsed;
    } else if (flag !== 0) {
      return null;
    }
    const ephemeralPublic = reader.take(32);
    const nonce = reader.take(24);
    const ciphertext = reader.take(48);
    if (!ephemeralPublic || !nonce || !ciphertext) return null;
    wraps.push({
      recipientDeviceId,
      recipientUserBackup,
      prekeyId,
      signedPrekeyId,
      ephemeralPublic,
      nonce,
      ciphertext,
    });
  }
  if (!reader.done()) return null;
  return {
    mediaId: bytesToUuid(mediaId),
    senderUserId,
    senderDeviceId: bytesToUuid(senderDeviceId),
    boxPublic,
    signPublic,
    statementSig,
    identityPublic,
    identitySig,
    mediaSig,
    contentNonce,
    kind: kindByte === 1 ? "image" : "video",
    contentType,
    wraps,
  };
}

async function sealMedia(
  deps: { transport: DmTransport; vault: VaultStore },
  request: DmMediaSealInput,
): Promise<DmMediaSealed> {
  const state = deps.vault.read();
  if (!state) throw new Error("Create keys on this device first.");
  if (!isMemberId(request.peerUserId) || request.peerUserId === state.userId) {
    throw new Error("Messages are between two people.");
  }
  const contentType = cleanType(request.contentType);
  const allowed =
    request.kind === "image" ? IMAGE_TYPES : request.kind === "video" ? VIDEO_TYPES : null;
  if (!allowed) throw new Error("Choose a picture or a video.");
  if (!allowed.has(contentType)) {
    throw new Error(
      request.kind === "image"
        ? "Choose a JPEG, PNG, WebP, or GIF."
        : "That video must be an MP4 or a WebM.",
    );
  }
  const plain = stripBeforeSeal(request.bytes, request.kind, contentType);
  const cap = request.kind === "image" ? IMAGE_BYTES : VIDEO_BYTES;
  const lib = await loadSodium();
  if (plain.byteLength < 1) throw new Error("That file is empty.");
  if (plain.byteLength + lib.crypto_secretbox_MACBYTES > cap) {
    throw new Error(
      request.kind === "image" ? "That picture is over 8 MB." : "That video is over 32 MB.",
    );
  }

  const opened = await openEncryptedThread(deps.transport, request.peerUserId);
  if (!opened.ok) throw new Error(opened.message);
  const ready = await messageDestinations(deps.transport, deps.vault, request.peerUserId);
  if (!ready.ok) throw new Error(ready.message);

  const contentKey = lib.randombytes_buf(lib.crypto_secretbox_KEYBYTES);
  const contentNonce = lib.randombytes_buf(lib.crypto_secretbox_NONCEBYTES);
  const signSecret = raw(lib, ready.sender.signSecret, lib.crypto_sign_SECRETKEYBYTES);
  const boxPublic = raw(lib, ready.sender.boxPublic, 32);
  const signPublic = raw(lib, ready.sender.signPublic, 32);
  const statementSig = raw(lib, ready.sender.statementSig, 64);
  const identityPublic = raw(lib, ready.sender.identityPublic, 32);
  const identitySig = raw(lib, ready.sender.identitySig, 64);
  try {
    if (
      !signSecret ||
      !boxPublic ||
      !signPublic ||
      !statementSig ||
      !identityPublic ||
      !identitySig
    ) {
      throw new Error("The keys on this device are not valid.");
    }
    const ciphertext = lib.crypto_secretbox_easy(plain, contentNonce, contentKey);
    const binding = mediaBinding(state.userId, request.peerUserId);
    const mediaId = crypto.randomUUID();
    const wrapped = await sealContentKey({
      mediaId,
      binding,
      sender: ready.sender,
      contentKey,
      destinations: ready.destinations,
    });
    if (!wrapped.ok) throw new Error(wrapped.message);
    const statement = mediaStatement(lib, {
      mediaId,
      senderDeviceId: ready.sender.deviceId,
      binding,
      kind: request.kind,
      contentType,
      contentNonce,
      ciphertext,
      wrapsCanonical: wrapListCanonical(wrapped.value),
    });
    const mediaSig = lib.crypto_sign_detached(statement, signSecret);
    const decoded: DecodedEnvelope = {
      mediaId,
      senderUserId: state.userId,
      senderDeviceId: ready.sender.deviceId,
      boxPublic,
      signPublic,
      statementSig,
      identityPublic,
      identitySig,
      mediaSig,
      contentNonce,
      kind: request.kind,
      contentType,
      wraps: wrapped.value.map((envelope) => {
        const ephemeralPublic = raw(lib, envelope.ephemeralPublic, 32);
        const nonce = raw(lib, envelope.nonce, 24);
        const wrapCipher = raw(lib, envelope.ciphertext, 48);
        if (!ephemeralPublic || !nonce || !wrapCipher) {
          throw new Error("That picture could not be sealed.");
        }
        return {
          recipientDeviceId: envelope.recipientDeviceId,
          recipientUserBackup: envelope.recipientUserBackup,
          prekeyId: envelope.prekeyId,
          signedPrekeyId: envelope.signedPrekeyId,
          ephemeralPublic,
          nonce,
          ciphertext: wrapCipher,
        };
      }),
    };
    const keyEnvelope = encodeEnvelope(lib, decoded);
    if (keyEnvelope.length > KEY_ENVELOPE_MAX || keyEnvelope.includes("\u0000")) {
      throw new Error("That wrapped key is too long.");
    }
    return { ciphertext, keyEnvelope };
  } finally {
    lib.memzero(contentKey);
    lib.memzero(contentNonce);
    if (signSecret) lib.memzero(signSecret);
  }
}

async function openMedia(
  deps: { transport: DmTransport; vault: VaultStore },
  request: { ciphertext: Uint8Array; keyEnvelope: string; peerUserId: string },
): Promise<Uint8Array> {
  const state = deps.vault.read();
  if (!state) throw new Error("Create keys on this device first.");
  if (!isMemberId(request.peerUserId) || request.peerUserId === state.userId) {
    throw new Error("That picture could not be read.");
  }
  const cap = request.ciphertext.byteLength;
  if (cap < 17 || cap > VIDEO_BYTES) throw new Error("That picture could not be read.");
  const lib = await loadSodium();
  const decoded = decodeEnvelope(lib, request.keyEnvelope);
  if (!decoded) throw new Error("That picture could not be read.");
  if (decoded.senderUserId !== state.userId && decoded.senderUserId !== request.peerUserId) {
    throw new Error("That picture could not be read.");
  }
  const limit = decoded.kind === "image" ? IMAGE_BYTES : VIDEO_BYTES;
  if (request.ciphertext.byteLength > limit) throw new Error("That picture could not be read.");
  const binding = mediaBinding(state.userId, request.peerUserId);
  const signPublic = b64(lib, decoded.signPublic);
  const boxPublic = b64(lib, decoded.boxPublic);
  const statementSig = b64(lib, decoded.statementSig);
  const identityPublic = b64(lib, decoded.identityPublic);
  const identitySig = b64(lib, decoded.identitySig);
  const deviceOk = await verifyDeviceStatement(decoded.senderUserId, {
    deviceId: decoded.senderDeviceId,
    signPublic,
    boxPublic,
    statementSig,
    identitySig,
  });
  if (!deviceOk) throw new Error("That picture could not be read.");
  const identityOk = await verifyIdentitySignature(identityPublic, decoded.senderUserId, {
    deviceId: decoded.senderDeviceId,
    signPublic,
    boxPublic,
    statementSig,
    identitySig,
  });
  if (!identityOk) throw new Error("That picture could not be read.");
  const envelopes = decoded.wraps.map((wrap) => ({
    recipientDeviceId: wrap.recipientDeviceId,
    recipientUserBackup: wrap.recipientUserBackup,
    prekeyId: wrap.prekeyId,
    signedPrekeyId: wrap.signedPrekeyId,
    ephemeralPublic: b64(lib, wrap.ephemeralPublic),
    nonce: b64(lib, wrap.nonce),
    ciphertext: b64(lib, wrap.ciphertext),
  }));
  const statement = mediaStatement(lib, {
    mediaId: decoded.mediaId,
    senderDeviceId: decoded.senderDeviceId,
    binding,
    kind: decoded.kind,
    contentType: decoded.contentType,
    contentNonce: decoded.contentNonce,
    ciphertext: request.ciphertext,
    wrapsCanonical: wrapListCanonical(envelopes),
  });
  let signed = false;
  try {
    signed = lib.crypto_sign_verify_detached(decoded.mediaSig, statement, decoded.signPublic);
  } catch {
    signed = false;
  }
  if (!signed) throw new Error("That picture could not be read.");

  const opened = await openContentKey({
    mediaId: decoded.mediaId,
    binding,
    senderBoxPublic: boxPublic,
    recipientDevice: state.device,
    backup: state.backup,
    envelopes,
  });
  if (!opened.ok) throw new Error(opened.message);
  try {
    const plain = lib.crypto_secretbox_open_easy(
      request.ciphertext,
      decoded.contentNonce,
      opened.key,
    );
    if (opened.consumedPrekeyId) {
      const next = deps.vault.read();
      if (next) {
        next.device.prekeys = next.device.prekeys.filter(
          (prekey) => prekey.id !== opened.consumedPrekeyId,
        );
        next.spentPrekeys = [...new Set([...(next.spentPrekeys ?? []), opened.consumedPrekeyId])];
        deps.vault.write(next);
      }
    }
    return plain;
  } catch {
    throw new Error("That picture could not be read.");
  } finally {
    lib.memzero(opened.key);
  }
}

export function createDmMediaCrypto(deps: {
  transport: DmTransport;
  vault: VaultStore;
}): DmMediaCrypto {
  return {
    seal: (request) => sealMedia(deps, request),
    open: (request) => openMedia(deps, request),
  };
}
