import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectRoot } from "./with-app-env.mjs";

test("Caddy limits the closed-test POSTs and is built with the rate limit module", () => {
  const root = projectRoot();
  const caddyfile = readFileSync(join(root, "deploy/Caddyfile"), "utf8");
  assert.match(caddyfile, /zone closed_test/);
  assert.match(caddyfile, /method POST/);
  assert.match(caddyfile, /path \/api\/auth\/sign-in\/\* \/api\/signup \/api\/invites/);
  assert.match(caddyfile, /key \{client_ip\}/);
  assert.equal(caddyfile.includes("{remote_host}"), false);
  assert.match(caddyfile, /events 5/);
  assert.match(caddyfile, /window 1m/);
  assert.match(caddyfile, /ipv6_prefix 64/);
  assert.match(caddyfile, /zone calls/);
  assert.match(caddyfile, /path \/api\/calls\/\*/);
  assert.match(caddyfile, /not path \/api\/calls\/rooms\/\*\/signal/);
  assert.match(caddyfile, /zone call_signal/);
  assert.match(caddyfile, /path \/api\/calls\/rooms\/\*\/signal/);
  assert.match(caddyfile, /events 60/);
  assert.match(caddyfile, /events 120/);
  assert.match(caddyfile, /window 10s/);
  assert.match(caddyfile, /429/);
  assert.equal(caddyfile.includes('Retry-After "60"'), false);
  assert.match(caddyfile, /module sets Retry-After/);
  const dockerfile = readFileSync(join(root, "deploy/Dockerfile.caddy"), "utf8");
  assert.match(
    dockerfile,
    /caddy:2\.10\.2-builder@sha256:01668408cc26e2e00c9d067c30cb43b2ba14ad1f2808beda55503cb2a31f59dc/,
  );
  assert.match(
    dockerfile,
    /caddy:2\.10\.2@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb/,
  );
  assert.match(
    dockerfile,
    /github\.com\/mholt\/caddy-ratelimit@5625512f24f6f59d6f64fb3aafe5eecff0b286db/,
  );
  const compose = readFileSync(join(root, "deploy/docker-compose.yml"), "utf8");
  assert.match(compose, /dockerfile: Dockerfile\.caddy/);
  assert.equal(compose.includes("image: caddy:2.10"), false);
  const apiDockerfile = readFileSync(join(root, "deploy/Dockerfile"), "utf8");
  const appStage = apiDockerfile.slice(0, apiDockerfile.indexOf("FROM app AS media"));
  assert.match(appStage, /COPY src\/lib \.\/src\/lib/);
  assert.equal(appStage.includes("COPY src/lib/media"), false);
  const workflow = readFileSync(join(root, ".github/workflows/test.yml"), "utf8");
  assert.match(workflow, /api-image:/);
  assert.match(workflow, /scripts\/api-image-smoke\.sh/);
});

test("media host uses a Cloudflare Origin CA certificate and serves only the media API", () => {
  const root = projectRoot();
  const caddyfile = readFileSync(join(root, "deploy/Caddyfile"), "utf8");
  const block = caddyfile.slice(caddyfile.indexOf("{$MEDIA_HOST:media.avouchsocial.com}"));
  assert.ok(block.length > 40);
  assert.match(block, /tls \/etc\/caddy\/origin\/media-origin\.pem \/etc\/caddy\/origin\/media-origin\.key/);
  assert.match(block, /@media path \/api\/media \/api\/media\/\*/);
  assert.match(block, /reverse_proxy api:8787/);
  assert.match(block, /respond `\{"error":"Not found\."\}` 404/);
  assert.match(block, /X-Content-Type-Options nosniff/);
  const compose = readFileSync(join(root, "deploy/docker-compose.yml"), "utf8");
  assert.match(compose, /MEDIA_HOST: \$\{MEDIA_HOST:-media\.avouchsocial\.com\}/);
  assert.match(compose, /- \.\/origin:\/etc\/caddy\/origin:ro/);
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^deploy\/origin\/$/m);
});

// Cloudflare's published ranges (https://www.cloudflare.com/ips-v4, /ips-v6), fetched 2026-10-26.
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
];

test("Caddy takes the client address from CF-Connecting-IP only from Cloudflare's ranges", () => {
  const root = projectRoot();
  const caddyfile = readFileSync(join(root, "deploy/Caddyfile"), "utf8");
  const line = /^\t\ttrusted_proxies static (.+)$/m.exec(caddyfile);
  assert.ok(line, "trusted_proxies static must list the ranges on one line");
  assert.deepEqual(line[1].trim().split(/\s+/).sort(), [...CLOUDFLARE_RANGES].sort());
  assert.equal(/trusted_proxies static \{/.test(caddyfile), false, "a block form is ignored by Caddy 2.10");
  assert.match(caddyfile, /^\t\tclient_ip_headers CF-Connecting-IP$/m);
  assert.match(caddyfile, /^\t\ttrusted_proxies_strict$/m);
  // Every proxy to the API sends the resolved address, never a client-supplied chain.
  const proxies = caddyfile.match(/reverse_proxy api:8787[^\n]*/g) ?? [];
  assert.ok(proxies.length >= 2);
  for (const proxy of proxies) assert.match(proxy, /\{$/);
  const headerUps = caddyfile.match(/header_up X-Forwarded-For \{client_ip\}/g) ?? [];
  assert.equal(headerUps.length, proxies.length);
});

// Runs a real Caddy when CADDY_BIN points at one (CI does not ship it).
// The same server options as deploy/Caddyfile, with 127.0.0.1 standing in
// for a Cloudflare edge: a trusted peer's CF-Connecting-IP is used, an
// untrusted peer's is ignored, and a spoofed X-Forwarded-For never passes.
test("a live Caddy forwards the real client address", { skip: !process.env.CADDY_BIN }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "caddy-ip-"));
  const config = join(dir, "Caddyfile");
  writeFileSync(
    config,
    `{
\tadmin off
\tauto_https off
\tservers {
\t\ttrusted_proxies static 127.0.0.1/32
\t\tclient_ip_headers CF-Connecting-IP
\t\ttrusted_proxies_strict
\t}
}
:18181 {
\treverse_proxy 127.0.0.1:18182 {
\t\theader_up X-Forwarded-For {client_ip}
\t}
}
:18182 {
\trespond "{header.X-Forwarded-For}"
}
`,
  );
  const caddy = spawn(String(process.env.CADDY_BIN), ["run", "--config", config, "--adapter", "caddyfile"], {
    stdio: "ignore",
  });
  try {
    /** @param {string} url @param {Record<string, string>} headers */
    const get = async (url, headers) => {
      for (let i = 0; i < 50; i += 1) {
        try {
          return await (await fetch(url, { headers })).text();
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      throw new Error("Caddy did not start");
    };
    const spoof = { "CF-Connecting-IP": "203.0.113.9", "X-Forwarded-For": "6.6.6.6" };
    assert.equal(await get("http://127.0.0.1:18181/", spoof), "203.0.113.9");
    assert.equal(await get("http://127.0.0.1:18181/", { "X-Forwarded-For": "6.6.6.6" }), "127.0.0.1");
    assert.equal(await get("http://[::1]:18181/", spoof), "::1");
  } finally {
    caddy.kill();
  }
});
