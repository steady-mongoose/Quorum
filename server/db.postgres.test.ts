import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { isNoTransaction, sqlStatements } from "../scripts/migration-plan.mjs";
import { createApp, type AppDeps } from "./http.ts";
import { createPool, DB_UNAVAILABLE, DatabaseUnavailable, pgDb, type Db } from "./db.ts";

test("createPool listens for idle connection drops", async () => {
  const pool = createPool("postgres://avouch:secret@127.0.0.1:1/none");
  try {
    assert.ok(pool.listenerCount("error") >= 1);
  } finally {
    await pool.end();
  }
});

async function applyMigrations(client: pg.PoolClient): Promise<void> {
  const dir = new URL("../migrations/", import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const text = await readFile(new URL(name, dir), "utf8");
    if (isNoTransaction(text)) {
      for (const statement of sqlStatements(text)) {
        try {
          await client.query(statement);
        } catch (error) {
          const createRole = /^\s*(?:--[^\n]*\n\s*)*create\s+role\s+/i.test(statement);
          const code = error && typeof error === "object" && "code" in error ? error.code : "";
          if (createRole && code === "42710") continue;
          throw error;
        }
      }
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(text);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

function leaks(value: unknown): boolean {
  const text = JSON.stringify(value);
  return /57P01|08006|08003|postgres:\/\/|password|terminating connection|duplicate key/i.test(text);
}

test("a refused checkout fails closed without the driver error", async () => {
  const secret = "postgres://avouch:secret@127.0.0.1:5432/avouch";
  const logs: string[] = [];
  const write = console.error;
  console.error = (line?: unknown) => {
    logs.push(String(line));
  };
  const refuse = (code: string) => {
    const error = new Error(`connect ${code} ${secret}`) as Error & { code: string };
    error.code = code;
    return error;
  };
  try {
    const cases = [
      { method: "query" as const, code: "ECONNREFUSED" },
      { method: "transaction" as const, code: "57P03" },
      { method: "session" as const, code: "ECONNREFUSED" },
    ];
    for (const item of cases) {
      const pool = {
        connect: async () => {
          throw refuse(item.code);
        },
      } as unknown as pg.Pool;
      const db = pgDb(pool);
      let thrown: unknown;
      try {
        if (item.method === "query") await db.query("select 1 as n");
        else if (item.method === "transaction") await db.transaction(async () => 1);
        else await db.session!(async () => 1);
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown instanceof DatabaseUnavailable, item.method);
      assert.equal((thrown as Error).message, DB_UNAVAILABLE, item.method);
      assert.equal("code" in (thrown as object), false, `${item.method} has no driver code`);
      assert.equal(leaks(thrown), false, item.method);
      assert.equal(String((thrown as Error).message).includes(secret), false, item.method);
    }
  } finally {
    console.error = write;
  }
  assert.equal(logs.length, 3);
  for (const line of logs) {
    const entry = JSON.parse(line) as { event?: string; message?: string };
    assert.equal(entry.event, "pg-connect-error");
    assert.equal(line.includes(secret), false);
    assert.equal(line.includes("secret"), false);
    assert.match(entry.message ?? "", /\[redacted\]/);
    assert.equal((entry.message ?? "").includes("select 1"), false);
  }
});

test("a dropped connection during a transaction does not crash the API", async (t) => {
  const url = process.env.CLAIM_POSTGRES_URL ?? "";
  if (!url) {
    if (process.env.CLAIM_POSTGRES_REQUIRED === "1") {
      throw new Error("Set CLAIM_POSTGRES_URL to the CI Postgres service.");
    }
    t.skip("Set CLAIM_POSTGRES_URL to run the connection-drop test on Postgres.");
    return;
  }

  const crashes: unknown[] = [];
  const onCrash = (error: unknown) => {
    crashes.push(error);
  };
  process.on("uncaughtException", onCrash);
  process.on("unhandledRejection", onCrash);

  const admin = new pg.Client({ connectionString: url });
  admin.on("error", () => {});
  await admin.connect();
  const name = `drop_${randomBytes(4).toString("hex")}`;
  const poolUrl = new URL(url);
  poolUrl.pathname = `/${name}`;
  await admin.query(`create database ${name}`);
  const pool = createPool(poolUrl.toString());
  const db = pgDb(pool);

  try {
    let thrown: unknown;
    try {
      await db.transaction(async (tx) => {
        const rows = await tx.query<{ pid: number }>("select pg_backend_pid() as pid");
        const pid = Number(rows[0]?.pid);
        assert.ok(pid > 0);
        await admin.query("select pg_terminate_backend($1)", [pid]);
        await tx.query("select 1 as n");
      });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof DatabaseUnavailable, "the transaction fails closed");
    assert.equal((thrown as Error).message, DB_UNAVAILABLE);
    assert.equal("code" in (thrown as object), false, "no driver code on the error");
    assert.equal(leaks(thrown), false);
    assert.deepEqual(crashes, [], "the process stays up");

    const after = await db.query<{ n: number }>("select 1 as n");
    assert.equal(Number(after[0]?.n), 1, "a later query gets a fresh connection");

    const idle = await pool.connect();
    idle.on("error", () => {});
    const idlePid = Number((await idle.query("select pg_backend_pid() as pid")).rows[0]?.pid);
    idle.release();
    await admin.query("select pg_terminate_backend($1)", [idlePid]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(crashes, [], "an idle pool drop does not crash the process");
    const again = await db.query<{ n: number }>("select 2 as n");
    assert.equal(Number(again[0]?.n), 2);

    const setup = await pool.connect();
    setup.on("error", () => {});
    try {
      await applyMigrations(setup);
    } finally {
      setup.release();
    }

    let kill = true;
    const trapped: Db = {
      query: (text, params) => db.query(text, params),
      transaction: (fn) => {
        if (!kill) return db.transaction(fn);
        kill = false;
        return db.transaction(async (tx) => {
          const rows = await tx.query<{ pid: number }>("select pg_backend_pid() as pid");
          await admin.query("select pg_terminate_backend($1)", [Number(rows[0]?.pid)]);
          return fn(tx);
        });
      },
      session: (fn) => db.session!(fn),
    };
    const app = createApp({
      db: trapped,
      origins: ["http://localhost:8080"],
      now: () => new Date("2026-11-06T12:00:00Z"),
      createAccount: async () => ({ id: "unused" }),
      signIn: async () => ({ ok: false, status: 400, message: "no" }),
      readSession: async () => ({ id: "member-1", name: "Ada", email: "ada@example.com" }),
      forwardAuth: async () => new Response(null, { status: 404 }),
    } satisfies AppDeps);

    const failed = await app(
      new Request("http://127.0.0.1:8787/api/board", {
        headers: { origin: "http://localhost:8080" },
      }),
    );
    const body = (await failed.json()) as { error?: string };
    assert.equal(kill, false, "the request opened a transaction");
    assert.equal(failed.status, 500);
    assert.equal(body.error, DB_UNAVAILABLE);
    assert.equal(leaks(body), false, "the response has no SQL or driver code");
    assert.deepEqual(crashes, [], "the API process stays up");

    const health = await app(new Request("http://127.0.0.1:8787/api/health"));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    assert.deepEqual(crashes, []);
  } finally {
    process.removeListener("uncaughtException", onCrash);
    process.removeListener("unhandledRejection", onCrash);
    await pool.end().catch(() => {});
    await admin.query(`drop database if exists ${name} with (force)`).catch(() => {});
    await admin.end().catch(() => {});
  }
});
