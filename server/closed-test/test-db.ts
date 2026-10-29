import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { isSkipEmbedded } from "../../scripts/migration-plan.mjs";
import type { Db } from "../db.ts";

/**
 * `before` stops at the first migration whose name sorts at or after it, so a
 * test can build a database as it stood before a file and apply that file itself.
 */
export async function openTestDb(
  options: { before?: string; ageUnconfirmed?: boolean } = {},
): Promise<{ db: Db; pg: PGlite; close: () => Promise<void> }> {
  const pg = new PGlite();
  await pg.waitReady;
  const dir = new URL("../../migrations/", import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    if (options.before && name >= options.before) break;
    const sql = await readFile(new URL(name, dir), "utf8");
    // Logins are for the closed-test Postgres. The embedded database skips them.
    if (isSkipEmbedded(sql)) continue;
    await pg.exec(sql);
  }
  // Most tests are about something else, so test accounts count as 18+
  // confirmed unless a test asks for an account from before the check.
  // Production has no such default: age_confirmed_at stays null until a member confirms.
  if (!options.before && !options.ageUnconfirmed) {
    await pg.exec(`alter table "user" alter column age_confirmed_at set default now()`);
  }
  const adapter = (queryable: {
    query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    transaction?: PGlite["transaction"];
  }): Db => ({
    async query<T>(text: string, params: unknown[] = []) {
      const result = await queryable.query(text, params);
      return result.rows as T[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (!queryable.transaction) throw new Error("This connection cannot open a transaction.");
      return queryable.transaction(async (tx) => fn(adapter(tx)));
    },
    async session<T>(fn: (db: Db) => Promise<T>) {
      return fn(adapter(queryable));
    },
  });
  return { db: adapter(pg), pg, close: () => pg.close() };
}
