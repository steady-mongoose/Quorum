import assert from "node:assert/strict";
import test from "node:test";
import { cleanCloudflareIce, createCloudflareIceCache } from "./cloudflare-turn.ts";
import { createIceSource, readCallsConfig } from "./config.ts";
import { parseIceUrl } from "../../src/lib/calls/ice.ts";

const KEY = { TURN_KEY_ID: "a".repeat(32), TURN_KEY_API_TOKEN: "t".repeat(40) };
const good = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:evil.example.net:3478"] },
    {
      urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349"],
      username: "u",
      credential: "c",
    },
  ],
};

test("only Cloudflare hosts survive", () => {
  const out = cleanCloudflareIce(good);
  assert.deepEqual(out?.[0]?.urls, ["stun:stun.cloudflare.com:3478"]);
  assert.equal(out?.[1]?.username, "u");
  assert.equal(cleanCloudflareIce({ iceServers: [{ urls: "turn:x.example.com" }] }), null);
  assert.equal(cleanCloudflareIce(null), null);
});

test("env Cloudflare URLs are still refused; only the API path may use them", () => {
  assert.equal(parseIceUrl("turn:turn.cloudflare.com:3478"), null);
  assert.ok(parseIceUrl("turn:turn.cloudflare.com:3478", { allowCloudflare: true }));
  assert.equal(
    readCallsConfig({ CALLS: "on", CALLS_STUN_URLS: "stun:stun.cloudflare.com:3478" }).enabled,
    false,
  );
});

test("half a Cloudflare key keeps calls off", () => {
  assert.deepEqual(readCallsConfig({ CALLS: "on", TURN_KEY_ID: KEY.TURN_KEY_ID }), {
    enabled: false,
    reason: "partial-turn",
  });
  assert.deepEqual(readCallsConfig({ CALLS: "on", TURN_KEY_API_TOKEN: KEY.TURN_KEY_API_TOKEN }), {
    enabled: false,
    reason: "partial-turn",
  });
});

test("Cloudflare request shape, cache, and coturn fallback", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let ok = true;
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (!ok) throw new Error("down");
    return new Response(JSON.stringify(good), { status: 201 });
  }) as unknown as typeof fetch;
  const source = createIceSource(fake);
  const config = readCallsConfig({
    CALLS: "on",
    CALLS_STUN_URLS: "stun:stun.example.com:3478",
    ...KEY,
  });
  const first = await source(config, "ada", 0);
  assert.equal(first[1]?.credential, "c");
  assert.equal(
    calls[0]?.url,
    `https://rtc.live.cloudflare.com/v1/turn/keys/${KEY.TURN_KEY_ID}/credentials/generate-ice-servers`,
  );
  assert.equal(
    (calls[0]?.init.headers as Record<string, string>).authorization,
    `Bearer ${KEY.TURN_KEY_API_TOKEN}`,
  );
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { ttl: 3600 });
  await source(config, "bob", 1000);
  assert.equal(calls.length, 1, "cached");

  ok = false;
  const fresh = createIceSource(fake);
  const fallback = await fresh(config, "ada", 0);
  assert.deepEqual(fallback, [{ urls: ["stun:stun.example.com:3478"] }]);

  const plain = readCallsConfig({ CALLS: "on", CALLS_STUN_URLS: "stun:stun.example.com:3478" });
  const before = calls.length;
  await fresh(plain, "ada", 0);
  assert.equal(calls.length, before, "no Cloudflare call without a key");
});

test("cache refetches after half the TTL", async () => {
  let n = 0;
  const fake = (async () => {
    n++;
    return new Response(JSON.stringify(good), { status: 201 });
  }) as unknown as typeof fetch;
  const cache = createCloudflareIceCache(fake);
  const key = { keyId: KEY.TURN_KEY_ID, apiToken: KEY.TURN_KEY_API_TOKEN };
  await cache.get(key, 100, 0);
  await cache.get(key, 100, 49_000);
  assert.equal(n, 1);
  await cache.get(key, 100, 51_000);
  assert.equal(n, 2);
});
