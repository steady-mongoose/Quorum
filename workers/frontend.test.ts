import assert from "node:assert/strict";
import test from "node:test";
import worker from "./frontend.ts";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const PATHS = ["/api", "/api/", "/api/health", "/api/auth/get-session"];

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
      const response = await worker.fetch(new Request(`https://avouchsocial.com${path}`, { method }), env);
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/, `${method} ${path}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { error: "api-unavailable" });
    }
  }
});
