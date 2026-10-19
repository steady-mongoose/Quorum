/**
 * The member's mailbox. It speaks to the API in ciphertext and keeps
 * private keys in the vault the caller provides (this browser, or a test).
 */

import { DM_PREKEY_BATCH, dmTextError } from "./limits.ts";
import {
  createBackupKey,
  createDevice,
  createPrekeys,
  decryptBackupSecret,
  encryptBackupSecret,
  isMemberId,
  isUuid,
  openMessage,
  safetyNumber,
  sealMessage,
  verifyDeviceStatement,
  verifyPrekey,
  type BackupCipher,
  type BackupKey,
  type DeviceRecord,
  type EnvelopeWire,
  type MessageWire,
  type PublicDevice,
  type PublicPrekey,
  type SealDestination,
} from "./protocol.ts";

export type VaultState = {
  userId: string;
  device: DeviceRecord;
  backup: (BackupKey & { userId: string }) | null;
  /** First-seen backup public keys. A later change means the server swapped one. */
  pins: { userId: string; boxPublic: string }[];
  /** Safety numbers the member has compared out of band. */
  confirmed: { userId: string; safety: string }[];
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
  current: boolean;
};

type BundleDevice = PublicDevice & { prekey: PublicPrekey | null };
type Bundle = { userId: string; backupPublic: string | null; devices: BundleDevice[] };

function messageOf(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string" &&
    body.error
  ) {
    return body.error;
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
  return { userId, device, backup: null, pins: [], confirmed: [] };
}

