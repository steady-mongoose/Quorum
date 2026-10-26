import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { apiFetch } from "../api-base.ts";
import {
  browserVaultStore,
  forgetBrowserVault,
  loadBrowserVault,
  settleBrowserVault,
} from "./browser.ts";
import type { VaultState } from "./mailbox.ts";

const TEXT = "Bring the saw to the framing night.";

type Store = Map<string, unknown>;

function installMemoryIndexedDb(): Map<string, { stores: Map<string, Store> }> {
  const databases = new Map<string, { version: number; stores: Map<string, Store> }>();
  function database(record: { stores: Map<string, Store> }) {
    return {
      objectStoreNames: {
        contains(name: string) {
          return record.stores.has(name);
        },
      },
      createObjectStore(name: string) {
        record.stores.set(name, new Map());
      },
      transaction(name: string) {
        const store = record.stores.get(name);
        if (!store) throw new Error("missing store");
        return {
          objectStore() {
            return {
              get(id: string) {
                const request: { result?: unknown; onsuccess: (() => void) | null } = {
                  onsuccess: null,
                };
                queueMicrotask(() => {
                  request.result = store.get(id);
                  request.onsuccess?.();
                });
                return request;
              },
              put(value: unknown, id: string) {
                const request: { onsuccess: (() => void) | null } = { onsuccess: null };
                queueMicrotask(() => {
                  store.set(id, value);
                  request.onsuccess?.();
                });
                return request;
              },
              delete(id: string) {
                const request: { onsuccess: (() => void) | null } = { onsuccess: null };
                queueMicrotask(() => {
                  store.delete(id);
                  request.onsuccess?.();
                });
                return request;
              },
            };
          },
        };
      },
      close() {},
    };
  }
  globalThis.indexedDB = {
    open(name: string, version: number) {
      const request: {
        result?: ReturnType<typeof database>;
        onsuccess: (() => void) | null;
        onupgradeneeded: (() => void) | null;
        onerror: (() => void) | null;
      } = { onsuccess: null, onupgradeneeded: null, onerror: null };
      queueMicrotask(() => {
        let record = databases.get(name);
        if (!record) {
          record = { version: 0, stores: new Map() };
          databases.set(name, record);
        }
        request.result = database(record);
        if (record.version < version) {
          request.onupgradeneeded?.();
          record.version = version;
        }
        request.onsuccess?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
  return databases;
}

function vault(): VaultState {
  return {
    userId: "member-1",
    device: { boxSecret: "device-secret", deviceId: "device-1" },
    backup: null,
    pins: [],
    confirmed: [],
    spentPrekeys: [],
    opened: [
      {
        id: "message-1",
        threadId: "thread-1",
        from: "Ada",
        text: TEXT,
        at: 1,
        bodyCiphertext: "cipher",
        senderDeviceId: "device-2",
        senderUserId: "member-2",
        envelopes: [],
      },
    ],
  } as VaultState;
}

function cipherHasText(saved: Store | undefined, id: string): boolean {
  const sealed = saved?.get(id) as { ciphertext?: ArrayBuffer } | undefined;
  const bytes = new Uint8Array(sealed?.ciphertext ?? new ArrayBuffer(0));
  return new TextDecoder().decode(bytes).includes(TEXT);
}

test("sign-out deletes only the decrypted-message cache and its key", async () => {
  const databases = installMemoryIndexedDb();
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  const session = readFileSync(new URL("../server-session.tsx", import.meta.url), "utf8");
  assert.match(app, /server\.signOut\(\)\.finally/);
  assert.doesNotMatch(app, /forgetBrowserVault/);
  assert.match(session, /await forgetBrowserVault\(\)[\s\S]*await signOutServer\(\)/);
  assert.match(session, /response\.status === 401 \|\| \(response\.status === 200 && !session\)/);

  await loadBrowserVault();
  const store = browserVaultStore();
  store.write(vault());
  await settleBrowserVault();
  const loaded = await loadBrowserVault();
  assert.equal(loaded?.opened?.[0]?.text, TEXT);
  assert.equal(loaded?.device.boxSecret, "device-secret");
  const saved = databases.get("avouch-e2ee")?.stores.get("vault");
  assert.equal(saved?.has("wrapping-key"), true);
  assert.equal(saved?.has("sealed"), true);
  assert.equal(saved?.has("cache-key"), true);
  assert.equal(saved?.has("message-cache"), true);
  assert.equal(cipherHasText(saved, "sealed"), false);
  assert.equal(cipherHasText(saved, "message-cache"), false);

  const raced = browserVaultStore();
  raced.write(vault());
  await forgetBrowserVault();
  await settleBrowserVault();
  assert.equal(raced.read()?.device.boxSecret, "device-secret");
  assert.equal(raced.read()?.opened, undefined);
  assert.equal(saved?.has("wrapping-key"), true);
  assert.equal(saved?.has("sealed"), true);
  assert.equal(saved?.has("cache-key"), false);
  assert.equal(saved?.has("message-cache"), false);
  assert.equal(cipherHasText(saved, "sealed"), false);
  const signedBackIn = await loadBrowserVault();
  assert.equal(signedBackIn?.device.boxSecret, "device-secret");
  assert.equal(signedBackIn?.opened, undefined);
  assert.equal(JSON.stringify([...(saved?.values() ?? [])]).includes(TEXT), false);
});

test("a 401 clears the decrypted-message cache and leaves the device keys", async () => {
  const databases = installMemoryIndexedDb();
  await loadBrowserVault();
  const store = browserVaultStore();
  store.write(vault());
  await settleBrowserVault();
  const saved = databases.get("avouch-e2ee")?.stores.get("vault");
  assert.equal(saved?.has("cache-key"), true);
  assert.equal(saved?.has("wrapping-key"), true);
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Sign in first." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  try {
    const response = await apiFetch("/api/dm/threads");
    assert.equal(response.status, 401);
    await settleBrowserVault();
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(saved?.has("wrapping-key"), true);
  assert.equal(saved?.has("sealed"), true);
  assert.equal(saved?.has("cache-key"), false);
  assert.equal(saved?.has("message-cache"), false);
  assert.equal(cipherHasText(saved, "sealed"), false);
  const loaded = await loadBrowserVault();
  assert.equal(loaded?.device.boxSecret, "device-secret");
  assert.equal(loaded?.opened, undefined);
});
