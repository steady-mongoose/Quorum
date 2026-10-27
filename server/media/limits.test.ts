import assert from "node:assert/strict";
import test from "node:test";
import { planUpload } from "../../src/lib/media/limits.ts";

const self = "user-josh";

function plan(body: Record<string, unknown>, videoEnabled = true) {
  return planUpload(body, { videoEnabled, userId: self });
}

test("a room JPEG under the cap is accepted", () => {
  const result = plan({
    kind: "image",
    contentType: "image/jpeg",
    byteSize: 1024,
    scope: "room",
    roomId: "shop",
    postId: "post-1",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.encryption, "server-processed");
  assert.equal(result.plan.uploadContentType, "image/jpeg");
  assert.equal(result.plan.durationMs, null);
});

test("an unknown picture type is refused", () => {
  const result = plan({
    kind: "image",
    contentType: "image/svg+xml",
    byteSize: 100,
    scope: "room",
    roomId: "shop",
    postId: "post-1",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "Choose a JPEG, PNG, WebP, or GIF.");
});

test("an oversized picture is refused", () => {
  const result = plan({
    kind: "image",
    contentType: "image/png",
    byteSize: 8 * 1024 * 1024 + 1,
    scope: "room",
    roomId: "shop",
    postId: "post-1",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "That picture is over 8 MB.");
});

test("a video longer than 60 seconds is refused", () => {
  const result = plan({
    kind: "video",
    contentType: "video/mp4",
    byteSize: 1000,
    durationMs: 60_001,
    scope: "room",
    roomId: "shop",
    postId: "post-1",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "That video is longer than 60 seconds.");
});

test("video stays off until the owner turns it on", () => {
  const result = plan(
    {
      kind: "video",
      contentType: "video/mp4",
      byteSize: 1000,
      durationMs: 1000,
      scope: "room",
      roomId: "shop",
      postId: "post-1",
    },
    false,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
  assert.equal(result.error, "Video is off.");
});

test("a room upload cannot carry a message key", () => {
  const result = plan({
    kind: "image",
    contentType: "image/jpeg",
    byteSize: 10,
    scope: "room",
    roomId: "shop",
    postId: "post-1",
    keyEnvelope: "secret",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "A room picture is not end-to-end encrypted.");
});

test("a message picture needs a wrapped key and another person", () => {
  const missing = plan({
    kind: "image",
    contentType: "image/jpeg",
    byteSize: 10,
    scope: "dm",
    peerUserId: "user-maria",
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error, "A picture in a message needs the wrapped key.");

  const selfSend = plan({
    kind: "image",
    contentType: "image/jpeg",
    byteSize: 10,
    scope: "dm",
    peerUserId: self,
    keyEnvelope: "wrapped",
  });
  assert.equal(selfSend.ok, false);
  if (!selfSend.ok) assert.equal(selfSend.error, "You cannot send a picture to yourself.");
});

test("a message picture is ciphertext on the wire", () => {
  const result = plan({
    kind: "image",
    contentType: "image/webp",
    byteSize: 20,
    scope: "dm",
    peerUserId: "user-maria",
    keyEnvelope: "wrapped-key",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.encryption, "client-e2e");
  assert.equal(result.plan.uploadContentType, "application/octet-stream");
  assert.equal(result.plan.keyEnvelope, "wrapped-key");
});

test("a profile photo is a JPEG, PNG, or WebP of at most 5 MB", () => {
  const five = 5 * 1024 * 1024;
  const accepted = plan({
    kind: "image",
    contentType: "image/webp",
    byteSize: five,
    scope: "profile",
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.plan.scope, "profile");
  assert.equal(accepted.plan.roomId, "");
  assert.equal(accepted.plan.postId, "");
  assert.equal(accepted.plan.peerUserId, "");
  assert.equal(accepted.plan.keyEnvelope, "");
  assert.equal(accepted.plan.encryption, "server-processed");
  assert.equal(accepted.plan.durationMs, null);

  const over = plan({
    kind: "image",
    contentType: "image/jpeg",
    byteSize: five + 1,
    scope: "profile",
  });
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.error, "That picture is over 5 MB. Choose a smaller one.");

  const gif = plan({
    kind: "image",
    contentType: "image/gif",
    byteSize: 100,
    scope: "profile",
  });
  assert.equal(gif.ok, false);
  if (!gif.ok) assert.equal(gif.error, "Choose a JPEG, PNG, or WebP picture.");

  const video = plan({
    kind: "video",
    contentType: "video/mp4",
    byteSize: 100,
    durationMs: 1000,
    scope: "profile",
  });
  assert.equal(video.ok, false);
  if (!video.ok) assert.equal(video.error, "Choose a picture, not a video.");

  const room = plan({
    kind: "image",
    contentType: "image/png",
    byteSize: 100,
    scope: "profile",
    roomId: "shop",
    postId: "post-1",
  });
  assert.equal(room.ok, false);
  if (!room.ok) assert.equal(room.error, "A profile photo is not a room post or a message.");
});

test("a wrapped key that is too long is refused", () => {
  const result = plan({
    kind: "image",
    contentType: "image/jpeg",
    byteSize: 20,
    scope: "dm",
    peerUserId: "user-maria",
    keyEnvelope: "k".repeat(4097),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "That wrapped key is too long.");
});
