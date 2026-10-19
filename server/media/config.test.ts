import assert from "node:assert/strict";
import test from "node:test";
import { publicMediaStatus, readMediaConfig } from "./config.ts";

const secret = "test-secret-value";

function filled(extra: Record<string, string> = {}) {
  return {
    MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000",
    MEDIA_S3_BUCKET: "avouch",
    MEDIA_S3_ACCESS_KEY_ID: "access-key",
    MEDIA_S3_SECRET_ACCESS_KEY: secret,
    ...extra,
  };
}

test("storage stays off when no credentials are set", () => {
  const config = readMediaConfig({});
  assert.deepEqual(publicMediaStatus(config), { enabled: false, video: false });
  assert.equal(JSON.stringify(config).includes(secret), false);
});

test("storage stays off when only some credentials are set", () => {
  const config = readMediaConfig({
    MEDIA_S3_BUCKET: "avouch",
    MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000",
  });
  assert.equal(config.enabled, false);
  if (config.enabled) return;
  assert.equal(config.reason, "partial");
});

test("full credentials enable pictures and leave video off", () => {
  const config = readMediaConfig(filled());
  assert.equal(config.enabled, true);
  if (!config.enabled) return;
  assert.equal(config.video, false);
  assert.equal(config.forcePathStyle, true);
  assert.equal(config.secretAccessKey, secret);
  const pub = JSON.stringify(publicMediaStatus(config));
  assert.equal(pub.includes(secret), false);
  assert.equal(pub.includes("access-key"), false);
});

test("video turns on only when MEDIA_VIDEO is on", () => {
  const off = readMediaConfig(filled({ MEDIA_VIDEO: "yes" }));
  const on = readMediaConfig(filled({ MEDIA_VIDEO: "on" }));
  assert.equal(off.enabled && off.video, false);
  assert.equal(on.enabled && on.video, true);
});

test("an avouchsocial.com host keeps storage off", () => {
  const config = readMediaConfig(filled({ MEDIA_S3_ENDPOINT: "https://media.avouchsocial.com" }));
  assert.equal(config.enabled, false);
  if (config.enabled) return;
  assert.equal(config.reason, "avouch-host");
});

test("a bad endpoint keeps storage off", () => {
  const config = readMediaConfig(filled({ MEDIA_S3_ENDPOINT: "not a url" }));
  assert.equal(config.enabled, false);
  if (config.enabled) return;
  assert.equal(config.reason, "invalid-endpoint");
});
