/**
 * The member's mailbox. It speaks to the API in ciphertext and keeps
 * private keys in the vault the caller provides (this browser, or a test).
 */

import { userFacingError } from "../user-facing-error.ts";
import { DM_PREKEY_BATCH, SIGNED_PREKEY_ROTATE_AFTER_MS, dmTextError } from "./limits.ts";
import {
  createBackupKey,
  createDevice,
  createPrekeys,
  createSignedPrekey,
  retainSignedPrekeys,
  rotateSignedPrekeyIfDue,
  decryptBackupSecret,
  encryptBackupSecret,
  identityKeyFromSecret,
  isMemberId,
  isUuid,
  openMessage,
  safetyNumber,
  sealMessage,
  verifyBodySignature,
  verifyDeviceStatement,
  verifyIdentitySignature,
  verifyPrekey,
  verifySignedPrekey,
  type BackupCipher,
  type BackupKey,
  type DeviceRecord,
  type EnvelopeWire,
  type MessageWire,
  type PublicDevice,
  type PublicPrekey,
  type SafetyParty,
  type SealDestination,
} from "./protocol.ts";

export type PinnedDevice = {
  deviceId: string;
  signPublic: string;
  boxPublic: string;
  statementSig?: string;
  identitySig?: string;
};

/** Identity, backup, and the device list the member has already accepted. */
export type PinRecord = {
  userId: string;
  identityPublic: string;
  backupPublic: string | null;
  devices: PinnedDevice[];
};

export type VaultState = {
  userId: string;
  device: DeviceRecord;
  backup: (BackupKey & { userId: string }) | null;
  pins: PinRecord[];
  /** Safety numbers the member has compared out of band. */
  confirmed: { userId: string; safety: string }[];
  /** One-time prekey ids this device has already opened. A repeat is reported. */
  spentPrekeys: string[];
  /** Thread to the other account, saved while that account still existed. */
  peers?: { threadId: string; userId: string }[];
  /** Messages this device has already decrypted. A repeat does not open the wrap again. */
  opened?: SavedMessage[];
};

type SavedMessage = DecodedMessage & {
  threadId: string;
  bodyCiphertext: string;
  senderDeviceId: string;
  senderUserId: string;
  envelopes: EnvelopeWire[];
};

export type VaultStore = {
  read(): VaultState | null;
  write(state: VaultState): void;
};

export type DmTransport = {
  post(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
  get(path: string): Promise<{ status: number; body: unknown }>;
};

export type ThreadSummary = { id: string; otherUserId: string; otherName: string };
export type DecodedMessage = { id: string; from: string; text: string; at: number };
export type OwnDevice = {
  id: string;
  label: string;
  createdAt: string;
  prekeysLeft: number;
  signedPrekeyRotatedAt: string | null;
  current: boolean;
};

type BundleDevice = PublicDevice & {
  prekey: PublicPrekey | null;
  signedPrekey: PublicPrekey | null;
};
type Bundle = {
  userId: string;
  identityPublic: string | null;
  backupPublic: string | null;
  devices: BundleDevice[];
};
type KeyPreview = {
  userId: string;
  identityPublic: string | null;
  backupPublic: string | null;
  devices: PublicDevice[];
};

function messageOf(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string" &&
    body.error
  ) {
    return userFacingError(body.error, fallback);
  }
  return fallback;
}

async function expectOk(
  response: { status: number; body: unknown },
  fallback: string,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, message: messageOf(response.body, fallback) };
  }
  return { ok: true, body: response.body };
}

export function memoryVault(initial: VaultState | null = null): VaultStore {
  let current = initial;
  return {
    read: () => (current ? structuredClone(current) : null),
    write: (state) => {
      current = structuredClone(state);
    },
  };
}

export async function createLocalDevice(
  userId: string,
  label = "This browser",
): Promise<VaultState> {
  const device = await createDevice({ userId, label });
  return { userId, device, backup: null, pins: [], confirmed: [], spentPrekeys: [] };
}

/** Another browser for the same identity. It can sign in as the same member. */
export async function createSiblingDevice(
  existing: VaultState,
  label: string,
): Promise<VaultState> {
  const device = await createDevice({
    userId: existing.userId,
    label,
    identity: {
      signPublic: existing.device.identityPublic,
      signSecret: existing.device.identitySecret,
    },
  });
  return {
    userId: existing.userId,
    device,
    backup: existing.backup ? { ...existing.backup } : null,
    pins: existing.pins.map((pin) => ({
      ...pin,
      devices: pin.devices.map((item) => ({ ...item })),
    })),
    confirmed: existing.confirmed.map((item) => ({ ...item })),
    spentPrekeys: [],
  };
}

