import assert from "node:assert/strict";
import test from "node:test";
import { resolveIncoming } from "./proxy.ts";

const base = {
  trustedProxies: ["172.28.19.10"],
  baseURL: "https://api.avouchsocial.com",
  path: "/api/health",
};

test("forwarded headers are ignored unless the peer is Caddy", () => {
  const stranger = resolveIncoming({
    ...base,
    remoteAddress: "203.0.113.8",
    forwardedProto: "https",
    forwardedHost: "evil.example",
    forwardedFor: "198.51.100.4",
    hostHeader: "evil.example",
  });
  assert.equal(stranger.trusted, false);
  assert.equal(stranger.url, "https://api.avouchsocial.com/api/health");
  assert.equal(stranger.clientIp, "203.0.113.8");

  const caddy = resolveIncoming({
    ...base,
    remoteAddress: "::ffff:172.28.19.10",
    forwardedProto: "https",
    forwardedHost: "api.avouchsocial.com",
    forwardedFor: "198.51.100.4, 172.28.19.10",
    hostHeader: "api.avouchsocial.com",
  });
  assert.equal(caddy.trusted, true);
  assert.equal(caddy.url, "https://api.avouchsocial.com/api/health");
  assert.equal(caddy.clientIp, "198.51.100.4");
});

test("a trusted peer with a bad host falls back to the configured origin", () => {
  const caddy = resolveIncoming({
    ...base,
    remoteAddress: "172.28.19.10",
    forwardedProto: "javascript",
    forwardedHost: "evil example",
    forwardedFor: "",
    hostHeader: "evil example",
  });
  assert.equal(caddy.url, "https://api.avouchsocial.com/api/health");
  assert.equal(caddy.clientIp, "172.28.19.10");
});
