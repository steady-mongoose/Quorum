import { addUnauthorizedHandler, apiFetch } from "../api-base.ts";
import type { DmTransport, VaultState, VaultStore } from "./mailbox.ts";
import { createVaultKey, openVault, sealVault, type SealedVault } from "./vault-wrap.ts";

const DB_NAME = "avouch-e2ee";
const STORE = "vault";
/** Older builds kept one shared slot. A vault is migrated into the owner's slot. */
const LEGACY_DEVICE_KEY = "wrapping-key";
const LEGACY_DEVICE_BLOB = "sealed";
const LEGACY_CACHE_KEY = "cache-key";
const LEGACY_CACHE_BLOB = "message-cache";
/** Older builds kept the vault unsealed. It is wrapped once, then removed. */
const LEGACY_KEY = "avouch-e2ee-vault-v1";
const ACCOUNT_INDEX = "account-index";

function deviceKeyId(userId: string): string {
  return `wrapping-key:${userId}`;
}

function deviceBlobId(userId: string): string {
  return `sealed:${userId}`;
}

function cacheKeyId(userId: string): string {
  return `cache-key:${userId}`;
}

function cacheBlobId(userId: string): string {
  return `message-cache:${userId}`;
}

function isCacheRecord(id: string): boolean {
  return (
    id === LEGACY_CACHE_KEY ||
    id === LEGACY_CACHE_BLOB ||
    id.startsWith("cache-key:") ||
    id.startsWith("message-cache:")
  );
}

type OpenedMessages = NonNullable<VaultState["opened"]>;

export function browserTransport(): DmTransport {
  return {
    async post(path, body) {
      const response = await apiFetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    async get(path) {
      const response = await apiFetch(path, { credentials: "include" });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The key store did not open."));
  });
}

function idbGet<T>(db: IDBDatabase, id: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error("The key store did not open."));
  });
}

function idbPut(db: IDBDatabase, id: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("The key store did not open."));
  });
}

function idbDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("The key store did not open."));
  });
}

function idbKeys(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    if (typeof store.getAllKeys !== "function") {
      resolve([]);
      return;
    }
    const request = store.getAllKeys();
    request.onsuccess = () =>
      resolve(((request.result ?? []) as IDBValidKey[]).map((key) => String(key)));
    request.onerror = () => reject(request.error ?? new Error("The key store did not open."));
  });
}

function withoutOpened(state: VaultState): VaultState {
  if (!state.opened) return state;
  const next = structuredClone(state);
  delete next.opened;
  return next;
}

let cache: VaultState | null = null;
let activeUserId: string | null = null;
const deviceTicketByUser = new Map<string, number>();
const cacheTicketByUser = new Map<string, number>();
const cacheClosedUsers = new Set<string>();
let pendingDevice: Promise<void> = Promise.resolve();
let pendingCache: Promise<void> = Promise.resolve();
const cacheListeners = new Set<() => void>();

function deviceTicket(userId: string): number {
  return deviceTicketByUser.get(userId) ?? 0;
}

function nextDeviceTicket(userId: string): number {
  const ticket = deviceTicket(userId) + 1;
  deviceTicketByUser.set(userId, ticket);
  return ticket;
}

function messageTicket(userId: string): number {
  return cacheTicketByUser.get(userId) ?? 0;
}

function nextMessageTicket(userId: string): number {
  const ticket = messageTicket(userId) + 1;
  cacheTicketByUser.set(userId, ticket);
  return ticket;
}

function holdsActiveUser(state: VaultState | null): state is VaultState {
  if (!state) return false;
  if (activeUserId && state.userId !== activeUserId) return false;
  return true;
}

async function storedKey(db: IDBDatabase, id: string, create: boolean): Promise<CryptoKey | null> {
  const existing = await idbGet<CryptoKey>(db, id);
  if (existing || !create) return existing ?? null;
  const created = await createVaultKey();
  await idbPut(db, id, created);
  return created;
}

function legacyVault(): string | null {
  try {
    return localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
}

function dropLegacy(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // The unsealed copy is already gone, or this browser has no localStorage.
  }
}

