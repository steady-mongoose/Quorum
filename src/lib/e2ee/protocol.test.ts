import assert from "node:assert/strict";
import test from "node:test";
import { loadSodium } from "./sodium.ts";
import { BACKUP_MEMLIMIT_INTERACTIVE, BACKUP_OPSLIMIT_INTERACTIVE } from "./limits.ts";
import {
  createBackupKey,
  createDevice,
  decryptBackupSecret,
  encryptBackupSecret,
  openMessage,
  safetyNumber,
  sealMessage,
  verifyDeviceStatement,
  type DeviceRecord,
  type SealDestination,
} from "./protocol.ts";

const TEXT = "The framing night is Thursday, bring the saw.";

function publicView(device: DeviceRecord) {
  return {
    deviceId: device.deviceId,
    signPublic: device.signPublic,
    boxPublic: device.boxPublic,
    statementSig: device.statementSig,
  };
}

function deviceDestination(userId: string, device: DeviceRecord, prekeyIndex = 0): SealDestination {
  const prekey = device.prekeys[prekeyIndex] ?? null;
  return {
    kind: "device",
    userId,
    device: {
      deviceId: device.deviceId,
      signPublic: device.signPublic,
      boxPublic: device.boxPublic,
      statementSig: device.statementSig,
    },
    prekey: prekey
      ? { id: prekey.id, publicKey: prekey.publicKey, signature: prekey.signature }
      : null,
  };
}

test("a message opens on every device it was sealed to, and nowhere else", async () => {
  const alice = "alice-user-0001";
  const bob = "bob-user-00000001";
  const aliceBrowser = await createDevice({ userId: alice, label: "Browser", prekeyCount: 2 });
  const alicePhone = await createDevice({ userId: alice, label: "Phone", prekeyCount: 2 });
  const bobBrowser = await createDevice({ userId: bob, label: "Browser", prekeyCount: 2 });
  const stranger = await createDevice({ userId: "stranger-user-01", prekeyCount: 1 });
  const bobBackup = { ...(await createBackupKey()), userId: bob };
  const sealed = await sealMessage({
    messageId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    sender: aliceBrowser,
    text: TEXT,
    destinations: [
      deviceDestination(bob, bobBrowser),
      deviceDestination(alice, alicePhone),
      { kind: "backup", userId: bob, boxPublic: bobBackup.boxPublic },
    ],
  });
  assert.equal(sealed.ok, true);
  if (!sealed.ok) return;
  assert.equal(JSON.stringify(sealed.value).includes(TEXT), false);

  const bobRead = await openMessage({
    message: sealed.value,
    senderUserId: alice,
    sender: publicView(aliceBrowser),
    recipientDevice: bobBrowser,
    backup: null,
  });
  assert.equal(bobRead.ok, true);
  if (!bobRead.ok) return;
  assert.equal(bobRead.text, TEXT);

  const phoneRead = await openMessage({
    message: sealed.value,
    senderUserId: alice,
    sender: publicView(aliceBrowser),
    recipientDevice: alicePhone,
    backup: null,
  });
  assert.equal(phoneRead.ok && phoneRead.text, TEXT);

  const strangerRead = await openMessage({
    message: sealed.value,
    senderUserId: alice,
    sender: publicView(aliceBrowser),
    recipientDevice: stranger,
    backup: null,
  });
  assert.equal(strangerRead.ok, false);
});

