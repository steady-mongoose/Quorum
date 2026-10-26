import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { apiFetch } from "../api-base.ts";
import {
  browserVaultStore,
  focusBrowserVault,
  forgetBrowserVault,
  loadBrowserVault,
  settleBrowserVault,
} from "./browser.ts";
import type { EnvelopeWire } from "./protocol.ts";
import { signOutClearsReadHistory } from "./read-history.ts";
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
              getAllKeys() {
                const request: { result?: string[]; onsuccess: (() => void) | null } = {
                  onsuccess: null,
                };
                queueMicrotask(() => {
                  request.result = [...store.keys()];
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

function cipherIncludes(saved: Store | undefined, id: string, needle: string): boolean {
  const sealed = saved?.get(id) as { ciphertext?: ArrayBuffer } | undefined;
  const bytes = new Uint8Array(sealed?.ciphertext ?? new ArrayBuffer(0));
  return new TextDecoder().decode(bytes).includes(needle);
}

function sealedBytes(saved: Store | undefined, id: string): Uint8Array {
  const sealed = saved?.get(id) as { ciphertext?: ArrayBuffer } | undefined;
  return new Uint8Array(sealed?.ciphertext ?? new ArrayBuffer(0)).slice();
}

function accountVault(userId: string, secret: string, deviceId: string, text: string): VaultState {
  const state = vault();
  state.userId = userId;
  state.device = { boxSecret: secret, deviceId } as VaultState["device"];
  state.opened = [
    {
      id: `message-${userId}`,
      threadId: `thread-${userId}`,
      from: userId,
      text,
      at: 1,
      bodyCiphertext: `cipher-${userId}`,
      senderDeviceId: "device-2",
      senderUserId: "member-2",
      envelopes: [],
    },
  ];
  return state;
}

function envelope(partial: Partial<EnvelopeWire>): EnvelopeWire {
  return {
    recipientDeviceId: "device-1",
    recipientUserBackup: null,
    nonce: "n",
    ciphertext: "c",
    ephemeralPublic: "e",
    prekeyId: null,
    signedPrekeyId: null,
    ...partial,
  };
}

test("sign-out deletes only the decrypted-message cache and its key", async () => {
  const databases = installMemoryIndexedDb();
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  const session = readFileSync(new URL("../server-session.tsx", import.meta.url), "utf8");
  const mailbox = readFileSync(
    new URL("../../components/board/encrypted-mailbox.tsx", import.meta.url),
    "utf8",
  );
  assert.match(app, /server\.signOut\(\)\.finally/);
  assert.doesNotMatch(app, /forgetBrowserVault/);
  assert.match(app, /signOutClearsReadHistory\(browserVaultStore\(\)\.read\(\)\)/);
  assert.match(app, /Stay signed in/);
  assert.match(session, /await forgetBrowserVault\(user\?\.id\)[\s\S]*await signOutServer\(\)/);
  assert.match(session, /focusBrowserVault\(next\?\.id \?\? null\)/);
  assert.match(session, /response\.status === 401 \|\| \(response\.status === 200 && !session\)/);
  assert.match(mailbox, /loadBrowserVault\(me\.id\)/);
  assert.match(mailbox, /restoreReadableHistory\(rows\)/);

  await loadBrowserVault("member-1");
  const store = browserVaultStore();
  store.write(vault());
  await settleBrowserVault();
  const loaded = await loadBrowserVault("member-1");
  assert.equal(loaded?.opened?.[0]?.text, TEXT);
  assert.equal(loaded?.device.boxSecret, "device-secret");
  const saved = databases.get("avouch-e2ee")?.stores.get("vault");
  assert.equal(saved?.has("wrapping-key:member-1"), true);
  assert.equal(saved?.has("sealed:member-1"), true);
  assert.equal(saved?.has("cache-key:member-1"), true);
  assert.equal(saved?.has("message-cache:member-1"), true);
  assert.equal(cipherIncludes(saved, "sealed:member-1", TEXT), false);
  assert.equal(cipherIncludes(saved, "message-cache:member-1", TEXT), false);

  const raced = browserVaultStore();
  raced.write(vault());
  await forgetBrowserVault();
  await settleBrowserVault();
  assert.equal(raced.read()?.device.boxSecret, "device-secret");
  assert.equal(raced.read()?.opened, undefined);
  assert.equal(saved?.has("wrapping-key:member-1"), true);
  assert.equal(saved?.has("sealed:member-1"), true);
  assert.equal(saved?.has("cache-key:member-1"), false);
  assert.equal(saved?.has("message-cache:member-1"), false);
  assert.equal(cipherIncludes(saved, "sealed:member-1", TEXT), false);
  const signedBackIn = await loadBrowserVault("member-1");
  assert.equal(signedBackIn?.device.boxSecret, "device-secret");
  assert.equal(signedBackIn?.opened, undefined);
  assert.equal(JSON.stringify([...(saved?.values() ?? [])]).includes(TEXT), false);
});

test("a 401 clears the decrypted-message cache and leaves the device keys", async () => {
  const databases = installMemoryIndexedDb();
  await loadBrowserVault("member-1");
  const store = browserVaultStore();
  store.write(vault());
  await settleBrowserVault();
  const saved = databases.get("avouch-e2ee")?.stores.get("vault");
  assert.equal(saved?.has("cache-key:member-1"), true);
  assert.equal(saved?.has("wrapping-key:member-1"), true);
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
  assert.equal(saved?.has("wrapping-key:member-1"), true);
  assert.equal(saved?.has("sealed:member-1"), true);
  assert.equal(saved?.has("cache-key:member-1"), false);
  assert.equal(saved?.has("message-cache:member-1"), false);
  assert.equal(cipherIncludes(saved, "sealed:member-1", TEXT), false);
  const loaded = await loadBrowserVault("member-1");
  assert.equal(loaded?.device.boxSecret, "device-secret");
  assert.equal(loaded?.opened, undefined);
});

test("two accounts keep separate sealed vaults in one browser", async () => {
  const databases = installMemoryIndexedDb();
  const aliceSecret = "alice-device-box-secret";
  const bobSecret = "bob-device-box-secret";
  const aliceText = "Alice keeps the framing square.";
  const bobText = "Bob keeps the long saw.";
  const alice = accountVault("alice", aliceSecret, "alice-device", aliceText);
  const bob = accountVault("bob", bobSecret, "bob-device", bobText);

  await loadBrowserVault("alice");
  browserVaultStore().write(alice);
  await settleBrowserVault();
  const saved = databases.get("avouch-e2ee")?.stores.get("vault");
  const aliceSealed = sealedBytes(saved, "sealed:alice");
  assert.equal(saved?.has("wrapping-key:alice"), true);
  assert.equal(aliceSealed.byteLength > 0, true);

  browserVaultStore().write(bob);
  await settleBrowserVault();
  assert.equal(browserVaultStore().read()?.userId, "alice");
  assert.equal(browserVaultStore().read()?.device.boxSecret, aliceSecret);
  assert.equal(JSON.stringify(browserVaultStore().read()).includes(bobSecret), false);
  assert.deepEqual(sealedBytes(saved, "sealed:alice"), aliceSealed);
  assert.equal(saved?.has("wrapping-key:bob"), true);
  assert.equal(saved?.has("sealed:bob"), true);
  assert.equal(cipherIncludes(saved, "sealed:alice", bobSecret), false);
  assert.equal(cipherIncludes(saved, "sealed:bob", aliceSecret), false);
  assert.equal(cipherIncludes(saved, "sealed:alice", aliceText), false);
  assert.equal(cipherIncludes(saved, "message-cache:alice", aliceText), false);

  focusBrowserVault("bob");
  assert.equal(browserVaultStore().read(), null);
  const bobLoaded = await loadBrowserVault("bob");
  assert.equal(bobLoaded?.device.boxSecret, bobSecret);
  assert.equal(bobLoaded?.device.deviceId, "bob-device");
  assert.equal(bobLoaded?.opened?.[0]?.text, bobText);
  assert.equal(JSON.stringify(bobLoaded).includes(aliceSecret), false);
  assert.equal(JSON.stringify(browserVaultStore().read()).includes(aliceSecret), false);
  assert.deepEqual(sealedBytes(saved, "sealed:alice"), aliceSealed);

  const aliceLoaded = await loadBrowserVault("alice");
  assert.equal(aliceLoaded?.device.boxSecret, aliceSecret);
  assert.equal(aliceLoaded?.device.deviceId, "alice-device");
  assert.equal(aliceLoaded?.opened?.[0]?.text, aliceText);
  assert.equal(JSON.stringify(aliceLoaded).includes(bobSecret), false);
  assert.deepEqual(sealedBytes(saved, "sealed:alice"), aliceSealed);
  assert.equal(saved?.has("wrapping-key:alice"), true);
  assert.equal(saved?.has("sealed:bob"), true);

  focusBrowserVault(null);
  await forgetBrowserVault();
  await settleBrowserVault();
  assert.equal(saved?.has("wrapping-key:alice"), true);
  assert.equal(saved?.has("sealed:alice"), true);
  assert.equal(saved?.has("wrapping-key:bob"), true);
  assert.equal(saved?.has("sealed:bob"), true);
  assert.equal(saved?.has("cache-key:alice"), false);
  assert.equal(saved?.has("message-cache:alice"), false);
  assert.equal(saved?.has("cache-key:bob"), false);
  assert.equal(saved?.has("message-cache:bob"), false);
  assert.deepEqual(sealedBytes(saved, "sealed:alice"), aliceSealed);
  const aliceAfter = await loadBrowserVault("alice");
  assert.equal(aliceAfter?.device.boxSecret, aliceSecret);
  assert.equal(aliceAfter?.device.deviceId, "alice-device");
  assert.equal(aliceAfter?.opened, undefined);
  const bobAfter = await loadBrowserVault("bob");
  assert.equal(bobAfter?.device.boxSecret, bobSecret);
  assert.equal(bobAfter?.device.deviceId, "bob-device");
  assert.equal(bobAfter?.opened, undefined);
  assert.equal(JSON.stringify(bobAfter).includes(aliceSecret), false);
});

test("sign-out warns only when cached messages cannot be opened again", () => {
  assert.equal(signOutClearsReadHistory(null), false);
  const unread = vault();
  unread.opened = [];
  assert.equal(signOutClearsReadHistory(unread), false);

  const spent = vault();
  spent.device = { ...spent.device, prekeys: [{ id: "kept" }] } as VaultState["device"];
  spent.opened = [
    { ...spent.opened![0], envelopes: [envelope({ prekeyId: "spent-key" })] },
  ];
  assert.equal(signOutClearsReadHistory(spent), true);

  const held = vault();
  held.device = { ...held.device, prekeys: [{ id: "kept" }] } as VaultState["device"];
  held.opened = [{ ...held.opened![0], envelopes: [envelope({ prekeyId: "kept" })] }];
  assert.equal(signOutClearsReadHistory(held), false);

  const signed = vault();
  signed.device = {
    ...signed.device,
    signedPrekey: { id: "signed-now" },
    previousSignedPrekeys: [{ id: "signed-old" }],
    previousSignedPrekey: { id: "signed-prev" },
  } as VaultState["device"];
  signed.opened = [
    { ...signed.opened![0], envelopes: [envelope({ signedPrekeyId: "signed-old" })] },
  ];
  assert.equal(signOutClearsReadHistory(signed), false);

  const backup = vault();
  backup.backup = { boxSecret: "backup-secret" } as VaultState["backup"];
  backup.opened = [
    {
      ...backup.opened![0],
      envelopes: [
        envelope({ recipientDeviceId: "other-device", recipientUserBackup: "member-1" }),
      ],
    },
  ];
  assert.equal(signOutClearsReadHistory(backup), false);
  backup.backup = null;
  assert.equal(signOutClearsReadHistory(backup), true);

  const empty = vault();
  assert.equal(signOutClearsReadHistory(empty), true);
});
