import assert from "node:assert/strict";
import test from "node:test";
import { CLOUDFLARE_TTL_SECONDS, cleanCloudflareIce } from "./cloudflare-turn.ts";
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

type Call = { url: string; init: RequestInit };
function fakeCloudflare() {
  const calls: Call[] = [];
  let n = 0;
  const state = { ok: true };
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (!state.ok) throw new Error("down");
    if (url.endsWith("/revoke")) return new Response(null, { status: 204 });
    n++;
    return new Response(
      JSON.stringify({
        iceServers: [
          { urls: ["stun:stun.cloudflare.com:3478"] },
          {
            urls: ["turn:turn.cloudflare.com:3478"],
            username: `user${n}`,
            credential: `secret${n}`,
          },
        ],
      }),
      { status: 201 },
    );
  }) as unknown as typeof fetch;
  return {
    calls,
    impl,
    state,
    mints: () => calls.filter((c) => c.url.endsWith("generate-ice-servers")),
  };
}

const config = readCallsConfig({
  CALLS: "on",
  CALLS_STUN_URLS: "stun:stun.example.com:3478",
  ...KEY,
});
const ada = { userId: "ada", session: "shop#1" };
const bob = { userId: "bob", session: "shop#1" };

test("request shape, short TTL, and a mint log without the secret", async () => {
  const cf = fakeCloudflare();
  const logs: Record<string, unknown>[] = [];
  const source = createIceSource(cf.impl, (line) => logs.push(line));
  const servers = await source(config, ada, 0);
  assert.equal(servers[1]?.username, "user1");
  const mint = cf.mints()[0];
  assert.equal(
    mint?.url,
    `https://rtc.live.cloudflare.com/v1/turn/keys/${KEY.TURN_KEY_ID}/credentials/generate-ice-servers`,
  );
  assert.equal(
    (mint?.init.headers as Record<string, string>).authorization,
    `Bearer ${KEY.TURN_KEY_API_TOKEN}`,
  );
  assert.deepEqual(JSON.parse(String(mint?.init.body)), { ttl: CLOUDFLARE_TTL_SECONDS });
  assert.equal(CLOUDFLARE_TTL_SECONDS <= 15 * 60, true);
  const line = logs.find((l) => l.event === "turn-mint");
  assert.equal(line?.userId, "ada");
  assert.equal(line?.session, "shop#1");
  assert.equal(line?.username, "user1");
  assert.doesNotMatch(JSON.stringify(logs), /secret1|tttt/);
});

test("credentials are per user and per session, never shared", async () => {
  const cf = fakeCloudflare();
  const source = createIceSource(cf.impl, () => {});
  const a = await source(config, ada, 0);
  const b = await source(config, bob, 0);
  assert.notEqual(a[1]?.username, b[1]?.username);
  assert.equal(
    (await source(config, ada, 1000))[1]?.username,
    a[1]?.username,
    "same session reuses",
  );
  assert.equal(cf.mints().length, 2);
  const next = await source(config, { userId: "ada", session: "shop#2" }, 2000);
  assert.notEqual(next[1]?.username, a[1]?.username, "a re-join mints fresh");
  assert.ok(
    cf.calls.some((c) => c.url.endsWith(`/credentials/${a[1]?.username}/revoke`)),
    "the old session is revoked",
  );
});

test("release revokes, so a removed member's relay stops", async () => {
  const cf = fakeCloudflare();
  const source = createIceSource(cf.impl, () => {});
  const a = await source(config, ada, 0);
  source.release("ada");
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(cf.calls.some((c) => c.url.endsWith(`/credentials/${a[1]?.username}/revoke`)));
  await source(config, ada, 1000);
  assert.equal(cf.mints().length, 2, "a fresh mint is needed after release");
});

test("refresh in the last 5 minutes; expired credentials are never returned", async () => {
  const cf = fakeCloudflare();
  const source = createIceSource(cf.impl, () => {});
  const ttl = CLOUDFLARE_TTL_SECONDS * 1000;
  await source(config, ada, 0);
  await source(config, ada, ttl - 5 * 60_000 - 1);
  assert.equal(cf.mints().length, 1);
  cf.state.ok = false;
  // Refresh fails while the old set is still valid: keep it.
  const stillValid = await source(config, ada, ttl - 60_000);
  assert.equal(stillValid[1]?.username, "user1");
  // Refresh fails after expiry: coturn/STUN, never the expired set.
  const after = await source(config, ada, ttl + 1);
  assert.deepEqual(after, [{ urls: ["stun:stun.example.com:3478"] }]);
});

test("a non-OK reply after expiry also falls back", async () => {
  let first = true;
  const impl = (async () => {
    if (first) {
      first = false;
      return new Response(JSON.stringify(good), { status: 201 });
    }
    return new Response("{}", { status: 500 });
  }) as unknown as typeof fetch;
  const source = createIceSource(impl, () => {});
  await source(config, ada, 0);
  const after = await source(config, ada, CLOUDFLARE_TTL_SECONDS * 1000 + 1);
  assert.deepEqual(after, [{ urls: ["stun:stun.example.com:3478"] }]);
});

test("no Cloudflare call without a key", async () => {
  const cf = fakeCloudflare();
  const source = createIceSource(cf.impl, () => {});
  const plain = readCallsConfig({ CALLS: "on", CALLS_STUN_URLS: "stun:stun.example.com:3478" });
  await source(plain, ada, 0);
  assert.equal(cf.calls.length, 0);
});
