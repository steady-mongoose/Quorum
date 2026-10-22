import assert from "node:assert/strict";
import test from "node:test";
import { createApp, type AppDeps } from "../http.ts";
import type { CreateAccount, SignIn } from "../closed-test/store.ts";
import { roomCallMember } from "../calls/membership.ts";
import type { Db } from "../db.ts";
import { memberOfRoom } from "../media/access.ts";
import { BAN_CHECK_UNAVAILABLE, BanCheckUnavailable } from "./ban-check.ts";
import { listGroups } from "./groups.ts";
import { listHome } from "./places-store.ts";
import { listBoard, openBan, openBanOrNone, writeBan } from "./store.ts";

const now = new Date("2026-10-22T12:00:00Z");

function missingTable(): Error {
  const error = new Error('relation "board_ban" does not exist');
  return Object.assign(error, { code: "42P01" });
}

function dbFor(query: Db["query"]): Db {
  const db: Db = {
    query,
    transaction: async (fn) => fn(db),
  };
  return db;
}

function captureError(run: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((item) => String(item)).join(" "));
  };
  return run()
    .finally(() => {
      console.error = original;
    })
    .then(() => lines.join("\n"));
}

test("a missing ban table is refused and logged, not treated as nobody banned", async () => {
  const db = dbFor(async (sql) => {
    if (sql.includes("board_ban")) throw missingTable();
    return [];
  });
  const log = await captureError(async () => {
    await assert.rejects(openBan(db, "maria", now), (error: unknown) => {
      assert.ok(error instanceof BanCheckUnavailable);
      assert.equal(error.status, 503);
      assert.equal(error.message, BAN_CHECK_UNAVAILABLE);
      return true;
    });
    await assert.rejects(openBanOrNone(db, "maria", now, "shop"), BanCheckUnavailable);
  });
  assert.match(log, /ban-table-missing/);
  assert.match(log, /0008_board\.sql/);
});

test("an empty ban table still means this person is not barred", async () => {
  const db = dbFor(async () => []);
  assert.equal(await openBan(db, "maria", now), null);
  assert.equal(await openBanOrNone(db, "maria", now), null);
});

test("a ban-table failure that is not a missing relation still throws", async () => {
  const db = dbFor(async () => {
    throw Object.assign(new Error("connection refused"), { code: "08006" });
  });
  const log = await captureError(async () => {
    await assert.rejects(openBan(db, "maria", now), (error: unknown) => {
      assert.equal(error instanceof BanCheckUnavailable, false);
      assert.equal(error instanceof Error ? error.message : "", "connection refused");
      return true;
    });
  });
  assert.equal(log.includes("ban-table-missing"), false);
});

test("home, room media, and calls fail closed when the ban table is missing", async () => {
  const db = dbFor(async <T>(sql: string) => {
    if (sql.includes("board_ban")) throw missingTable();
    if (sql.includes("bootstrap_seat")) return [{ user_id: "maria" }] as T[];
    if (sql.includes("from room")) return [{ id: "shop" }] as T[];
    return [] as T[];
  });
  const log = await captureError(async () => {
    await assert.rejects(listHome(db, "maria", now), BanCheckUnavailable);
    await assert.rejects(memberOfRoom(db, "maria", "shop", now), BanCheckUnavailable);
    assert.equal((await roomCallMember(db, "maria", "shop", now)).kind, "unavailable");
  });
  assert.match(log, /ban-table-missing/);
});

test("the invite log answers 503 when the ban table is missing and 200 when it is empty", async () => {
  const handler = (query: Db["query"]) => {
    const deps: AppDeps = {
      db: dbFor(query),
      origins: ["http://localhost:8080"],
      now: () => now,
      createAccount: (async () => ({ id: "unused" })) satisfies CreateAccount,
      signIn: (async () => ({
        ok: false,
        status: 401,
        message: "unused",
      })) satisfies SignIn,
      readSession: async () => ({ id: "maria", name: "Maria", email: "maria@example.com" }),
      forwardAuth: async () => new Response(null, { status: 500 }),
    };
    return createApp(deps);
  };

  const log = await captureError(async () => {
    const refused = await handler(async (sql) => {
      if (sql.includes("board_ban")) throw missingTable();
      return [];
    })(
      new Request("http://127.0.0.1:8787/api/invite-log", {
        headers: { "x-user-id": "maria" },
      }),
    );
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), { error: BAN_CHECK_UNAVAILABLE });
  });
  assert.match(log, /ban-table-missing/);
  assert.equal(log.includes("api-error"), false);

  const open = await handler(async () => [])(
    new Request("http://127.0.0.1:8787/api/invite-log", {
      headers: { "x-user-id": "maria" },
    }),
  );
  assert.equal(open.status, 200);
  assert.deepEqual(await open.json(), { entries: [] });
});

test("the group list, the ban list, and a new ban fail closed when the table is missing", async () => {
  const member = dbFor(async <T>(sql: string) => {
    if (sql.includes("left join board_ban")) throw missingTable();
    if (sql.includes("from board_ban") && sql.includes("limit 500")) throw missingTable();
    if (sql.includes("select strikes from board_ban")) throw missingTable();
    if (sql.includes("bootstrap_seat")) return [{ user_id: "maria" }] as T[];
    return [] as T[];
  });
  await assert.rejects(listGroups(member, "maria", now), BanCheckUnavailable);
  await assert.rejects(listBoard(member, "maria", now), BanCheckUnavailable);
  await assert.rejects(
    writeBan(member, {
      userId: "pete",
      name: "Pete",
      reason: "threat",
      byUserId: "josh",
      byName: "Josh",
      removalId: null,
      now,
      roomId: "",
    }),
    BanCheckUnavailable,
  );

  const handler = (query: Db["query"]) => {
    const deps: AppDeps = {
      db: dbFor(query),
      origins: ["http://localhost:8080"],
      now: () => now,
      createAccount: (async () => ({ id: "unused" })) satisfies CreateAccount,
      signIn: (async () => ({
        ok: false,
        status: 401,
        message: "unused",
      })) satisfies SignIn,
      readSession: async () => ({ id: "maria", name: "Maria", email: "maria@example.com" }),
      forwardAuth: async () => new Response(null, { status: 500 }),
    };
    return createApp(deps);
  };
  const app = handler(async <T>(sql: string) => {
    if (
      sql.includes("left join board_ban") ||
      (sql.includes("from board_ban") && sql.includes("limit 500"))
    )
      throw missingTable();
    if (sql.includes("bootstrap_seat")) return [{ user_id: "maria" }] as T[];
    return [] as T[];
  });
  for (const path of ["/api/groups", "/api/board"]) {
    const response = await app(new Request(`http://127.0.0.1:8787${path}`));
    assert.equal(response.status, 503, path);
    assert.deepEqual(await response.json(), { error: BAN_CHECK_UNAVAILABLE });
  }
});
