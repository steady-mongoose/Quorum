import assert from "node:assert/strict";
import test from "node:test";
import { clearDmMediaCrypto, registerDmMediaCrypto } from "./e2e.ts";
import { runUpload, uploadDmCipher } from "./upload.ts";

function jpegWithGps(): Uint8Array {
  const payload = new TextEncoder().encode("Exif\0\0GPSLatitude");
  const length = 2 + payload.length;
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    (length >> 8) & 0xff,
    length & 0xff,
    ...payload,
    0xff,
    0xda,
    0x00,
    0x02,
    0xff,
    0xd9,
  ]);
}

test("a room upload puts the bytes on object storage and not on the API", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/media/uploads") {
      return new Response(
        JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          upload: {
            url: "https://objects.example/avouch/incoming/a",
            headers: { "content-type": "image/jpeg" },
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    if (url.startsWith("https://objects.example/")) return new Response(null, { status: 200 });
    return new Response(JSON.stringify({ status: "processing" }), { status: 200 });
  };
  const bytes = Uint8Array.of(1, 2, 3);
  const result = await runUpload({
    request: {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 3,
      scope: "room",
      roomId: "shop",
      postId: "post-1",
    },
    bytes,
    fetchImpl,
    putImpl: fetchImpl,
    resolveUrl: (path) => path,
  });
  assert.equal(result.ok, true);
  const put = calls.find((call) => call.url.startsWith("https://objects.example/"));
  assert.equal(put?.init?.method, "PUT");
  assert.equal(put?.init?.credentials, "omit");
  const putHeaders = put?.init?.headers as Record<string, string>;
  assert.equal(putHeaders["content-length"], "3");
  assert.ok(Object.is(put?.init?.body, bytes));
  const post = calls.find((call) => call.url === "/api/media/uploads");
  assert.equal(post?.init?.credentials, "include");
});

test("a message picture is stripped and uploaded as ciphertext", async () => {
  clearDmMediaCrypto();
  const missing = await uploadDmCipher({
    bytes: jpegWithGps(),
    contentType: "image/jpeg",
    peerUserId: "user-maria",
    fetchImpl: async () => {
      throw new Error("should not upload");
    },
    resolveUrl: (path) => path,
  });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.match(missing.error, /encrypted on this device/);

  let sealedText = "";
  const ciphertext = Uint8Array.of(5, 5, 5);
  registerDmMediaCrypto({
    async seal(input) {
      sealedText = new TextDecoder().decode(input.bytes);
      return { ciphertext, keyEnvelope: "wrapped-key" };
    },
    async open(input) {
      return input.ciphertext;
    },
  });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/media/uploads") {
      return new Response(
        JSON.stringify({
          id: "22222222-2222-4222-8222-222222222222",
          upload: {
            url: "https://objects.example/avouch/dm/a",
            headers: { "content-type": "application/octet-stream" },
          },
        }),
        { status: 201 },
      );
    }
    if (url.startsWith("https://objects.example/")) return new Response(null, { status: 200 });
    return new Response(JSON.stringify({ status: "ready" }), { status: 200 });
  };
  const uploaded = await uploadDmCipher({
    bytes: jpegWithGps(),
    contentType: "image/jpeg",
    peerUserId: "user-maria",
    fetchImpl,
    putImpl: fetchImpl,
    resolveUrl: (path) => path,
  });
  assert.equal(uploaded.ok, true);
  assert.equal(sealedText.includes("GPSLatitude"), false);
  const put = calls.find((call) => call.url.startsWith("https://objects.example/"));
  assert.ok(Object.is(put?.init?.body, ciphertext));
  const prepare = calls.find((call) => call.url === "/api/media/uploads");
  const body = JSON.parse(String(prepare?.init?.body)) as { keyEnvelope?: string; scope?: string };
  assert.equal(body.scope, "dm");
  assert.equal(body.keyEnvelope, "wrapped-key");
  clearDmMediaCrypto();
});

test("a refusal from the server is returned in plain words", async () => {
  const result = await runUpload({
    request: {
      kind: "video",
      contentType: "video/mp4",
      byteSize: 10,
      durationMs: 1000,
      scope: "room",
      roomId: "shop",
      postId: "post-1",
    },
    bytes: Uint8Array.of(1),
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "Video is off." }), { status: 403 }),
    resolveUrl: (path) => path,
  });
  assert.deepEqual(result, { ok: false, error: "Video is off." });
});
