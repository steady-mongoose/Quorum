import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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

test("sign-out deletes the sealed message cache, its key, and the memory copy", async () => {
  const databases = installMemoryIndexedDb();
  const source = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  assert.match(source, /server\.signOut\(\)\.then/);
  assert.match(source, /await forgetBrowserVault\(\)/);

  const store = browserVaultStore();
  store.write(vault());
  await settleBrowserVault();
  const loaded = await loadBrowserVault();
  assert.equal(loaded?.opened?.[0]?.text, TEXT);
  const saved = databases.get("avouch-e2ee")?.stores.get("vault");
  assert.ok(saved?.has("wrapping-key"));
  assert.ok(saved?.has("sealed"));
  const sealed = saved?.get("sealed") as { ciphertext?: ArrayBuffer } | undefined;
  const bytes = new Uint8Array(sealed?.ciphertext ?? new ArrayBuffer(0));
  assert.equal(new TextDecoder().decode(bytes).includes(TEXT), false);

  await forgetBrowserVault();
  assert.equal(store.read(), null);
  assert.equal(browserVaultStore().read(), null);
  assert.equal(await loadBrowserVault(), null);
  assert.equal(saved?.has("wrapping-key"), false);
  assert.equal(saved?.has("sealed"), false);
  assert.equal(JSON.stringify([...saved?.values() ?? []]).includes(TEXT), false);
});