function registrationBody(state: VaultState): unknown {
  return {
    deviceId: state.device.deviceId,
    label: state.device.label,
    signPublic: state.device.signPublic,
    boxPublic: state.device.boxPublic,
    statementSig: state.device.statementSig,
    identityPublic: state.device.identityPublic,
    identitySig: state.device.identitySig,
    signedPrekey: {
      id: state.device.signedPrekey.id,
      publicKey: state.device.signedPrekey.publicKey,
      signature: state.device.signedPrekey.signature,
    },
    prekeys: state.device.prekeys.map((prekey) => ({
      id: prekey.id,
      publicKey: prekey.publicKey,
      signature: prekey.signature,
    })),
  };
}

export async function registerDevice(
  transport: DmTransport,
  vault: VaultStore,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const state = vault.read();
  if (!state) return { ok: false, message: "Create keys on this device first." };
  const response = await expectOk(
    await transport.post("/api/dm/devices", registrationBody(state)),
    "The device was not registered.",
  );
  if (!response.ok) return response;
  return replenishPrekeys(transport, vault);
}

async function replenishPrekeys(
  transport: DmTransport,
  vault: VaultStore,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const state = vault.read();
  if (!state) return { ok: false, message: "Create keys on this device first." };
  const listed = await expectOk(
    await transport.get("/api/dm/devices"),
    "The device list did not load.",
  );
  if (!listed.ok) return listed;
  const devices = readOwnDevices(listed.body, state.device.deviceId);
  const mine = devices.find((device) => device.current);
  const serverAt = mine?.signedPrekeyRotatedAt ? Date.parse(mine.signedPrekeyRotatedAt) : NaN;
  const at = Number.isFinite(serverAt) ? serverAt : (state.device.signedPrekeyAt ?? 0);
  const due = Date.now() - at >= SIGNED_PREKEY_ROTATE_AFTER_MS;
  const low = Boolean(mine && mine.prekeysLeft < 3);
  if (!due && !low) return { ok: true };
  const extra = low ? await createPrekeys(state.device, DM_PREKEY_BATCH) : [];
  const next = vault.read();
  if (!next) return { ok: false, message: "Create keys on this device first." };
  const rotated = due
    ? await rotateSignedPrekeyIfDue({ ...next.device, signedPrekeyAt: at }, Date.now())
    : { device: next.device, rotated: false };
  if (!rotated.rotated && low) {
    const signedPrekey = await createSignedPrekey(next.device);
    const previousSignedPrekeys = retainSignedPrekeys(next.device, next.device.signedPrekey);
    next.device.previousSignedPrekeys = previousSignedPrekeys;
    next.device.previousSignedPrekey = previousSignedPrekeys[0] ?? null;
    next.device.signedPrekey = signedPrekey;
    next.device.signedPrekeyAt = Date.now();
  } else {
    next.device.previousSignedPrekeys = rotated.device.previousSignedPrekeys;
    next.device.previousSignedPrekey = rotated.device.previousSignedPrekey;
    next.device.signedPrekey = rotated.device.signedPrekey;
    next.device.signedPrekeyAt = rotated.device.signedPrekeyAt;
  }
  next.device.prekeys.push(...extra);
  vault.write(next);
  const signedPrekey = next.device.signedPrekey;
  const response = await expectOk(
    await transport.post(`/api/dm/devices/${next.device.deviceId}/prekeys`, {
      signedPrekey: {
        id: signedPrekey.id,
        publicKey: signedPrekey.publicKey,
        signature: signedPrekey.signature,
      },
      prekeys: extra.map((prekey) => ({
        id: prekey.id,
        publicKey: prekey.publicKey,
        signature: prekey.signature,
      })),
    }),
    "New one-time keys were not saved.",
  );
  return response.ok ? { ok: true } : response;
}

export async function publishBackup(
  transport: DmTransport,
  vault: VaultStore,
  passphrase: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const state = vault.read();
  if (!state) return { ok: false, message: "Create keys on this device first." };
  const backup = state.backup ?? { ...(await createBackupKey()), userId: state.userId };
  const cipher = await encryptBackupSecret(
    { boxSecret: backup.boxSecret, identitySecret: state.device.identitySecret },
    passphrase,
  );
  if (!cipher.ok) return cipher;
  const response = await expectOk(
    await transport.post("/api/dm/backup", { boxPublic: backup.boxPublic, ...cipher.value }),
    "The key backup was not saved.",
  );
  if (!response.ok) return response;
  const next = vault.read() ?? state;
  next.backup = backup;
  vault.write(next);
  return { ok: true };
}