function usable(state: VaultState | null): state is VaultState {
  return Boolean(state?.device?.boxSecret && state.userId);
}

function notifyCacheCleared(): void {
  for (const listener of cacheListeners) {
    try {
      listener();
    } catch {
      // A view that fails to clear still leaves the sealed cache deleted.
    }
  }
}

async function rememberAccount(db: IDBDatabase, userId: string): Promise<void> {
  const existing = (await idbGet<string[]>(db, ACCOUNT_INDEX)) ?? [];
  if (existing.includes(userId)) return;
  await idbPut(db, ACCOUNT_INDEX, [...existing, userId]);
}

async function readScopedDevice(db: IDBDatabase, userId: string): Promise<VaultState | null> {
  const sealed = await idbGet<SealedVault>(db, deviceBlobId(userId));
  if (!sealed) return null;
  const key = await storedKey(db, deviceKeyId(userId), false);
  if (!key) return null;
  const parsed = JSON.parse(await openVault(key, sealed)) as VaultState;
  if (!usable(parsed) || parsed.userId !== userId) return null;
  return parsed;
}

async function readScopedCache(db: IDBDatabase, userId: string): Promise<OpenedMessages | undefined> {
  const sealed = await idbGet<SealedVault>(db, cacheBlobId(userId));
  if (!sealed) return undefined;
  const key = await storedKey(db, cacheKeyId(userId), false);
  if (!key) return undefined;
  const parsed = JSON.parse(await openVault(key, sealed)) as OpenedMessages;
  return Array.isArray(parsed) ? parsed : undefined;
}

async function writeScopedDevice(db: IDBDatabase, state: VaultState, ticket: number): Promise<void> {
  const userId = state.userId;
  if (!userId || ticket !== deviceTicket(userId)) return;
  const key = await storedKey(db, deviceKeyId(userId), true);
  if (!key || ticket !== deviceTicket(userId)) return;
  const sealed = await sealVault(key, JSON.stringify(withoutOpened(state)));
  if (ticket !== deviceTicket(userId)) return;
  await idbPut(db, deviceBlobId(userId), sealed);
  await rememberAccount(db, userId);
}

async function writeScopedCache(
  db: IDBDatabase,
  userId: string,
  opened: OpenedMessages,
  ticket: number,
): Promise<void> {
  if (!userId || ticket !== messageTicket(userId) || cacheClosedUsers.has(userId)) return;
  const key = await storedKey(db, cacheKeyId(userId), true);
  if (!key || ticket !== messageTicket(userId) || cacheClosedUsers.has(userId)) return;
  const sealed = await sealVault(key, JSON.stringify(opened));
  if (ticket !== messageTicket(userId) || cacheClosedUsers.has(userId)) return;
  await idbPut(db, cacheBlobId(userId), sealed);
}

