import assert from "node:assert/strict";
import test from "node:test";
import { rateLimitIp, resolveIncoming } from "./proxy.ts";

const base = {
  trustedProxies: ["172.28.19.10"],
  baseURL: "https://api.avouchsocial.com",
  path: "/api/health",
};

test("the request URL is BETTER_AUTH_URL, and forwarded-for counts only from Caddy", () => {
  const stranger = resolveIncoming({
    ...base,
    remoteAddress: "203.0.113.8",
    forwardedFor: "198.51.100.4",
  });
  assert.equal(stranger.trusted, false);
  assert.equal(stranger.url, "https://api.avouchsocial.com/api/health");
  assert.equal(stranger.clientIp, "203.0.113.8");

  const caddy = resolveIncoming({
    ...base,
    remoteAddress: "::ffff:172.28.19.10",
    forwardedFor: "198.51.100.4, 172.28.19.10",
  });
  assert.equal(caddy.trusted, true);
  assert.equal(caddy.url, "https://api.avouchsocial.com/api/health");
  assert.equal(caddy.clientIp, "198.51.100.4");
});

test("IPv6 rate limits use the /64 and IPv4 stays a single address", () => {
  assert.equal(rateLimitIp("2001:db8:1:2::10"), "2001:db8:1:2::/64");
  assert.equal(rateLimitIp("2001:0db8:0001:0002:ffff::1"), "2001:db8:1:2::/64");
  assert.equal(rateLimitIp("2001:db8:1:3::1"), "2001:db8:1:3::/64");
  assert.equal(rateLimitIp("203.0.113.8"), "203.0.113.8");
  assert.equal(rateLimitIp("::ffff:203.0.113.8"), "203.0.113.8");
  assert.equal(rateLimitIp("local"), "local");

  const caddy = resolveIncoming({
    ...base,
    remoteAddress: "172.28.19.10",
    forwardedFor: "2001:db8:9:9::abcd",
  });
  assert.equal(caddy.clientIp, "2001:db8:9:9::/64");
});

test("a trusted peer with no forwarded address keeps the socket address", () => {
  const caddy = resolveIncoming({
    ...base,
    remoteAddress: "172.28.19.10",
    forwardedFor: "",
  });
  assert.equal(caddy.trusted, true);
  assert.equal(caddy.url, "https://api.avouchsocial.com/api/health");
  assert.equal(caddy.clientIp, "172.28.19.10");
});