export async function restoreFromBackup(
  transport: DmTransport,
  userId: string,
  passphrase: string,
  label = "This browser",
): Promise<{ ok: true; vault: VaultState } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.get("/api/dm/backup"),
    "No key backup is stored.",
  );
  if (!response.ok) return response;
  const record = readBackup(response.body);
  if (!record) return { ok: false, message: "No key backup is stored." };
  const secret = await decryptBackupSecret(record.cipher, passphrase);
  if (!secret) return { ok: false, message: "That passphrase did not open the backup." };
  const identity = await identityKeyFromSecret(secret.identitySecret);
  if (!identity) return { ok: false, message: "That passphrase did not open the backup." };
  const device = await createDevice({ userId, label, identity });
  const vault: VaultState = {
    userId,
    device,
    backup: { userId, boxPublic: record.boxPublic, boxSecret: secret.boxSecret },
    pins: [],
    confirmed: [],
    spentPrekeys: [],
  };
  return { ok: true, vault };
}

export async function findMember(
  transport: DmTransport,
  name: string,
): Promise<{ ok: true; matches: { id: string; name: string }[] } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.get(`/api/dm/members?name=${encodeURIComponent(name)}`),
    "That member was not found.",
  );
  if (!response.ok) return response;
  const body = response.body;
  if (!body || typeof body !== "object" || !("matches" in body) || !Array.isArray(body.matches)) {
    return { ok: false, message: "That member was not found." };
  }
  const matches = body.matches.flatMap((item) => {
    if (!item || typeof item !== "object" || !("id" in item) || !("name" in item)) return [];
    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
    return [{ id: item.id, name: item.name }];
  });
  return { ok: true, matches };
}

export async function openEncryptedThread(
  transport: DmTransport,
  otherUserId: string,
): Promise<{ ok: true; thread: ThreadSummary } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.post("/api/dm/threads", { userId: otherUserId }),
    "The conversation was not opened.",
  );
  if (!response.ok) return response;
  const thread = readThread(response.body);
  if (!thread) return { ok: false, message: "The conversation was not opened." };
  return { ok: true, thread };
}

export async function listEncryptedThreads(
  transport: DmTransport,
): Promise<{ ok: true; threads: ThreadSummary[] } | { ok: false; message: string }> {
  const response = await expectOk(await transport.get("/api/dm/threads"), "Messages did not load.");
  if (!response.ok) return response;
  const body = response.body;
  if (!body || typeof body !== "object" || !("threads" in body) || !Array.isArray(body.threads)) {
    return { ok: true, threads: [] };
  }
  return { ok: true, threads: body.threads.flatMap((item) => readThread(item) ?? []) };
}

export async function listOwnDevices(
  transport: DmTransport,
  currentDeviceId: string,
): Promise<{ ok: true; devices: OwnDevice[] } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.get("/api/dm/devices"),
    "The device list did not load.",
  );
  if (!response.ok) return response;
  return { ok: true, devices: readOwnDevices(response.body, currentDeviceId) };
}

export async function revokeOtherDevice(
  transport: DmTransport,
  deviceId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.post(`/api/dm/devices/${deviceId}/revoke`, {}),
    "That device was not revoked.",
  );
  return response.ok ? { ok: true } : response;
}

/**
 * Keys for one other member. A safety refusal returns before any one-time
 * prekey is taken. Sending stays blocked until the safety number is confirmed,
 * and again when a device is added. The caller opens the conversation first.
 */
export async function messageDestinations(
  transport: DmTransport,
  vault: VaultStore,
  otherUserId: string,
): Promise<
  | { ok: true; destinations: SealDestination[]; warning: string | null; sender: DeviceRecord }
  | { ok: false; message: string; safety?: string }
