import { apiFetch } from "../api-base.ts";
import type { DmTransport, VaultState, VaultStore } from "./mailbox.ts";
import { createVaultKey, openVault, sealVault, type SealedVault } from "./vault-wrap.ts";

const DB_NAME = "avouch-e2ee";
const STORE = "vault";
const KEY_ID = "wrapping-key";
const BLOB_ID = "sealed";
/** Older builds kept the vault as plaintext. It is wrapped once, then removed. */
const LEGACY_KEY = "avouch-e2ee-vault-v1";

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

async function wrappingKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(db, KEY_ID);
  if (existing) return existing;
  const created = await createVaultKey();
  await idbPut(db, KEY_ID, created);
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
    // The plaintext copy is already gone, or this browser has no localStorage.
  }
}

async function readSealed(): Promise<VaultState | null> {
  const db = await openDb();
  try {
    const sealed = await idbGet<SealedVault>(db, BLOB_ID);
    if (!sealed) {
      const legacy = legacyVault();
      if (!legacy) return null;
      const parsed = JSON.parse(legacy) as VaultState;
      if (!parsed?.device?.boxSecret || !parsed.userId) return null;
      const key = await wrappingKey(db);
      await idbPut(db, BLOB_ID, await sealVault(key, JSON.stringify(parsed)));
      dropLegacy();
      return parsed;
    }
    const key = await wrappingKey(db);
    const json = await openVault(key, sealed);
    const parsed = JSON.parse(json) as VaultState;
    if (!parsed?.device?.boxSecret || !parsed.userId) return null;
    return parsed;
  } finally {
    db.close();
  }
}

async function writeSealed(state: VaultState, ticket: number): Promise<void> {
  const db = await openDb();
  try {
    if (ticket !== generation || forgetting) return;
    const key = await wrappingKey(db);
    const sealed = await sealVault(key, JSON.stringify(state));
    if (ticket !== generation || forgetting) return;
    await idbPut(db, BLOB_ID, sealed);
    dropLegacy();
  } finally {
    db.close();
  }
}

let cache: VaultState | null = null;
let generation = 0;
let forgetting = false;
let pending: Promise<void> = Promise.resolve();

/**
 * Sign-out drops the sealed vault, including decrypted messages, and the
 * wrapping key. The in-memory copy is cleared too. A write that was already
 * in flight does not put the blob back.
 */
export async function forgetBrowserVault(): Promise<void> {
  forgetting = true;
  generation += 1;
  cache = null;
  const ticket = generation;
  try {
    await pending;
    if (ticket !== generation) return;
    const db = await openDb();
    try {
      if (ticket !== generation) return;
      await idbDelete(db, BLOB_ID);
      await idbDelete(db, KEY_ID);
      dropLegacy();
    } finally {
      db.close();
    }
  } finally {
    if (ticket === generation) {
      cache = null;
      forgetting = false;
    }
  }
}

/** Resolves when the current seal has finished. Tests wait on this. */
export function settleBrowserVault(): Promise<void> {
  return pending;
}

export async function loadBrowserVault(): Promise<VaultState | null> {
  const ticket = generation;
  try {
    const parsed = await readSealed();
    if (ticket !== generation || forgetting) {
      cache = null;
      return null;
    }
    cache = parsed;
  } catch {
    if (ticket === generation) cache = null;
  }
  return cache ? structuredClone(cache) : null;
}

export function browserVaultStore(onWrite?: (state: VaultState) => void): VaultStore {
  return {
    read: () => (cache ? structuredClone(cache) : null),
    write(state) {
      if (forgetting) return;
      const ticket = generation;
      cache = structuredClone(state);
      pending = writeSealed(state, ticket).catch(() => {
        // The in-memory copy still works for this page. The next load will retry.
      });
      onWrite?.(state);
    },
  };
}
