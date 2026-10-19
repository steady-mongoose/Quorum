import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { createS3Store, presignRequest } from "./s3.ts";

const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const access = "AKIAIOSFODNN7EXAMPLE";

test("a presigned GET matches the SigV4 query-string canonical request", () => {
  const signed = presignRequest({
    method: "GET",
    endpoint: "https://s3.amazonaws.com",
    bucket: "examplebucket",
    key: "test.txt",
    region: "us-east-1",
    accessKeyId: access,
    secretAccessKey: secret,
    expiresIn: 86400,
    now: new Date("2013-05-24T00:00:00Z"),
    forcePathStyle: false,
  });
  const url = new URL(signed.url);
  assert.equal(url.host, "examplebucket.s3.amazonaws.com");
  assert.equal(url.pathname, "/test.txt");
  assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "86400");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.equal(url.searchParams.get("X-Amz-Date"), "20130524T000000Z");
  assert.equal(
    url.searchParams.get("X-Amz-Credential"),
    "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request",
  );

  const query = [
    "X-Amz-Algorithm=AWS4-HMAC-SHA256",
    "X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request",
    "X-Amz-Date=20130524T000000Z",
    "X-Amz-Expires=86400",
    "X-Amz-SignedHeaders=host",
  ].join("&");
  const canonical = `GET\n/test.txt\n${query}\nhost:examplebucket.s3.amazonaws.com\n\nhost\nUNSIGNED-PAYLOAD`;
  const hash = createHash("sha256").update(canonical).digest("hex");
  const stringToSign = `AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\n${hash}`;
  let key: Buffer = createHmac("sha256", `AWS4${secret}`).update("20130524").digest();
  key = createHmac("sha256", key).update("us-east-1").digest();
  key = createHmac("sha256", key).update("s3").digest();
  key = createHmac("sha256", key).update("aws4_request").digest();
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  assert.equal(url.searchParams.get("X-Amz-Signature"), signature);
});

test("a presigned PUT signs the content type and a different secret changes the signature", () => {
  const first = presignRequest({
    method: "PUT",
    endpoint: "http://127.0.0.1:9000",
    bucket: "avouch",
    key: "incoming/abc",
    region: "us-east-1",
    accessKeyId: "access",
    secretAccessKey: "one",
    expiresIn: 600,
    now: new Date("2026-10-19T12:00:00Z"),
    forcePathStyle: true,
    contentType: "image/jpeg",
  });
  const second = presignRequest({
    method: "PUT",
    endpoint: "http://127.0.0.1:9000",
    bucket: "avouch",
    key: "incoming/abc",
    region: "us-east-1",
    accessKeyId: "access",
    secretAccessKey: "two",
    expiresIn: 600,
    now: new Date("2026-10-19T12:00:00Z"),
    forcePathStyle: true,
    contentType: "image/jpeg",
  });
  const url = new URL(first.url);
  assert.equal(url.searchParams.get("X-Amz-Expires"), "600");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
  assert.equal(first.headers["content-type"], "image/jpeg");
  assert.equal(url.pathname, "/avouch/incoming/abc");
  assert.notEqual(
    url.searchParams.get("X-Amz-Signature"),
    new URL(second.url).searchParams.get("X-Amz-Signature"),
  );
});

test("a store put uses the signed URL and does not send a cookie", async () => {
  let seenUrl = "";
  let seen: RequestInit | undefined;
  const store = createS3Store(
    {
      enabled: true,
      video: false,
      endpoint: "http://127.0.0.1:9000",
      bucket: "avouch",
      region: "us-east-1",
      accessKeyId: "access",
      secretAccessKey: "secret",
      forcePathStyle: true,
    },
    async (url, init) => {
      seenUrl = url;
      seen = init;
      return new Response(null, { status: 200 });
    },
  );
  await store.put("incoming/a", Uint8Array.of(1), "image/jpeg");
  assert.match(seenUrl, /^http:\/\/127\.0\.0\.1:9000\/avouch\/incoming\/a\?/);
  const headers = seen?.headers as Record<string, string>;
  assert.equal(headers["content-type"], "image/jpeg");
  assert.equal(headers.cookie, undefined);
  assert.equal(seen?.credentials, undefined);
});