> {
  if (!vault.read()) return { ok: false, message: "Create keys on this device first." };
  if (!isMemberId(otherUserId)) return { ok: false, message: "That conversation was not found." };
  const filled = await replenishPrekeys(transport, vault);
  if (!filled.ok) return filled;
  const state = vault.read();
  if (!state) return { ok: false, message: "Create keys on this device first." };

  const mineLoaded = await previewKeys(transport, state.userId);
  const theirLoaded = await previewKeys(transport, otherUserId);
  if (!mineLoaded.ok) return mineLoaded;
  if (!theirLoaded.ok) return theirLoaded;
  const minePreview = mineLoaded.preview;
  const theirPreview = theirLoaded.preview;
  if (!theirPreview.identityPublic || theirPreview.devices.length === 0) {
    return { ok: false, message: "They have not set up encryption yet." };
  }
  if (!minePreview.identityPublic || minePreview.devices.length === 0) {
    return { ok: false, message: "Create keys on this device first." };
  }
  const checked = await identitiesOk(minePreview, theirPreview);
  if (!checked.ok) return checked;

  const safety = await safetyNumber(partyOf(minePreview), partyOf(theirPreview));
  if (!safety) return { ok: false, message: "Compare safety numbers before you send." };
  const confirmed = state.confirmed.some(
    (item) => item.userId === otherUserId && item.safety === safety,
  );
  const pinCheck = applyPins(state, minePreview, theirPreview, confirmed);
  if (!pinCheck.ok) return { ...pinCheck, safety };
  if (!confirmed) {
    vault.write(pinCheck.state);
    return { ok: false, message: "Compare safety numbers before you send.", safety };
  }
  vault.write(pinCheck.state);

  const fresh = vault.read();
  if (!fresh) return { ok: false, message: "Create keys on this device first." };
  const mine = await claimBundle(transport, fresh.userId);
  const theirs = await claimBundle(transport, otherUserId);
  if (!mine.ok) return mine;
  if (!theirs.ok) return theirs;
  if (
    !bundlesMatchPreview(mine.bundle, minePreview) ||
    !bundlesMatchPreview(theirs.bundle, theirPreview)
  ) {
    return {
      ok: false,
      message:
        "The keys from the server did not match the ones you checked. The message was not sent.",
    };
  }

  const destinations: SealDestination[] = [];
  for (const bundle of [mine.bundle, theirs.bundle]) {
    if (!bundle.identityPublic) {
      return { ok: false, message: "They have not set up encryption yet." };
    }
    for (const device of bundle.devices) {
      if (!(await verifyDeviceStatement(bundle.userId, device))) {
        return { ok: false, message: "A device key did not check out. The message was not sent." };
      }
      if (!(await verifyIdentitySignature(bundle.identityPublic, bundle.userId, device))) {
        return { ok: false, message: "A device key did not check out. The message was not sent." };
      }
      if (
        device.prekey &&
        !(await verifyPrekey(device.deviceId, device.signPublic, device.prekey))
      ) {
        return {
          ok: false,
          message: "A one-time key did not check out. The message was not sent.",
        };
      }
      if (
        !device.prekey &&
        (!device.signedPrekey ||
          !(await verifySignedPrekey(device.deviceId, device.signPublic, device.signedPrekey)))
      ) {
        return {
          ok: false,
          message: "A signed prekey did not check out. The message was not sent.",
        };
      }
      destinations.push({
        kind: "device",
        userId: bundle.userId,
        identityPublic: bundle.identityPublic,
        device,
        prekey: device.prekey,
        signedPrekey: device.signedPrekey,
      });
    }
    if (bundle.backupPublic) {
      destinations.push({ kind: "backup", userId: bundle.userId, boxPublic: bundle.backupPublic });
    }
  }

  return { ok: true, destinations, warning: null, sender: fresh.device };
}

function partyOf(preview: KeyPreview): SafetyParty {
  return {
    identityPublic: preview.identityPublic ?? "",
    backupPublic: preview.backupPublic,
    devices: preview.devices.map((device) => ({
      deviceId: device.deviceId,
      signPublic: device.signPublic,
    })),
  };
}

async function identitiesOk(
  mine: KeyPreview,
  theirs: KeyPreview,
): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const preview of [mine, theirs]) {
    if (!preview.identityPublic)
      return { ok: false, message: "They have not set up encryption yet." };
    for (const device of preview.devices) {
      if (!(await verifyIdentitySignature(preview.identityPublic, preview.userId, device))) {
        return { ok: false, message: "A device key did not check out. The message was not sent." };
      }
    }
  }
  return { ok: true };
}

export async function sendEncrypted(
  transport: DmTransport,
  vault: VaultStore,
  threadId: string,
  otherUserId: string,
  text: string,
): Promise<{ ok: true; warning: string | null } | { ok: false; message: string; safety?: string }> {
  const problem = dmTextError(text);
  if (problem) return { ok: false, message: problem };
  if (!vault.read()) return { ok: false, message: "Create keys on this device first." };
  if (!isUuid(threadId) || !isMemberId(otherUserId)) {
    return { ok: false, message: "That conversation was not found." };
  }
  const noted = vault.read();
  if (noted) {
    rememberPeer(noted, threadId, otherUserId);
    vault.write(noted);
  }
  const ready = await messageDestinations(transport, vault, otherUserId);
  if (!ready.ok) return ready;
  const sealed = await sealMessage({
    messageId: crypto.randomUUID(),
    threadId,
    sender: ready.sender,
    text,
    destinations: ready.destinations,
  });
  if (!sealed.ok) return sealed;
  const response = await expectOk(
    await transport.post(`/api/dm/threads/${threadId}/messages`, sealed.value),
    "The message was not sent.",
  );
  if (!response.ok) return response;
  return { ok: true, warning: ready.warning };
}

