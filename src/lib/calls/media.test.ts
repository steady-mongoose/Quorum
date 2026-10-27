import assert from "node:assert/strict";
import test from "node:test";
import { CAMERA_UNAVAILABLE_LABEL, MALFORMED_LEFT, liveLine, openMedia } from "./media.ts";
import { claimsRecording } from "./status.ts";

const fake = (video: number) =>
  ({ getVideoTracks: () => Array.from({ length: video }) }) as unknown as MediaStream;

test("camera denied falls back to sound only", async () => {
  let n = 0;
  const out = await openMedia(async (c) => {
    n++;
    if (c.video) throw new Error("NotAllowedError");
    return fake(0);
  });
  assert.equal(out?.cameraDenied, true);
  assert.equal(n, 2);
});

test("mic denied is a hard stop", async () => {
  assert.equal(
    await openMedia(async () => {
      throw new Error("NotAllowedError");
    }),
    null,
  );
});

test("both granted", async () => {
  assert.equal((await openMedia(async () => fake(1)))?.cameraDenied, false);
});

test("live line variants", () => {
  assert.equal(liveLine(true, true), "Your camera and microphone are on.");
  assert.match(liveLine(false, true), /muted/);
  assert.match(liveLine(true, false), /camera is off/);
  assert.match(liveLine(false, false), /muted and your camera is off/);
});

test("recording copy only for an explicit record: true", () => {
  assert.equal(claimsRecording({ record: true }), true);
  assert.equal(claimsRecording({ record: "yes" }), false);
  assert.equal(claimsRecording(null), false);
  assert.equal(claimsRecording({}), false);
});

test("fixed copy", () => {
  assert.equal(
    MALFORMED_LEFT,
    "The call stopped because of a problem on our end. Try joining again.",
  );
  assert.equal(CAMERA_UNAVAILABLE_LABEL, "Camera unavailable");
});
