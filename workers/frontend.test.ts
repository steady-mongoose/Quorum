import assert from "node:assert/strict";
import test from "node:test";
import worker from "./frontend.ts";

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
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
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