export function confirmSafety(vault: VaultStore, otherUserId: string, safety: string): void {
  const state = vault.read();
  if (!state) return;
  state.confirmed = [
    ...state.confirmed.filter((item) => item.userId !== otherUserId),
    { userId: otherUserId, safety },
  ];
  vault.write(state);
}

export async function readEncrypted(
  transport: DmTransport,
  vault: VaultStore,
  threadId: string,
  myUserId: string,
  myName: string,
  otherName: string,
  otherUserId = "",
): Promise<
  | { ok: true; messages: DecodedMessage[]; unreadable: number; warnings: string[] }
  | { ok: false; message: string }
> {
  const state = vault.read();
  if (!state) return { ok: false, message: "Create keys on this device first." };
  if (otherUserId) rememberPeer(state, threadId, otherUserId);
  const response = await expectOk(
    await transport.get(`/api/dm/threads/${threadId}/messages`),
    "Messages did not load.",
  );
  if (!response.ok) return response;
  const rows = readMessageRows(response.body);
  const messages: DecodedMessage[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let unreadable = 0;
  const consumed: string[] = [];
  const newly: SavedMessage[] = [];
  const savedMessages = state.opened ?? [];
  for (const row of rows) {
    if (row.message.threadId !== threadId) {
      unreadable += 1;
      continue;
    }
    if (seen.has(row.message.messageId)) continue;
    seen.add(row.message.messageId);
    const saved = savedMessages.find(
      (item) => item.id === row.message.messageId && item.threadId === threadId,
    );
    if (row.former) {
      const former = await readFormerMessage(state, threadId, row, saved);
      if (!former) {
        unreadable += 1;
        continue;
      }
      messages.push(former);
      continue;
    }
    if (saved && saved.bodyCiphertext === row.message.bodyCiphertext) {
      messages.push({ id: saved.id, from: saved.from, text: saved.text, at: saved.at });
      continue;
    }
    if (!row.sender) {
      unreadable += 1;
      continue;
    }
    const opened = await openMessage({
      message: row.message,
      senderUserId: row.senderUserId,
      senderIdentityPublic: row.senderIdentityPublic,
      sender: row.sender,
      recipientDevice: state.device,
      backup: state.backup,
      spentPrekeyIds: state.spentPrekeys,
    });
    if (!opened.ok) {
      unreadable += 1;
      if (opened.message === "A one-time key was reused." && !warnings.includes(opened.message)) {
        warnings.push(opened.message);
      }
      continue;
    }
    if (opened.consumedPrekeyId) consumed.push(opened.consumedPrekeyId);
    const decoded = {
      id: row.message.messageId,
      from: row.senderUserId === myUserId ? myName : otherName,
      text: opened.text,
      at: Date.parse(row.createdAt),
    };
    messages.push(decoded);
    newly.push({
      ...decoded,
      threadId,
      bodyCiphertext: row.message.bodyCiphertext,
      senderDeviceId: row.message.senderDeviceId,
      senderUserId: row.senderUserId,
      envelopes: row.message.envelopes,
    });
  }
  const next = vault.read();
  if (next) {
    if (otherUserId) rememberPeer(next, threadId, otherUserId);
    else if (state.peers) next.peers = state.peers;
    if (consumed.length > 0) {
      next.device.prekeys = next.device.prekeys.filter((prekey) => !consumed.includes(prekey.id));
      next.spentPrekeys = [...new Set([...next.spentPrekeys, ...consumed])];
    }
    if (newly.length > 0) {
      const prior = (next.opened ?? []).filter(
        (item) => !newly.some((added) => added.id === item.id),
      );
      next.opened = [...prior, ...newly].slice(-400);
    }
    if (consumed.length > 0 || newly.length > 0 || otherUserId) vault.write(next);
  }
  return { ok: true, messages, unreadable, warnings };
}

function rememberPeer(state: VaultState, threadId: string, userId: string): void {
  if (!threadId || !userId) return;
  const peers = state.peers ?? [];
  state.peers = [...peers.filter((item) => item.threadId !== threadId), { threadId, userId }];
}

/** A deleted sender is checked against the identity and device keys saved on this device. */
async function readFormerMessage(
  state: VaultState,
  threadId: string,
  row: MessageRow,
  saved: SavedMessage | undefined,
): Promise<DecodedMessage | null> {
  if (!saved || saved.bodyCiphertext !== row.message.bodyCiphertext) return null;
  const peerId = (state.peers ?? []).find((item) => item.threadId === threadId)?.userId ?? "";
  if (!peerId || saved.senderUserId !== peerId) return null;
  const pin = state.pins.find((item) => item.userId === peerId);
  const device = pin?.devices.find((item) => item.deviceId === saved.senderDeviceId);
  if (!pin?.identityPublic || !device?.statementSig || !device.identitySig) return null;
  const sender: PublicDevice = {
    deviceId: device.deviceId,
    signPublic: device.signPublic,
    boxPublic: device.boxPublic,
    statementSig: device.statementSig,
    identitySig: device.identitySig,
  };
  const message: MessageWire = {
    ...row.message,
    senderDeviceId: saved.senderDeviceId,
    envelopes: saved.envelopes,
  };
  if (!(await verifyIdentitySignature(pin.identityPublic, peerId, sender))) return null;
  if (!(await verifyDeviceStatement(peerId, sender))) return null;
  if (!(await verifyBodySignature(message, sender.signPublic))) return null;
  return { id: saved.id, from: "Former member", text: saved.text, at: saved.at };
}

/**
 * Confirm meetings this member says they attended. The server keeps a card
 * only when it is a real meeting and this member is the host or was named.
 */
export async function recordAttendance(
  transport: DmTransport,
  cardIds: string[] = [],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.post("/api/dm/attendance", { cardIds }),
    "The meeting was not recorded.",
  );
  return response.ok ? { ok: true } : response;
}

