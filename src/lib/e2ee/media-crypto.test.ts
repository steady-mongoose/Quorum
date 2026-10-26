import assert from "node:assert/strict";
import test from "node:test";
import {
  createBackupKey,
  createDevice,
  type DeviceRecord,
  type PublicDevice,
  type PublicPrekey,
} from "./protocol.ts";
import {
  confirmSafety,
  memoryVault,
  type DmTransport,
  type VaultState,
  type VaultStore,
} from "./mailbox.ts";
import { KEY_ENVELOPE_MAX, createDmMediaCrypto } from "./media-crypto.ts";
import { safetyNumber } from "./protocol.ts";

const text = (value: string) => new TextEncoder().encode(value);

function jpegWithGps(): Uint8Array {
  const exif = text("Exif\0GPS latitude 37.1");
  const length = exif.length + 2;
  const app1 = new Uint8Array(4 + exif.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1[2] = (length >> 8) & 0xff;
  app1[3] = length & 0xff;
  app1.set(exif, 4);
  return concat(Uint8Array.of(0xff, 0xd8), app1, Uint8Array.of(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(text(type), 4);
  out.set(payload, 8);
  return out;
}

function mp4WithGps(): Uint8Array {
  const hdlr = box("hdlr", concat(new Uint8Array(8), text("vide"), new Uint8Array(12)));
  const stco = box("stco", new Uint8Array(12));
  const trak = box(
    "trak",
    concat(
      box("tkhd", new Uint8Array(4)),
      box("mdia", concat(box("mdhd", new Uint8Array(4)), hdlr, box("minf", box("stbl", stco)))),
    ),
  );
  const moov = box(
    "moov",
    concat(box("mvhd", new Uint8Array(4)), trak, box("udta", text("GPS latitude"))),
  );
  const ftyp = box("ftyp", text("isom"));
  const mdat = box("mdat", text("FRAME"));
  const file = concat(ftyp, moov, mdat);
  const needle = text("stco");
  let stcoAt = -1;
  for (let i = 4; i + 4 < file.length; i += 1) {
    if (needle.every((byte, index) => file[i + index] === byte)) stcoAt = i - 4;
  }
  new DataView(file.buffer).setUint32(stcoAt + 12, 1);
  new DataView(file.buffer).setUint32(stcoAt + 16, ftyp.length + moov.length + 8);
  return file;
}

type Entry = {
  userId: string;
  identityPublic: string;
  backupPublic: string | null;
  device: PublicDevice;
  signedPrekey: PublicPrekey;
  prekeys: PublicPrekey[];
};

function publish(userId: string, device: DeviceRecord, backupPublic: string | null): Entry {
  return {
    userId,
    identityPublic: device.identityPublic,
    backupPublic,
    device: {
      deviceId: device.deviceId,
      signPublic: device.signPublic,
      boxPublic: device.boxPublic,
      statementSig: device.statementSig,
      identitySig: device.identitySig,
    },
    signedPrekey: {
      id: device.signedPrekey.id,
      publicKey: device.signedPrekey.publicKey,
      signature: device.signedPrekey.signature,
    },
    prekeys: device.prekeys.map((prekey) => ({
      id: prekey.id,
      publicKey: prekey.publicKey,
      signature: prekey.signature,
    })),
  };
}

function directory(entries: Entry[]) {
  let bundles = 0;
  const transportFor = (userId: string): DmTransport => ({
    async post(path, body) {
      const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      if (path === "/api/dm/threads") {
        const otherUserId = typeof record.userId === "string" ? record.userId : "";
        return {
          status: 201,
          body: {
            id: "00000000-0000-4000-8000-0000000000aa",
            otherUserId,
            otherName: "Neighbor",
          },
        };
      }
      if (path === "/api/dm/bundles") {
        bundles += 1;
        const target = typeof record.userId === "string" ? record.userId : "";
        const mine = entries.filter((entry) => entry.userId === target);
        return {
          status: 200,
          body: {
            userId: target,
            identityPublic: mine[0]?.identityPublic ?? null,
            backupPublic: mine[0]?.backupPublic ?? null,
            devices: mine.map((entry) => ({
              ...entry.device,
              prekey: entry.prekeys.shift() ?? null,
              signedPrekey: entry.signedPrekey,
            })),
          },
        };
      }
      return { status: 200, body: { ok: true } };
    },
    async get(path) {
      if (path === "/api/dm/devices") {
        return {
          status: 200,
          body: {
            devices: entries
              .filter((entry) => entry.userId === userId)
              .map((entry) => ({
                id: entry.device.deviceId,
                label: "This browser",
                createdAt: "2026-01-01T00:00:00.000Z",
                prekeysLeft: 10,
              })),
          },
        };
      }
      if (path.startsWith("/api/dm/keys")) {
        const id = new URLSearchParams(path.slice(path.indexOf("?"))).get("userId") ?? "";
        const mine = entries.filter((entry) => entry.userId === id);
        return {
          status: 200,
          body: {
            userId: id,
            identityPublic: mine[0]?.identityPublic ?? null,
            backupPublic: mine[0]?.backupPublic ?? null,
            devices: mine.map((entry) => entry.device),
          },
        };
      }
      return { status: 404, body: { error: "Not found." } };
    },
  });
  return { transportFor, bundles: () => bundles };
}

function vaultFor(
  userId: string,
  device: DeviceRecord,
  backup: VaultState["backup"] = null,
): VaultStore {
  return memoryVault({ userId, device, backup, pins: [], confirmed: [], spentPrekeys: [] });
}

async function allow(
  vault: VaultStore,
  peerId: string,
  mine: DeviceRecord[],
  theirs: DeviceRecord[],
) {
  const number = await safetyNumber(
    {
      identityPublic: mine[0]?.identityPublic ?? "",
      devices: mine.map((device) => ({ deviceId: device.deviceId, signPublic: device.signPublic })),
    },
    {
      identityPublic: theirs[0]?.identityPublic ?? "",
      devices: theirs.map((device) => ({
        deviceId: device.deviceId,
        signPublic: device.signPublic,
      })),
    },
  );
  assert.ok(number);
  if (number) confirmSafety(vault, peerId, number);
}

test("a picture is stripped, sealed, and opened by the other device", async () => {
  const aliceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const bobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const aliceDevice = await createDevice({ userId: aliceId, prekeyCount: 1 });
  const bobDevice = await createDevice({ userId: bobId, prekeyCount: 1 });
  const book = directory([publish(aliceId, aliceDevice, null), publish(bobId, bobDevice, null)]);
  const aliceVault = vaultFor(aliceId, aliceDevice);
  const bobVault = vaultFor(bobId, bobDevice);
  await allow(aliceVault, bobId, [aliceDevice], [bobDevice]);
  const jpeg = jpegWithGps();
  const sealed = await createDmMediaCrypto({
    transport: book.transportFor(aliceId),
    vault: aliceVault,
  }).seal({ bytes: jpeg, kind: "image", contentType: "image/jpeg", peerUserId: bobId });

  assert.ok(sealed.keyEnvelope.length > 0);
  assert.ok(sealed.keyEnvelope.length <= KEY_ENVELOPE_MAX);
  assert.equal(sealed.keyEnvelope.includes("\u0000"), false);
  assert.equal(new TextDecoder().decode(sealed.ciphertext).includes("GPS latitude"), false);

  const opened = await createDmMediaCrypto({
    transport: book.transportFor(bobId),
    vault: bobVault,
  }).open({ ciphertext: sealed.ciphertext, keyEnvelope: sealed.keyEnvelope, peerUserId: aliceId });
  assert.equal(new TextDecoder().decode(opened).includes("GPS latitude"), false);
  assert.equal(opened[0], 0xff);
  assert.equal(opened[1], 0xd8);

  const own = await createDmMediaCrypto({
    transport: book.transportFor(aliceId),
    vault: aliceVault,
  }).open({ ciphertext: sealed.ciphertext, keyEnvelope: sealed.keyEnvelope, peerUserId: bobId });
  assert.deepEqual(own, opened);
});

test("a changed ciphertext or the wrong person does not open", async () => {
  const aliceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const bobId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const aliceDevice = await createDevice({ userId: aliceId, prekeyCount: 2 });
  const bobDevice = await createDevice({ userId: bobId, prekeyCount: 2 });
  const book = directory([publish(aliceId, aliceDevice, null), publish(bobId, bobDevice, null)]);
  const aliceVault = vaultFor(aliceId, aliceDevice);
  await allow(aliceVault, bobId, [aliceDevice], [bobDevice]);
  const sealed = await createDmMediaCrypto({
    transport: book.transportFor(aliceId),
    vault: aliceVault,
  }).seal({
    bytes: jpegWithGps(),
    kind: "image",
    contentType: "image/jpeg",
    peerUserId: bobId,
  });
  const flipped = sealed.ciphertext.slice();
  flipped[flipped.length - 1] ^= 0xff;
  await assert.rejects(
    createDmMediaCrypto({
      transport: book.transportFor(bobId),
      vault: vaultFor(bobId, bobDevice),
    }).open({ ciphertext: flipped, keyEnvelope: sealed.keyEnvelope, peerUserId: aliceId }),
    /could not be read/,
  );
  await assert.rejects(
    createDmMediaCrypto({
      transport: book.transportFor(bobId),
      vault: vaultFor(bobId, bobDevice),
    }).open({
      ciphertext: sealed.ciphertext,
      keyEnvelope: sealed.keyEnvelope,
      peerUserId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    }),
    /could not be read/,
  );
});

test("safety numbers block a picture before a one-time key is taken", async () => {
  const aliceId = "11111111-1111-4111-8111-111111111111";
  const bobId = "22222222-2222-4222-8222-222222222222";
  const aliceDevice = await createDevice({ userId: aliceId, prekeyCount: 1 });
  const bobDevice = await createDevice({ userId: bobId, prekeyCount: 1 });
  const aliceBackup = await createBackupKey();
  const bobBackup = await createBackupKey();
  const book = directory([
    publish(aliceId, aliceDevice, aliceBackup.boxPublic),
    publish(bobId, bobDevice, bobBackup.boxPublic),
  ]);
  const aliceVault = vaultFor(aliceId, aliceDevice, { ...aliceBackup, userId: aliceId });
  await assert.rejects(
    createDmMediaCrypto({ transport: book.transportFor(aliceId), vault: aliceVault }).seal({
      bytes: jpegWithGps(),
      kind: "image",
      contentType: "image/jpeg",
      peerUserId: bobId,
    }),
    /Compare safety numbers/,
  );
  assert.equal(book.bundles(), 0);

  const number = await safetyNumber(
    {
      identityPublic: aliceDevice.identityPublic,
      backupPublic: aliceBackup.boxPublic,
      devices: [{ deviceId: aliceDevice.deviceId, signPublic: aliceDevice.signPublic }],
    },
    {
      identityPublic: bobDevice.identityPublic,
      backupPublic: bobBackup.boxPublic,
      devices: [{ deviceId: bobDevice.deviceId, signPublic: bobDevice.signPublic }],
    },
  );
  assert.ok(number);
  if (!number) return;
  confirmSafety(aliceVault, bobId, number);
  const sealed = await createDmMediaCrypto({
    transport: book.transportFor(aliceId),
    vault: aliceVault,
  }).seal({ bytes: jpegWithGps(), kind: "image", contentType: "image/jpeg", peerUserId: bobId });
  const opened = await createDmMediaCrypto({
    transport: book.transportFor(bobId),
    vault: vaultFor(bobId, bobDevice, { ...bobBackup, userId: bobId }),
  }).open({ ciphertext: sealed.ciphertext, keyEnvelope: sealed.keyEnvelope, peerUserId: aliceId });
  assert.equal(new TextDecoder().decode(opened).includes("GPS latitude"), false);
});

test("eight devices on each side still fit in the opaque envelope", async () => {
  const aliceId = "a".repeat(64);
  const bobId = "b".repeat(64);
  const aliceFirst = await createDevice({ userId: aliceId, prekeyCount: 1 });
  const bobFirst = await createDevice({ userId: bobId, prekeyCount: 1 });
  const aliceDevices = [
    aliceFirst,
    ...(await Promise.all(
      Array.from({ length: 7 }, () =>
        createDevice({
          userId: aliceId,
          prekeyCount: 1,
          identity: {
            signPublic: aliceFirst.identityPublic,
            signSecret: aliceFirst.identitySecret,
          },
        }),
      ),
    )),
  ];
  const bobDevices = [
    bobFirst,
    ...(await Promise.all(
      Array.from({ length: 7 }, () =>
        createDevice({
          userId: bobId,
          prekeyCount: 1,
          identity: { signPublic: bobFirst.identityPublic, signSecret: bobFirst.identitySecret },
        }),
      ),
    )),
  ];
  const book = directory([
    ...aliceDevices.map((device) => publish(aliceId, device, null)),
    ...bobDevices.map((device) => publish(bobId, device, null)),
  ]);
  const alice = aliceDevices[0];
  const bob = bobDevices[0];
  if (!alice || !bob) throw new Error("missing device");
  const aliceVault = vaultFor(aliceId, alice);
  await allow(aliceVault, bobId, aliceDevices, bobDevices);
  const sealed = await createDmMediaCrypto({
    transport: book.transportFor(aliceId),
    vault: aliceVault,
  }).seal({ bytes: jpegWithGps(), kind: "image", contentType: "image/jpeg", peerUserId: bobId });
  assert.ok(sealed.keyEnvelope.length <= KEY_ENVELOPE_MAX);
  const opened = await createDmMediaCrypto({
    transport: book.transportFor(bobId),
    vault: vaultFor(bobId, bob),
  }).open({ ciphertext: sealed.ciphertext, keyEnvelope: sealed.keyEnvelope, peerUserId: aliceId });
  assert.equal(opened[0], 0xff);
});

test("a video is stripped on this device and then sealed", async () => {
  const aliceId = "33333333-3333-4333-8333-333333333333";
  const bobId = "44444444-4444-4444-8444-444444444444";
  const aliceDevice = await createDevice({ userId: aliceId, prekeyCount: 1 });
  const bobDevice = await createDevice({ userId: bobId, prekeyCount: 1 });
  const book = directory([publish(aliceId, aliceDevice, null), publish(bobId, bobDevice, null)]);
  const aliceVault = vaultFor(aliceId, aliceDevice);
  await allow(aliceVault, bobId, [aliceDevice], [bobDevice]);
  const sealed = await createDmMediaCrypto({
    transport: book.transportFor(aliceId),
    vault: aliceVault,
  }).seal({ bytes: mp4WithGps(), kind: "video", contentType: "video/mp4", peerUserId: bobId });
  assert.equal(new TextDecoder().decode(sealed.ciphertext).includes("GPS latitude"), false);
  const opened = await createDmMediaCrypto({
    transport: book.transportFor(bobId),
    vault: vaultFor(bobId, bobDevice),
  }).open({ ciphertext: sealed.ciphertext, keyEnvelope: sealed.keyEnvelope, peerUserId: aliceId });
  const decoded = new TextDecoder().decode(opened);
  assert.equal(decoded.includes("GPS latitude"), false);
  assert.equal(decoded.includes("FRAME"), true);
});

test("a file that is not a picture is refused before keys are taken", async () => {
  const aliceId = "55555555-5555-4555-8555-555555555555";
  const bobId = "66666666-6666-4666-8666-666666666666";
  const aliceDevice = await createDevice({ userId: aliceId, prekeyCount: 1 });
  const book = directory([publish(aliceId, aliceDevice, null)]);
  await assert.rejects(
    createDmMediaCrypto({
      transport: book.transportFor(aliceId),
      vault: vaultFor(aliceId, aliceDevice),
    }).seal({
      bytes: Uint8Array.of(1, 2, 3, 4),
      kind: "image",
      contentType: "image/jpeg",
      peerUserId: bobId,
    }),
    /not a JPEG/,
  );
  assert.equal(book.bundles(), 0);
});
