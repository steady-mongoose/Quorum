import assert from "node:assert/strict";
import test from "node:test";
import { probeApiMode } from "./api-mode.ts";

function jsonResponse(status: number, body: unknown, type = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": type } });
}

test("an explicit demo flag does not call the API", async () => {
  let called = false;
  const mode = await probeApiMode(
    "https://api.avouchsocial.com",
    async () => {
      called = true;
      return jsonResponse(200, { ok: true });
    },
    2500,
    true,
  );
  assert.equal(mode, "demo");
  assert.equal(called, false);
});

test("an empty base probes same-origin /api/health", async () => {
  let url = "";
  const live = await probeApiMode("  ", async (input) => {
    url = String(input);
    return jsonResponse(200, { ok: true });
  });
  assert.equal(live, "live");
  assert.equal(url, "/api/health");
  const missed = await probeApiMode("", async () => jsonResponse(503, { error: "api-unavailable" }));
  assert.equal(missed, "demo");
});

test("a healthy API is live, and a 503 or HTML body stays in demo", async () => {
  assert.equal(
    await probeApiMode("https://api.avouchsocial.com/", async () =>
      jsonResponse(200, { ok: true }),
    ),
    "live",
  );
  assert.equal(
    await probeApiMode("https://api.avouchsocial.com", async () =>
      jsonResponse(503, { error: "api-unavailable" }),
    ),
    "demo",
  );
  assert.equal(
    await probeApiMode("https://api.avouchsocial.com", async () =>
      jsonResponse(200, { ok: true }, "text/html; charset=utf-8"),
    ),
    "demo",
  );
  assert.equal(
    await probeApiMode("https://api.avouchsocial.com", async () =>
      jsonResponse(200, { ok: false }),
    ),
    "demo",
  );
});

test("a network failure or a timeout stays in demo", async () => {
  assert.equal(
    await probeApiMode("https://api.avouchsocial.com", async () => {
      throw new Error("offline");
    }),
    "demo",
  );
  assert.equal(
    await probeApiMode(
      "https://api.avouchsocial.com",
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      20,
    ),
    "demo",
  );
});