function readPeople(body: unknown, key: string): { id: string; name: string }[] {
  if (!body || typeof body !== "object" || !(key in body)) return [];
  const list = (body as Record<string, unknown>)[key];
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object" || !("id" in item) || !("name" in item)) return [];
    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
    return [{ id: item.id, name: item.name }];
  });
}

/** The members you have blocked. Nobody is told that you blocked them. */
export async function listBlockedMembers(
  transport: DmTransport,
): Promise<{ ok: true; blocked: { id: string; name: string }[] } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.get("/api/dm/blocks"),
    "The blocked list did not load.",
  );
  if (!response.ok) return response;
  return { ok: true, blocked: readPeople(response.body, "blocked") };
}

/** Block a member: no messages or calls either way until you unblock them. */
export async function blockMember(
  transport: DmTransport,
  userId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.post("/api/dm/blocks", { userId }),
    "That member was not blocked.",
  );
  return response.ok ? { ok: true } : response;
}

export async function unblockMember(
  transport: DmTransport,
  userId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.post(`/api/dm/blocks/${encodeURIComponent(userId)}/unblock`, {}),
    "That member was not unblocked.",
  );
  return response.ok ? { ok: true } : response;
}

export async function listDmPeers(
  transport: DmTransport,
): Promise<{ ok: true; peers: { id: string; name: string }[] } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.get("/api/dm/peers"),
    "The people from your meetings did not load.",
  );
  if (!response.ok) return response;
  const body = response.body;
  if (!body || typeof body !== "object" || !("peers" in body) || !Array.isArray(body.peers)) {
    return { ok: true, peers: [] };
  }
  const peers = body.peers.flatMap((item) => {
    if (!item || typeof item !== "object" || !("id" in item) || !("name" in item)) return [];
    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
    return [{ id: item.id, name: item.name }];
  });
  return { ok: true, peers };
}

function deviceKey(device: { deviceId: string; signPublic: string; boxPublic: string }): string {
  return `${device.deviceId}|${device.signPublic}|${device.boxPublic}`;
}

