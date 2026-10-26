import assert from "node:assert/strict";
import test from "node:test";
import { mediaWorkerPasswordSql, scramSha256Verifier } from "./media-worker-password.mjs";

test("the media worker password is a SCRAM verifier, not the password", () => {
  const salt = Buffer.alloc(16, 1);
  const verifier = scramSha256Verifier("mediaworkerpass1", salt, 4096);
  assert.equal(
    verifier,
    "SCRAM-SHA-256$4096:AQEBAQEBAQEBAQEBAQEBAQ==$QOS0SSSTQ0QolfUSFnuxAllKDGQDfFEwpw3sfbj3Tls=:J2gv6U+hyl3UbwNxxsjhOAuqC1nOMeWd/3yy6Ch6sJk=",
  );
  const sql = mediaWorkerPasswordSql("mediaworkerpass1");
  assert.match(sql, /^ALTER ROLE media_worker PASSWORD 'SCRAM-SHA-256\$4096:/);
  assert.equal(sql.includes("mediaworkerpass1"), false);
  assert.equal(sql.split("'").length, 3);
  assert.notEqual(sql, mediaWorkerPasswordSql("mediaworkerpass1"));
  assert.throws(() => mediaWorkerPasswordSql("short"), /owner's approval/);
});