function registrationBody(state: VaultState): unknown {
  return {
    deviceId: state.device.deviceId,
    label: state.device.label,
    signPublic: state.device.signPublic,
    boxPublic: state.device.boxPublic,
    statementSig: state.device.statementSig,
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
  if (!mine || mine.prekeysLeft >= 3) return { ok: true };
  const extra = await createPrekeys(state.device, DM_PREKEY_BATCH);
  const next = vault.read();
  if (!next) return { ok: false, message: "Create keys on this device first." };
  next.device.prekeys.push(...extra);
  vault.write(next);
  const response = await expectOk(
    await transport.post(`/api/dm/devices/${next.device.deviceId}/prekeys`, {
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
  strength: "interactive" | "min" = "interactive",
): Promise<{ ok: true } | { ok: false; message: string }> {
  const state = vault.read();
  if (!state) return { ok: false, message: "Create keys on this device first." };
  const backup = state.backup ?? { ...(await createBackupKey()), userId: state.userId };
  const cipher = await encryptBackupSecret(backup.boxSecret, passphrase, strength);
  if (!cipher.ok) return cipher;
  const response = await expectOk(
    await transport.post("/api/dm/backup", { boxPublic: backup.boxPublic, ...cipher.value }),
    "The key backup was not saved.",
  );
  if (!response.ok) return response;
  const next = vault.read() ?? state;
  next.backup = backup;
  next.pins = pin(next.pins, state.userId, backup.boxPublic);
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
  const device = await createDevice({ userId, label });
  const vault: VaultState = {
    userId,
    device,
    backup: { userId, boxPublic: record.boxPublic, boxSecret: secret },
    pins: [{ userId, boxPublic: record.boxPublic }],
    confirmed: [],
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
 * prekey is taken. The caller opens the conversation first when the server
 * requires one.
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

  const minePreview = await previewKeys(transport, state.userId);
  const theirPreview = await previewKeys(transport, otherUserId);
  if (!minePreview.ok) return minePreview;
  if (!theirPreview.ok) return theirPreview;
  if (theirPreview.deviceCount === 0)
    return { ok: false, message: "That member has no device yet." };

  const pinCheck = applyPins(state, [
    { userId: state.userId, boxPublic: minePreview.backupPublic },
    { userId: otherUserId, boxPublic: theirPreview.backupPublic },
  ]);
  if (!pinCheck.ok) return pinCheck;
  vault.write(pinCheck.state);

  const safety =
    pinCheck.state.backup && theirPreview.backupPublic
      ? await safetyNumber(pinCheck.state.backup.boxPublic, theirPreview.backupPublic)
      : null;
  if (
    safety &&
    !pinCheck.state.confirmed.some((item) => item.userId === otherUserId && item.safety === safety)
  ) {
    return {
      ok: false,
      message: "Compare safety numbers before you send.",
      safety,
    };
  }

  const fresh = vault.read();
  if (!fresh) return { ok: false, message: "Create keys on this device first." };
  const mine = await claimBundle(transport, fresh.userId);
  const theirs = await claimBundle(transport, otherUserId);
  if (!mine.ok) return mine;
  if (!theirs.ok) return theirs;
  if (theirs.bundle.devices.length === 0) {
    return { ok: false, message: "That member has no device yet." };
  }

  const destinations: SealDestination[] = [];
  for (const bundle of [mine.bundle, theirs.bundle]) {
    for (const device of bundle.devices) {
      if (!(await verifyDeviceStatement(bundle.userId, device))) {
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
      destinations.push({ kind: "device", userId: bundle.userId, device, prekey: device.prekey });
    }
    if (bundle.backupPublic) {
      destinations.push({ kind: "backup", userId: bundle.userId, boxPublic: bundle.backupPublic });
    }
  }

  const warning =
    safety === null
      ? "There is no safety number yet. Set a key backup, and ask them to set one, before you trust this conversation."
      : null;
  return { ok: true, destinations, warning, sender: pinCheck.state.device };
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
): Promise<
  { ok: true; messages: DecodedMessage[]; unreadable: number } | { ok: false; message: string }
> {
  const state = vault.read();
  if (!state) return { ok: false, message: "Create keys on this device first." };
  const response = await expectOk(
    await transport.get(`/api/dm/threads/${threadId}/messages`),
    "Messages did not load.",
  );
  if (!response.ok) return response;
  const rows = readMessageRows(response.body);
  const messages: DecodedMessage[] = [];
  let unreadable = 0;
  const consumed: string[] = [];
  for (const row of rows) {
    const opened = await openMessage({
      message: row.message,
      senderUserId: row.senderUserId,
      sender: row.sender,
      recipientDevice: state.device,
      backup: state.backup,
    });
    if (!opened.ok) {
      unreadable += 1;
      continue;
    }
    if (opened.consumedPrekeyId) consumed.push(opened.consumedPrekeyId);
    messages.push({
      id: row.message.messageId,
      from: row.senderUserId === myUserId ? myName : otherName,
      text: opened.text,
      at: Date.parse(row.createdAt),
    });
  }
  if (consumed.length > 0) {
    const next = vault.read();
    if (next) {
      next.device.prekeys = next.device.prekeys.filter((prekey) => !consumed.includes(prekey.id));
      vault.write(next);
    }
  }
  return { ok: true, messages, unreadable };
}

function pin(
  pins: { userId: string; boxPublic: string }[],
  userId: string,
  boxPublic: string,
): { userId: string; boxPublic: string }[] {
  const rest = pins.filter((item) => item.userId !== userId);
  return [...rest, { userId, boxPublic }];
}

function applyPins(
  state: VaultState,
  found: { userId: string; boxPublic: string | null }[],
): { ok: true; state: VaultState } | { ok: false; message: string } {
  const next: VaultState = {
    ...state,
    pins: state.pins.map((item) => ({ ...item })),
    confirmed: state.confirmed.map((item) => ({ ...item })),
    device: state.device,
    backup: state.backup,
  };
  for (const item of found) {
    if (!item.boxPublic) continue;
    const seen = next.pins.find((pinItem) => pinItem.userId === item.userId);
    if (!seen) {
      next.pins = pin(next.pins, item.userId, item.boxPublic);
      continue;
    }
    if (seen.boxPublic !== item.boxPublic) {
      return {
        ok: false,
        message: "A backup key changed. Do not send until you confirm this in person.",
      };
    }
  }
  return { ok: true, state: next };
}

async function previewKeys(
  transport: DmTransport,
  userId: string,
): Promise<
  { ok: true; backupPublic: string | null; deviceCount: number } | { ok: false; message: string }
> {
  const response = await expectOk(
    await transport.get(`/api/dm/keys?userId=${encodeURIComponent(userId)}`),
    "The device keys did not load.",
  );
  if (!response.ok) return response;
  const body = response.body;
  if (!body || typeof body !== "object")
    return { ok: false, message: "The device keys did not load." };
  const record = body as { userId?: unknown; backupPublic?: unknown; deviceCount?: unknown };
  if (record.userId !== userId || typeof record.deviceCount !== "number") {
    return { ok: false, message: "The device keys did not load." };
  }
  return {
    ok: true,
    backupPublic: typeof record.backupPublic === "string" ? record.backupPublic : null,
    deviceCount: record.deviceCount,
  };
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

function readBundle(body: unknown, userId: string): Bundle | null {
  if (!body || typeof body !== "object") return null;
  const record = body as {
    userId?: unknown;
    backupPublic?: unknown;
    devices?: unknown;
  };
  if (record.userId !== userId || !Array.isArray(record.devices)) return null;
  const devices: BundleDevice[] = [];
  for (const item of record.devices) {
    const device = readPublicDevice(item);
    if (!device) return null;
    const prekey = readPrekey(item);
    devices.push({ ...device, prekey });
  }
  const backupPublic = typeof record.backupPublic === "string" ? record.backupPublic : null;
  return { userId, backupPublic, devices };
}

function readPublicDevice(item: unknown): PublicDevice | null {
  if (!item || typeof item !== "object") return null;
  const device = item as Record<string, unknown>;
  if (
    typeof device.deviceId !== "string" ||
    typeof device.signPublic !== "string" ||
    typeof device.boxPublic !== "string" ||
    typeof device.statementSig !== "string"
  ) {
    return null;
  }
  return {
    deviceId: device.deviceId,
    signPublic: device.signPublic,
    boxPublic: device.boxPublic,
    statementSig: device.statementSig,
  };
}

function readPrekey(item: unknown): PublicPrekey | null {
  if (!item || typeof item !== "object" || !("prekey" in item)) return null;
  const prekey = (item as { prekey?: unknown }).prekey;
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
  createdAt: string;
  sender: PublicDevice;
  message: MessageWire;
};

function readMessageRows(body: unknown): MessageRow[] {
  if (!body || typeof body !== "object" || !("messages" in body) || !Array.isArray(body.messages))
    return [];
  return body.messages.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const sender = readPublicDevice(record.sender);
    if (!sender || typeof record.senderUserId !== "string" || typeof record.createdAt !== "string")
      return [];
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
        senderUserId: record.senderUserId,
        createdAt: record.createdAt,
        sender,
        message: {
          messageId: record.messageId,
          threadId: record.threadId,
          senderDeviceId: sender.deviceId,
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
  return {
    recipientDeviceId,
    recipientUserBackup,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    ephemeralPublic: envelope.ephemeralPublic,
    prekeyId,
  };
}
