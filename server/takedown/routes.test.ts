import assert from "node:assert/strict";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import { handleTakedown } from "./routes.ts";

const now = new Date("2026-10-27T12:00:00Z");

test("anyone can file without signing in; the queue needs a session", async () => {
  const { db, close } = await openTestDb();
  try {
    const deps = { db, readSession: async () => null, now: () => now };
    const filed = await handleTakedown(
      deps,
      new Request("http://x/api/takedown", {
        method: "POST",
        body: JSON.stringify({
          name: "Rae",
          email: "rae@example.com",
          description: "In the shop room on October 20.",
          goodFaith: true,
          signature: "Rae",
        }),
      }),
      new URL("http://x/api/takedown"),
    );
    assert.equal(filed?.status, 201);
    const body = (await filed!.json()) as { request: { id: string } };
    assert.match(body.request.id, /^TD-/);

    const queue = await handleTakedown(deps, new Request("http://x/api/takedown"), new URL("http://x/api/takedown"));
    assert.equal(queue?.status, 401);
    assert.equal(await handleTakedown(deps, new Request("http://x/api/other"), new URL("http://x/api/other")), null);
  } finally {
    await close();
  }
});
