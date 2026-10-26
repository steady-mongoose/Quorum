import { addUnauthorizedHandler, apiFetch } from "../api-base.ts";
import type { DmTransport, VaultState, VaultStore } from "./mailbox.ts";
import { createVaultKey, openVault, sealVault, type SealedVault } from "./vault-wrap.ts";

const DB_NAME = "avouch-e2ee";
const STORE = "vault";
/** Seals the device identity, one-time keys, and safety pins. Sign-out keeps these. */
const KEY_ID = "wrapping-key";
const BLOB_ID = "sealed";
/** Seals only the decrypted-message cache. Sign-out deletes this key and its blob. */
const CACHE_KEY_ID = "cache-key";
const CACHE_BLOB_ID = "message-cache";
/** Older builds kept the vault unsealed. It is wrapped once, then removed. */
const LEGACY_KEY = "avouch-e2ee-vault-v1";

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

function withoutOpened(state: VaultState): VaultState {
  if (!state.opened) return state;
  const next = structuredClone(state);
  delete next.opened;
  return next;
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

async function readDevice(db: IDBDatabase): Promise<VaultState | null> {
  const sealed = await idbGet<SealedVault>(db, BLOB_ID);
  if (!sealed) return null;
  const key = await storedKey(db, KEY_ID, false);
  if (!key) return null;
  const parsed = JSON.parse(await openVault(key, sealed)) as VaultState;
  return usable(parsed) ? parsed : null;
}

async function readMessageCache(db: IDBDatabase): Promise<OpenedMessages | undefined> {
  const sealed = await idbGet<SealedVault>(db, CACHE_BLOB_ID);
  if (!sealed) return undefined;
  const key = await storedKey(db, CACHE_KEY_ID, false);
  if (!key) return undefined;
  const parsed = JSON.parse(await openVault(key, sealed)) as OpenedMessages;
  return Array.isArray(parsed) ? parsed : undefined;
}

async function writeDevice(db: IDBDatabase, state: VaultState, ticket: number): Promise<void> {
  if (ticket !== deviceGeneration) return;
  const key = await storedKey(db, KEY_ID, true);
  if (!key || ticket !== deviceGeneration) return;
  const sealed = await sealVault(key, JSON.stringify(withoutOpened(state)));
  if (ticket !== deviceGeneration) return;
  await idbPut(db, BLOB_ID, sealed);
  dropLegacy();
}

async function writeMessageCache(
  db: IDBDatabase,
  opened: OpenedMessages,
  ticket: number,
): Promise<void> {
  if (ticket !== cacheEpoch || cacheClosed) return;
  const key = await storedKey(db, CACHE_KEY_ID, true);
  if (!key || ticket !== cacheEpoch || cacheClosed) return;
  const sealed = await sealVault(key, JSON.stringify(opened));
  if (ticket !== cacheEpoch || cacheClosed) return;
  await idbPut(db, CACHE_BLOB_ID, sealed);
}

async function readSealed(): Promise<VaultState | null> {
  const db = await openDb();
  const deviceTicket = deviceGeneration;
  try {
    let state = await readDevice(db);
    if (!state) {
      const legacy = legacyVault();
      if (!legacy) return null;
      let parsed: VaultState;
      try {
        parsed = JSON.parse(legacy) as VaultState;
      } catch {
        return null;
      }
      if (!usable(parsed)) return null;
      const opened = parsed.opened;
      state = withoutOpened(parsed);
      await writeDevice(db, state, deviceTicket);
      if (opened?.length && !cacheClosed) {
        await writeMessageCache(db, opened, cacheEpoch);
        return { ...state, opened };
      }
      return state;
    }
    if (state.opened?.length) {
      const opened = state.opened;
      const device = withoutOpened(state);
      await writeDevice(db, device, deviceTicket);
      if (!cacheClosed) {
        await writeMessageCache(db, opened, cacheEpoch);
        return { ...device, opened };
      }
      return device;
    }
    if (cacheClosed) return state;
    const opened = await readMessageCache(db);
    return opened ? { ...state, opened } : state;
  } finally {
    db.close();
  }
}

async function stripOpenedFromDevice(ticket: number): Promise<void> {
  const db = await openDb();
  try {
    if (ticket !== deviceGeneration) return;
    const sealed = await idbGet<SealedVault>(db, BLOB_ID);
    if (!sealed) {
      const legacy = legacyVault();
      if (!legacy) return;
      let parsed: VaultState;
      try {
        parsed = JSON.parse(legacy) as VaultState;
      } catch {
        dropLegacy();
        return;
      }
      if (!usable(parsed)) {
        dropLegacy();
        return;
      }
      await writeDevice(db, withoutOpened(parsed), ticket);
      return;
    }
    const key = await storedKey(db, KEY_ID, false);
    if (!key) return;
    const parsed = JSON.parse(await openVault(key, sealed)) as VaultState;
    if (!usable(parsed) || !parsed.opened) return;
    await writeDevice(db, withoutOpened(parsed), ticket);
  } finally {
    db.close();
  }
}

let cache: VaultState | null = null;
let deviceGeneration = 0;
let cacheEpoch = 0;
let cacheClosed = false;
let pendingDevice: Promise<void> = Promise.resolve();
let pendingCache: Promise<void> = Promise.resolve();
const cacheListeners = new Set<() => void>();

function notifyCacheCleared(): void {
  for (const listener of cacheListeners) {
    try {
      listener();
    } catch {
      // A view that fails to clear still leaves the sealed cache deleted.
    }
  }
}

/** The mailbox drops decrypted text when sign-out clears the cache. */
export function subscribeMessageCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

/**
 * Sign-out drops the decrypted-message cache and the key that opens it.
 * The device identity, one-time keys, and their wrapping key stay. A cache
 * write that was already in flight does not put the messages back.
 */
export function forgetBrowserVault(): Promise<void> {
  const previousCache = pendingCache;
  const deviceTicket = deviceGeneration;
  cacheEpoch += 1;
  const ticket = cacheEpoch;
  cacheClosed = true;
  if (cache?.opened) {
    const next = structuredClone(cache);
    delete next.opened;
    cache = next;
  }
  notifyCacheCleared();
  const run = (async () => {
    try {
      await previousCache;
      if (ticket !== cacheEpoch) return;
      const db = await openDb();
      try {
        if (ticket !== cacheEpoch) return;
        await idbDelete(db, CACHE_BLOB_ID);
        await idbDelete(db, CACHE_KEY_ID);
      } finally {
        db.close();
      }
      await stripOpenedFromDevice(deviceTicket);
    } finally {
      if (ticket === cacheEpoch && cache?.opened) {
        const next = structuredClone(cache);
        delete next.opened;
        cache = next;
      }
    }
  })();
  pendingCache = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Resolves when the current seal has finished. Tests wait on this. */
export function settleBrowserVault(): Promise<void> {
  return Promise.all([pendingDevice, pendingCache]).then(() => undefined);
}

export async function loadBrowserVault(): Promise<VaultState | null> {
  const epoch = cacheEpoch;
  const deviceTicket = deviceGeneration;
  cacheClosed = false;
  try {
    const parsed = await readSealed();
    if (epoch !== cacheEpoch || cacheClosed) {
      const device = parsed ? withoutOpened(parsed) : null;
      if (deviceTicket === deviceGeneration) cache = device;
      return cache ? structuredClone(cache) : null;
    }
    if (deviceTicket !== deviceGeneration) return cache ? structuredClone(cache) : null;
    cache = parsed;
  } catch {
    if (epoch === cacheEpoch && deviceTicket === deviceGeneration) cache = null;
  }
  return cache ? structuredClone(cache) : null;
}

export function browserVaultStore(onWrite?: (state: VaultState) => void): VaultStore {
  return {
    read: () => (cache ? structuredClone(cache) : null),
    write(state) {
      deviceGeneration += 1;
      const deviceTicket = deviceGeneration;
      const epoch = cacheEpoch;
      const closed = cacheClosed;
      const next = structuredClone(state);
      if (closed) delete next.opened;
      cache = structuredClone(next);
      const deviceWork = (async () => {
        const db = await openDb();
        try {
          await writeDevice(db, next, deviceTicket);
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
            await writeMessageCache(db, next.opened ?? [], epoch);
          } finally {
            db.close();
          }
        })();
        pendingCache = cacheWork.then(
          () => undefined,
          () => undefined,
        );
      }
      onWrite?.(next);
    },
  };
}

addUnauthorizedHandler(() => {
  void forgetBrowserVault();
});