function sameDevices(left: PinnedDevice[], right: PublicDevice[]): boolean {
  const a = left.map(deviceKey).sort();
  const b = right.map(deviceKey).sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function pinFrom(preview: KeyPreview): PinRecord {
  return {
    userId: preview.userId,
    identityPublic: preview.identityPublic ?? "",
    backupPublic: preview.backupPublic,
    devices: preview.devices.map((device) => ({
      deviceId: device.deviceId,
      signPublic: device.signPublic,
      boxPublic: device.boxPublic,
      statementSig: device.statementSig,
      identitySig: device.identitySig,
    })),
  };
}

function applyPins(
  state: VaultState,
  mine: KeyPreview,
  theirs: KeyPreview,
  confirmed: boolean,
): { ok: true; state: VaultState } | { ok: false; message: string } {
  const next: VaultState = {
    ...state,
    pins: state.pins.map((item) => ({
      ...item,
      devices: item.devices.map((device) => ({ ...device })),
    })),
    confirmed: state.confirmed.map((item) => ({ ...item })),
    spentPrekeys: [...state.spentPrekeys],
  };
  for (const preview of [mine, theirs]) {
    const seen = next.pins.find((item) => item.userId === preview.userId);
    if (!seen) {
      next.pins = [...next.pins.filter((item) => item.userId !== preview.userId), pinFrom(preview)];
      continue;
    }
    const identityChanged = seen.identityPublic !== preview.identityPublic;
    const backupChanged = seen.backupPublic !== preview.backupPublic;
    const devicesChanged = !sameDevices(seen.devices, preview.devices);
    if (identityChanged || backupChanged || devicesChanged) {
      if (!confirmed) {
        return {
          ok: false,
          message: identityChanged
            ? "An identity key changed. Compare safety numbers again before you send."
            : backupChanged
              ? "A backup key changed. Compare safety numbers again before you send."
              : "A new device appeared. Compare safety numbers again before you send.",
        };
      }
      next.pins = [...next.pins.filter((item) => item.userId !== preview.userId), pinFrom(preview)];
    }
  }
  return { ok: true, state: next };
}

function bundlesMatchPreview(bundle: Bundle, preview: KeyPreview): boolean {
  if (bundle.identityPublic !== preview.identityPublic) return false;
  if (bundle.backupPublic !== preview.backupPublic) return false;
  return sameDevices(
    preview.devices.map((device) => ({
      deviceId: device.deviceId,
      signPublic: device.signPublic,
      boxPublic: device.boxPublic,
    })),
    bundle.devices,
  );
}

async function previewKeys(
  transport: DmTransport,
  userId: string,
): Promise<{ ok: true; preview: KeyPreview } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.get(`/api/dm/keys?userId=${encodeURIComponent(userId)}`),
    "The device keys did not load.",
  );
  if (!response.ok) return response;
  const preview = readPreview(response.body, userId);
  if (!preview) return { ok: false, message: "The device keys did not load." };
  return { ok: true, preview };
}

async function claimBundle(
  transport: DmTransport,
  userId: string,
): Promise<{ ok: true; bundle: Bundle } | { ok: false; message: string }> {
  const response = await expectOk(
    await transport.post("/api/dm/bundles", { userId }),
    "The device keys did not load.",
  );
  if (!response.ok) return response;
  const bundle = readBundle(response.body, userId);
  if (!bundle) return { ok: false, message: "The device keys did not load." };
  return { ok: true, bundle };
}

function readPreview(body: unknown, userId: string): KeyPreview | null {
  if (!body || typeof body !== "object") return null;
  const record = body as {
    userId?: unknown;
    identityPublic?: unknown;
    backupPublic?: unknown;
    devices?: unknown;
  };
  if (record.userId !== userId || !Array.isArray(record.devices)) return null;
  const devices: PublicDevice[] = [];
  for (const item of record.devices) {
    const device = readPublicDevice(item);
    if (!device) return null;
    devices.push(device);
  }
  return {
    userId,
    identityPublic: typeof record.identityPublic === "string" ? record.identityPublic : null,
    backupPublic: typeof record.backupPublic === "string" ? record.backupPublic : null,
    devices,
  };
}

function readBundle(body: unknown, userId: string): Bundle | null {
  if (!body || typeof body !== "object") return null;
  const record = body as {
    userId?: unknown;
    identityPublic?: unknown;
    backupPublic?: unknown;
    devices?: unknown;
  };
  if (record.userId !== userId || !Array.isArray(record.devices)) return null;
  const devices: BundleDevice[] = [];
  for (const item of record.devices) {
    const device = readPublicDevice(item);
    if (!device) return null;
    devices.push({
      ...device,
      prekey: readPrekey(item, "prekey"),
      signedPrekey: readPrekey(item, "signedPrekey"),
    });
  }
  return {
    userId,
    identityPublic: typeof record.identityPublic === "string" ? record.identityPublic : null,
    backupPublic: typeof record.backupPublic === "string" ? record.backupPublic : null,
    devices,
  };
}

function readPublicDevice(item: unknown): PublicDevice | null {
  if (!item || typeof item !== "object") return null;
  const device = item as Record<string, unknown>;
  if (
    typeof device.deviceId !== "string" ||
    typeof device.signPublic !== "string" ||
    typeof device.boxPublic !== "string" ||
    typeof device.statementSig !== "string" ||
    typeof device.identitySig !== "string"
  ) {
    return null;
  }
  return {
    deviceId: device.deviceId,
    signPublic: device.signPublic,
    boxPublic: device.boxPublic,
    statementSig: device.statementSig,
    identitySig: device.identitySig,
  };
}

function readPrekey(item: unknown, field: "prekey" | "signedPrekey"): PublicPrekey | null {
  if (!item || typeof item !== "object" || !(field in item)) return null;
  const prekey = (item as Record<string, unknown>)[field];
  if (!prekey || typeof prekey !== "object") return null;
  const record = prekey as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.publicKey !== "string" ||
    typeof record.signature !== "string"
  ) {
    return null;
  }
  return { id: record.id, publicKey: record.publicKey, signature: record.signature };
}

