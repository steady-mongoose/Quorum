import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { isSkipEmbedded, pendingMigrations } from "../../scripts/migration-plan.mjs";

/**
 * Production has 0051_counties.sql applied while #126's 0049 and 0050 are not
 * (Josh's OK for those is still to come). The migrator keys applied files by
 * name, not by number, so the later 0051 must not stop 0049 and 0050 from
 * applying, and 0051 must not run twice.
 */
const dir = new URL("../../migrations/", import.meta.url);
const RSVP = ["0049_gathering_rsvp.sql", "0050_gathering_special.sql"];

test("a database with 0051 applied but not 0049 and 0050 applies exactly those two, cleanly, and skips 0051", async () => {
  const entries = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  assert.ok(entries.includes("0047_age_attestation.sql"));
  assert.ok(entries.includes("0051_counties.sql"));
  const pg = new PGlite();
  try {
    await pg.waitReady;
    await pg.exec("create table _migrations (name text primary key, applied_at timestamptz not null default now())");
    const apply = async (name: string) => {
      const sql = await readFile(new URL(name, dir), "utf8");
      if (!isSkipEmbedded(sql)) await pg.exec(sql);
      await pg.query("insert into _migrations (name) values ($1)", [name]);
    };
    // Production today: everything through 0047, and 0051, in that order.
    for (const name of entries.filter((name) => !RSVP.includes(name))) await apply(name);
    const applied = (await pg.query<{ name: string }>("select name from _migrations")).rows.map((row) => row.name);
    assert.ok(applied.includes("0051_counties.sql"));
    const pending = pendingMigrations(entries, applied).map((item) => item.name);
    assert.deepEqual(pending, RSVP, "only 0049 and 0050 are pending; 0051 is not run again");
    for (const name of pending) await apply(name);
    assert.deepEqual(pendingMigrations(entries, (await pg.query<{ name: string }>("select name from _migrations")).rows.map((row) => row.name)), []);
    // What 0049 and 0050 add is there, and 0051's counties are untouched.
    assert.equal((await pg.query<{ t: string | null }>("select to_regclass('public.gathering_rsvp')::text as t")).rows[0]?.t, "gathering_rsvp");
    const columns = (
      await pg.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'public_gathering' and column_name in ('special', 'moved_from') order by column_name",
      )
    ).rows.map((row) => row.column_name);
    assert.deepEqual(columns, ["moved_from", "special"]);
    assert.equal((await pg.query<{ n: number }>("select count(*)::int as n from county")).rows[0]?.n, 4);
  } finally {
    await pg.close();
  }
});

test("0049 and 0050 are byte-identical to what QA and Design reviewed", async () => {
  const sha = async (name: string) => createHash("sha256").update(await readFile(new URL(name, dir))).digest("hex");
  assert.equal(await sha("0049_gathering_rsvp.sql"), "32360246292276f1feb569b9f187e3ea3f0af9e2840f8a718286f3992e47c362");
  assert.equal(await sha("0050_gathering_special.sql"), "5be35d836c4feeb8ae74f29e36b21350568f7ada202efb3cd449b1aa6080ddd0");
});