async function readLegacyDevice(db: IDBDatabase): Promise<VaultState | null> {
  const sealed = await idbGet<SealedVault>(db, LEGACY_DEVICE_BLOB);
  if (sealed) {
    const key = await storedKey(db, LEGACY_DEVICE_KEY, false);
    if (!key) return null;
    const parsed = JSON.parse(await openVault(key, sealed)) as VaultState;
    return usable(parsed) ? parsed : null;
  }
  const raw = legacyVault();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VaultState;
    return usable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readLegacyCache(db: IDBDatabase): Promise<OpenedMessages | undefined> {
  const sealed = await idbGet<SealedVault>(db, LEGACY_CACHE_BLOB);
  if (!sealed) return undefined;
  const key = await storedKey(db, LEGACY_CACHE_KEY, false);
  if (!key) return undefined;
  const parsed = JSON.parse(await openVault(key, sealed)) as OpenedMessages;
  return Array.isArray(parsed) ? parsed : undefined;
}

async function dropLegacySlot(db: IDBDatabase): Promise<void> {
  await idbDelete(db, LEGACY_DEVICE_BLOB);
  await idbDelete(db, LEGACY_DEVICE_KEY);
  await idbDelete(db, LEGACY_CACHE_BLOB);
  await idbDelete(db, LEGACY_CACHE_KEY);
  dropLegacy();
}

/** Move the old shared slot into this account's slot when it belongs to them. */
async function takeLegacyIfOwner(
  db: IDBDatabase,
  userId: string,
  ticket: number,
): Promise<VaultState | null> {
  const legacy = await readLegacyDevice(db);
  if (!legacy || legacy.userId !== userId) return null;
  const opened = legacy.opened?.length ? legacy.opened : await readLegacyCache(db);
  const device = withoutOpened(legacy);
  await writeScopedDevice(db, device, ticket);
  if (ticket !== deviceTicket(userId)) return null;
  if (opened?.length && !cacheClosedUsers.has(userId)) {
    await writeScopedCache(db, userId, opened, messageTicket(userId));
  }
  if (ticket !== deviceTicket(userId)) return null;
  await dropLegacySlot(db);
  return opened?.length && !cacheClosedUsers.has(userId) ? { ...device, opened } : device;
}

async function readForUser(userId: string): Promise<VaultState | null> {
  const db = await openDb();
  const ticket = deviceTicket(userId);
  try {
    let state = await readScopedDevice(db, userId);
    if (!state) return takeLegacyIfOwner(db, userId, ticket);
    if (state.opened?.length) {
      const opened = state.opened;
      const device = withoutOpened(state);
      await writeScopedDevice(db, device, ticket);
      if (!cacheClosedUsers.has(userId)) {
        await writeScopedCache(db, userId, opened, messageTicket(userId));
        return { ...device, opened };
      }
      return device;
    }
    if (cacheClosedUsers.has(userId)) return state;
    const opened = await readScopedCache(db, userId);
    return opened ? { ...state, opened } : state;
  } finally {
    db.close();
  }
}

async function stripOpened(userId: string, ticket: number): Promise<void> {
  const db = await openDb();
  try {
    if (ticket !== deviceTicket(userId)) return;
    const state = await readScopedDevice(db, userId);
    if (state?.opened) await writeScopedDevice(db, withoutOpened(state), ticket);
    const legacy = await readLegacyDevice(db);
    if (legacy?.userId === userId && legacy.opened) {
      await writeScopedDevice(db, withoutOpened(legacy), ticket);
      await dropLegacySlot(db);
    }
  } finally {
    db.close();
  }
}

async function deleteMessageCache(userId: string): Promise<void> {
  const db = await openDb();
  try {
    await idbDelete(db, cacheBlobId(userId));
    await idbDelete(db, cacheKeyId(userId));
    const legacy = await readLegacyDevice(db);
    if (legacy?.userId === userId) {
      await idbDelete(db, LEGACY_CACHE_BLOB);
      await idbDelete(db, LEGACY_CACHE_KEY);
    }
  } finally {
    db.close();
  }
}

async function deleteEveryMessageCache(): Promise<void> {
  const db = await openDb();
  try {
    const keys = new Set(await idbKeys(db));
    const indexed = (await idbGet<string[]>(db, ACCOUNT_INDEX)) ?? [];
    for (const userId of indexed) {
      keys.add(cacheBlobId(userId));
      keys.add(cacheKeyId(userId));
    }
    keys.add(LEGACY_CACHE_BLOB);
    keys.add(LEGACY_CACHE_KEY);
    for (const id of keys) {
      if (isCacheRecord(id)) await idbDelete(db, id);
    }
  } finally {
    db.close();
  }
}

/** The mailbox drops decrypted text when sign-out clears the cache. */
export function subscribeMessageCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

function stripMemory(userId: string | null): void {
  if (!cache) return;
  if (userId && cache.userId !== userId) return;
  if (!cache.opened) return;
  const next = structuredClone(cache);
  delete next.opened;
  cache = next;
}

/**
 * Sign-out drops that account's decrypted-message cache and the key that opens it.
 * The device identity, one-time keys, and their wrapping key stay in that account's slot.
 * With no account in memory, every message cache is removed and every device slot stays.
 * A cache write already in flight does not put the messages back.
 */
export function forgetBrowserVault(userId?: string): Promise<void> {
  const known = userId || cache?.userId || "";
  if (!known) return forgetEveryMessageCache();
  return forgetOne(known);
}

function forgetOne(userId: string): Promise<void> {
  const previousCache = pendingCache;
  const ticket = deviceTicket(userId);
  cacheClosedUsers.add(userId);
  nextMessageTicket(userId);
  const messageAtForget = messageTicket(userId);
  stripMemory(userId);
  notifyCacheCleared();
  const run = (async () => {
    try {
      await previousCache;
      if (messageAtForget !== messageTicket(userId)) return;
      await deleteMessageCache(userId);
      await stripOpened(userId, ticket);
    } finally {
      if (messageAtForget === messageTicket(userId)) stripMemory(userId);
    }
  })();
  pendingCache = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function forgetEveryMessageCache(): Promise<void> {
  const previousCache = pendingCache;
  if (cache?.userId) cacheClosedUsers.add(cache.userId);
  stripMemory(null);
  notifyCacheCleared();
  const run = (async () => {
    await previousCache;
    await deleteEveryMessageCache();
    stripMemory(null);
  })();
  pendingCache = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * The signed-in account. Another account's secrets are dropped from memory
 * before the next render. Their sealed slot on disk is left as it is.
 */
export function focusBrowserVault(userId: string | null): void {
  activeUserId = userId;
  if (cache && cache.userId !== userId) cache = null;
}

/** Resolves when the current seal has finished. Tests wait on this. */
export function settleBrowserVault(): Promise<void> {
  return Promise.all([pendingDevice, pendingCache]).then(() => undefined);
}

/**
 * Load one account's sealed keys. Another account's vault is not read into memory.
 * A missing user id reloads the account already in memory, or nothing.
 */
export async function loadBrowserVault(userId?: string): Promise<VaultState | null> {
  const id = userId || (holdsActiveUser(cache) ? cache.userId : activeUserId) || "";
  if (!id) {
    cache = null;
    activeUserId = null;
    return null;
  }
  activeUserId = id;
  if (cache && cache.userId !== id) cache = null;
  cacheClosedUsers.delete(id);
  const epoch = messageTicket(id);
  const deviceAtStart = deviceTicket(id);
  try {
    const parsed = await readForUser(id);
    const stillThisAccount = activeUserId === id && deviceTicket(id) === deviceAtStart;
    if (parsed && parsed.userId !== id) {
      if (stillThisAccount) cache = null;
      return null;
    }
    if (cacheClosedUsers.has(id) || epoch !== messageTicket(id)) {
      const device = parsed ? withoutOpened(parsed) : null;
      if (stillThisAccount) cache = device;
      return holdsActiveUser(cache) ? structuredClone(cache) : null;
    }
    if (!stillThisAccount) return holdsActiveUser(cache) ? structuredClone(cache) : null;
    cache = parsed;
  } catch {
    if (activeUserId === id && deviceTicket(id) === deviceAtStart) cache = null;
  }
  return holdsActiveUser(cache) ? structuredClone(cache) : null;
}

export function browserVaultStore(onWrite?: (state: VaultState) => void): VaultStore {
  return {
    read: () => (holdsActiveUser(cache) ? structuredClone(cache) : null),
    write(state) {
      const userId = state.userId;
      if (!userId) return;
      const ticket = nextDeviceTicket(userId);
      const epoch = messageTicket(userId);
      const closed = cacheClosedUsers.has(userId);
      const next = structuredClone(state);
      if (closed) delete next.opened;
      if (!activeUserId || activeUserId === userId) {
        activeUserId = userId;
        cache = structuredClone(next);
      }
      const deviceWork = (async () => {
        const db = await openDb();
        try {
          await writeScopedDevice(db, next, ticket);
        } finally {
          db.close();
        }
      })();
      pendingDevice = deviceWork.then(
        () => undefined,
        () => undefined,
      );
      if (!closed && next.opened) {
        const cacheWork = (async () => {
          const db = await openDb();
          try {
            await writeScopedCache(db, userId, next.opened ?? [], epoch);
          } finally {
            db.close();
          }
        })();
        pendingCache = cacheWork.then(
          () => undefined,
          () => undefined,
        );
      }
      if (!activeUserId || activeUserId === userId) onWrite?.(next);
    },
  };
}

addUnauthorizedHandler(() => {
  void forgetBrowserVault();
});
