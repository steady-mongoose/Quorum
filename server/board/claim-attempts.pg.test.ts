import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { isNoTransaction, sqlStatements } from "../../scripts/migration-plan.mjs";
import { pgDb } from "../db.ts";
import { confirmClaimCode, importListings, requestClaim } from "./claims.ts";

const now = new Date("2026-10-26T12:00:00.000Z");

function counted(result: { ok: boolean; error?: string }): boolean {
  if (result.ok) return false;
  return result.error === "That code does not match." || /too many times/.test(result.error ?? "");
}

async function applyMigrations(client: pg.PoolClient): Promise<void> {
  const dir = new URL("../../migrations/", import.meta.url);
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

test("parallel email guesses on Postgres stop at the attempts that were counted", async (t) => {
  const url = process.env.CLAIM_POSTGRES_URL ?? "";
  if (!url) {
    if (process.env.CLAIM_POSTGRES_REQUIRED === "1") {
      throw new Error("Set CLAIM_POSTGRES_URL to the CI Postgres service.");
    }
    t.skip("Set CLAIM_POSTGRES_URL to run the claim attempt race on Postgres.");
    return;
  }

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const name = `claim_attempt_${randomBytes(4).toString("hex")}`;
  const poolUrl = new URL(url);
  poolUrl.pathname = `/${name}`;
  await admin.query(`create database ${name}`);
  const pool = new pg.Pool({ connectionString: poolUrl.toString(), max: 30 });
  pool.on("error", () => {});
  const setup = await pool.connect();
  try {
    await applyMigrations(setup);
  } finally {
    setup.release();
  }

  const db = pgDb(pool);
  try {
    const userId = randomUUID();
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Pat', $2, true, $3, $3)`,
      [userId, `pat-${userId.slice(0, 8)}@example.com`, now],
    );
    await db.query(
      `insert into member_role (user_id, is_admin, is_council, is_council_chair)
       values ($1, true, false, false)`,
      [userId],
    );
    const imported = await importListings(db, {
      userId,
      now,
      body: {
        listings: [
          {
            name: "Grace Hall",
            town: "Brandon",
            county: "Hillsborough",
            category: "Church",
            source_url: "https://grace.example/about",
          },
        ],
      },
    });
    assert.equal(imported.ok, true);
    let mailed = "";
    const opened = await requestClaim(
      db,
      {
        userId,
        roomKey: "grace-hall",
        method: "domain_email",
        email: "office@grace.example",
        now,
      },
      {
        send: async (message) => {
          mailed = message.text;
          return { ok: true };
        },
      },
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const code = mailed.match(/The code is ([A-Z2-9]+)\./)?.[1] ?? "";
    assert.equal(code.length > 0, true);
    const claimId = opened.value.claim.id;
    const wrongCode = "ZZZZZZZZ";
    const burst = 24;
    const results = await Promise.all([
      ...Array.from({ length: burst }, () =>
        confirmClaimCode(db, { userId, claimId, code: wrongCode, now }),
      ),
      confirmClaimCode(db, { userId, claimId, code, now }),
    ]);
    const right = results[burst];
    const saved = await db.query<{ state: string; evidence: string }>(
      `select state, evidence from claim_request where id = $1`,
      [claimId],
    );
    const evidence = JSON.parse(saved[0]?.evidence ?? "{}") as {
      attempts?: number;
      verifiedAt?: string;
    };
    const attempts = evidence.attempts ?? 0;
    // Every counted refusal is in the row, and never more than the limit.
    assert.equal(attempts, results.filter(counted).length);
    assert.equal(attempts <= 5, true);
    // The right code races the guesses. Either it lands before the fifth
    // counted guess and the claim stays verified, or it lands after and the
    // claim is expired. It must never be both.
    if (right?.ok) {
      assert.equal(saved[0]?.state, "pending");
      assert.equal(typeof evidence.verifiedAt, "string");
      assert.equal(attempts < 5, true);
    } else {
      assert.equal(saved[0]?.state, "expired");
      assert.equal(attempts, 5);
      assert.equal(Boolean(evidence.verifiedAt), false);
    }
    const again = await confirmClaimCode(db, { userId, claimId, code: wrongCode, now });
    assert.equal(again.ok, false);
    const after = await db.query<{ state: string; evidence: string }>(
      `select state, evidence from claim_request where id = $1`,
      [claimId],
    );
    assert.equal(after[0]?.state, saved[0]?.state, "a late guess does not change the outcome");
    assert.equal(
      (JSON.parse(after[0]?.evidence ?? "{}") as { attempts?: number }).attempts ?? 0,
      attempts,
    );
  } finally {
    await pool.end();
    await admin.query(`drop database if exists ${name}`);
    await admin.end();
  }
});
