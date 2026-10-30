import assert from "node:assert/strict";
import test from "node:test";
import worker from "./frontend.ts";

const GATHERING = "3f2a9c1e-8241-4c3e-9a11-8241abcd1234";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const PATHS = ["/api", "/api/", "/api/health", "/api/auth/get-session"];

test("the shell is served with a strict content security policy", async () => {
  const env = {
    ASSETS: {
      fetch: () =>
        new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }),
    },
  } as unknown as Env;
  const response = await worker.fetch(new Request("https://avouchsocial.com/"), env);
  const policy = response.headers.get("content-security-policy") ?? "";
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'none'/);
  assert.equal(policy.includes("unsafe-inline"), false);
  assert.match(policy, /script-src 'self' https:\/\/static\.cloudflareinsights\.com/);
  assert.match(policy, /connect-src [^;]*https:\/\/cloudflareinsights\.com/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  // libsodium compiles WebAssembly. JavaScript eval stays refused.
  assert.match(policy, /script-src [^;]*'wasm-unsafe-eval'/);
  assert.equal(policy.replaceAll("'wasm-unsafe-eval'", "").includes("unsafe-eval"), false);
});

test("every method on /api and /api/* returns JSON 503", async () => {
  const env = {
    ASSETS: {
      fetch: () => {
        throw new Error("ASSETS.fetch must not run for /api");
      },
    },
  } as unknown as Env;

  for (const path of PATHS) {
    for (const method of METHODS) {
      const response = await worker.fetch(
        new Request(`https://avouchsocial.com${path}`, { method }),
        env,
      );
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.match(
        response.headers.get("content-type") ?? "",
        /application\/json/,
        `${method} ${path}`,
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'self'/);
      assert.deepEqual(await response.json(), { error: "api-unavailable" });
    }
  }
});

test("the admin stats address is the app shell", async () => {
  let fetched = "";
  const env = {
    ASSETS: {
      fetch: (request: Request) => {
        fetched = request.url;
        return new Response("<!doctype html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    },
  } as unknown as Env;
  const response = await worker.fetch(new Request("https://avouchsocial.com/admin/stats"), env);
  assert.equal(response.status, 200);
  assert.match(fetched, /\/index\.html$/);
  assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'self'/);
});

test("an unknown /e id is not-found and a known id is the API page", async () => {
  const env = {
    ASSETS: {
      fetch: () => {
        throw new Error("ASSETS.fetch must not run for /e");
      },
    },
  } as unknown as Env;
  const unknown = await worker.fetch(new Request("https://avouchsocial.com/e/1"), env);
  assert.equal(unknown.status, 404);
  assert.match(unknown.headers.get("x-robots-tag") ?? "", /noindex/);
  const unknownHtml = await unknown.text();
  assert.match(unknownHtml, /not shared/);
  assert.equal(unknownHtml.includes("og:title"), false);

  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), `https://api.avouchsocial.com/e/${GATHERING}`);
    return new Response("<html>Saturday lifts</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };
  try {
    const page = await worker.fetch(new Request(`https://avouchsocial.com/e/${GATHERING}`), env);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Saturday lifts/);
    assert.match(page.headers.get("x-robots-tag") ?? "", /noindex/);
  } finally {
    globalThis.fetch = original;
  }
});