test("a tampered ciphertext does not open, and a swapped device key is refused", async () => {
  const alice = "alice-user-0001";
  const bob = "bob-user-00000001";
  const aliceBrowser = await createDevice({ userId: alice, prekeyCount: 1 });
  const bobBrowser = await createDevice({ userId: bob, prekeyCount: 1 });
  const sealed = await sealMessage({
    messageId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    sender: aliceBrowser,
    text: TEXT,
    destinations: [deviceDestination(bob, bobBrowser)],
  });
  assert.equal(sealed.ok, true);
  if (!sealed.ok) return;
  const tampered = {
    ...sealed.value,
    bodyCiphertext: `${sealed.value.bodyCiphertext.slice(0, -2)}AA`,
  };
  const opened = await openMessage({
    message: tampered,
    senderUserId: alice,
    sender: publicView(aliceBrowser),
    recipientDevice: bobBrowser,
    backup: null,
  });
  assert.equal(opened.ok, false);

  const swapped = { ...bobBrowser, boxPublic: aliceBrowser.boxPublic };
  assert.equal(await verifyDeviceStatement(bob, swapped), false);
  const refused = await sealMessage({
    messageId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    sender: aliceBrowser,
    text: TEXT,
    destinations: [deviceDestination(bob, swapped)],
  });
  assert.equal(refused.ok, false);
});

test("deleting a one-time prekey hides the message from that device, and the backup still opens it", async () => {
  const alice = "alice-user-0001";
  const bob = "bob-user-00000001";
  const aliceBrowser = await createDevice({ userId: alice, prekeyCount: 1 });
  const bobBrowser = await createDevice({ userId: bob, prekeyCount: 1 });
  const backup = { ...(await createBackupKey()), userId: bob };
  const sealed = await sealMessage({
    messageId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    sender: aliceBrowser,
    text: TEXT,
    destinations: [
      deviceDestination(bob, bobBrowser),
      { kind: "backup", userId: bob, boxPublic: backup.boxPublic },
    ],
  });
  assert.equal(sealed.ok, true);
  if (!sealed.ok) return;
  const forgotten = { ...bobBrowser, prekeys: [] };
  const fromDevice = await openMessage({
    message: sealed.value,
    senderUserId: alice,
    sender: publicView(aliceBrowser),
    recipientDevice: forgotten,
    backup: null,
  });
  assert.equal(fromDevice.ok, false);
  const fromBackup = await openMessage({
    message: sealed.value,
    senderUserId: alice,
    sender: publicView(aliceBrowser),
    recipientDevice: forgotten,
    backup,
  });
  assert.equal(fromBackup.ok && fromBackup.text, TEXT);
});

test("the backup passphrase wraps the secret, and the wrong passphrase does not", async () => {
  const backup = await createBackupKey();
  const cipher = await encryptBackupSecret(backup.boxSecret, "correct horse battery", "min");
  assert.equal(cipher.ok, true);
  if (!cipher.ok) return;
  assert.equal(JSON.stringify(cipher.value).includes(backup.boxSecret), false);
  assert.equal(await decryptBackupSecret(cipher.value, "wrong passphrase!!"), null);
  assert.equal(await decryptBackupSecret(cipher.value, "correct horse battery"), backup.boxSecret);
});

test("the safety number does not depend on which person reads it first", async () => {
  const alice = await createBackupKey();
  const bob = await createBackupKey();
  const forward = await safetyNumber(alice.boxPublic, bob.boxPublic);
  const backward = await safetyNumber(bob.boxPublic, alice.boxPublic);
  assert.equal(forward, backward);
  assert.match(forward ?? "", /^\d{5}( \d{5}){5}$/);
});

test("empty and overlong notes are refused before they are sealed", async () => {
  const alice = await createDevice({ userId: "alice-user-0001", prekeyCount: 1 });
  const bob = await createDevice({ userId: "bob-user-00000001", prekeyCount: 1 });
  const empty = await sealMessage({
    messageId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    sender: alice,
    text: "   ",
    destinations: [deviceDestination("bob-user-00000001", bob)],
  });
  assert.equal(empty.ok, false);
  const long = await sealMessage({
    messageId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    sender: alice,
    text: "a".repeat(4001),
    destinations: [deviceDestination("bob-user-00000001", bob)],
  });
  assert.equal(long.ok, false);
});

test("interactive backup parameters match libsodium Argon2id", async () => {
  const sodium = await loadSodium();
  assert.equal(BACKUP_OPSLIMIT_INTERACTIVE, sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE);
  assert.equal(BACKUP_MEMLIMIT_INTERACTIVE, sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE);
  assert.equal(sodium.crypto_pwhash_ALG_ARGON2ID13, 2);
});
