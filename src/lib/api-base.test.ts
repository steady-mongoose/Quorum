import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiUrl, softenApiResponse } from "./api-base.ts";

test("empty API base keeps a same-origin path", () => {
  assert.equal(resolveApiUrl("/api/auth/get-session", ""), "/api/auth/get-session");
  assert.equal(resolveApiUrl("/api/rtc", undefined), "/api/rtc");
  assert.equal(resolveApiUrl("/api/rtc", "   "), "/api/rtc");
  assert.equal(resolveApiUrl("api/rtc", null), "/api/rtc");
});

test("API base is prefixed and trailing slashes are stripped", () => {
  assert.equal(
    resolveApiUrl("/api/rtc", "https://api.avouchsocial.com"),
    "https://api.avouchsocial.com/api/rtc",
  );
  assert.equal(
    resolveApiUrl("api/auth/get-session", "https://api.avouchsocial.com/"),
    "https://api.avouchsocial.com/api/auth/get-session",
  );
  assert.equal(
    resolveApiUrl("/api/rtc", "  https://api.avouchsocial.com/  "),
    "https://api.avouchsocial.com/api/rtc",
  );
});

test("an HTML response is not treated as API data", async () => {
  const html = new Response("<!doctype html><html></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const softened = softenApiResponse(html);
  assert.equal(softened.status, 503);
  assert.match(softened.headers.get("content-type") ?? "", /application\/json/);
  const body = (await softened.json()) as { error?: string };
  assert.equal(body.error, "api-unavailable");
});

test("a JSON response passes through", () => {
  const json = new Response('{"ok":true}', {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.equal(softenApiResponse(json), json);
});