function readThread(body: unknown): ThreadSummary | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.otherUserId !== "string" ||
    typeof record.otherName !== "string"
  ) {
    return null;
  }
  return { id: record.id, otherUserId: record.otherUserId, otherName: record.otherName };
}

function readOwnDevices(body: unknown, currentDeviceId: string): OwnDevice[] {
  if (!body || typeof body !== "object" || !("devices" in body) || !Array.isArray(body.devices))
    return [];
  return body.devices.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const device = item as Record<string, unknown>;
    if (
      typeof device.id !== "string" ||
      typeof device.label !== "string" ||
      typeof device.createdAt !== "string"
    ) {
      return [];
    }
    if (device.revokedAt) return [];
    return [
      {
        id: device.id,
        label: device.label,
        createdAt: device.createdAt,
        prekeysLeft: typeof device.prekeysLeft === "number" ? device.prekeysLeft : 0,
        signedPrekeyRotatedAt:
          typeof device.signedPrekeyRotatedAt === "string" ? device.signedPrekeyRotatedAt : null,
        current: device.id === currentDeviceId,
      },
    ];
  });
}

function readBackup(body: unknown): { boxPublic: string; cipher: BackupCipher } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.kdf !== "argon2id" || typeof record.boxPublic !== "string") return null;
  if (
    typeof record.salt !== "string" ||
    typeof record.nonce !== "string" ||
    typeof record.ciphertext !== "string"
  ) {
    return null;
  }
  if (typeof record.opslimit !== "number" || typeof record.memlimit !== "number") return null;
  return {
    boxPublic: record.boxPublic,
    cipher: {
      kdf: "argon2id",
      opslimit: record.opslimit,
      memlimit: record.memlimit,
      salt: record.salt,
      nonce: record.nonce,
      ciphertext: record.ciphertext,
    },
  };
}

type MessageRow = {
  senderUserId: string;
  senderIdentityPublic: string;
  former: boolean;
  createdAt: string;
  sender: PublicDevice | null;
  message: MessageWire;
};

function readMessageRows(body: unknown): MessageRow[] {
  if (!body || typeof body !== "object" || !("messages" in body) || !Array.isArray(body.messages))
    return [];
  return body.messages.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const former = record.former === true;
    const sender = former ? null : readPublicDevice(record.sender);
    if (
      (!former && !sender) ||
      typeof record.createdAt !== "string" ||
      (!former &&
        (typeof record.senderUserId !== "string" || typeof record.senderIdentityPublic !== "string"))
    ) {
      return [];
    }
    if (
      typeof record.messageId !== "string" ||
      typeof record.threadId !== "string" ||
      typeof record.bodyNonce !== "string" ||
      typeof record.bodyCiphertext !== "string" ||
      typeof record.bodySig !== "string" ||
      !Array.isArray(record.envelopes)
    ) {
      return [];
    }
    const envelopes: EnvelopeWire[] = [];
    for (const envelope of record.envelopes) {
      const parsed = readEnvelope(envelope);
      if (!parsed) return [];
      envelopes.push(parsed);
    }
    return [
      {
        senderUserId: former ? "" : (record.senderUserId as string),
        senderIdentityPublic: former ? "" : (record.senderIdentityPublic as string),
        former,
        createdAt: record.createdAt,
        sender,
        message: {
          messageId: record.messageId,
          threadId: record.threadId,
          senderDeviceId: sender?.deviceId ?? "",
          bodyNonce: record.bodyNonce,
          bodyCiphertext: record.bodyCiphertext,
          bodySig: record.bodySig,
          envelopes,
        },
      },
    ];
  });
}

function readEnvelope(item: unknown): EnvelopeWire | null {
  if (!item || typeof item !== "object") return null;
  const envelope = item as Record<string, unknown>;
  if (
    typeof envelope.nonce !== "string" ||
    typeof envelope.ciphertext !== "string" ||
    typeof envelope.ephemeralPublic !== "string"
  ) {
    return null;
  }
  const recipientDeviceId =
    typeof envelope.recipientDeviceId === "string" ? envelope.recipientDeviceId : null;
  const recipientUserBackup =
    typeof envelope.recipientUserBackup === "string" ? envelope.recipientUserBackup : null;
  const prekeyId = typeof envelope.prekeyId === "string" ? envelope.prekeyId : null;
  const signedPrekeyId =
    typeof envelope.signedPrekeyId === "string" ? envelope.signedPrekeyId : null;
  return {
    recipientDeviceId,
    recipientUserBackup,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    ephemeralPublic: envelope.ephemeralPublic,
    prekeyId,
    signedPrekeyId,
  };
}
