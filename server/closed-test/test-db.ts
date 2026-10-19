import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { isSkipEmbedded } from "../../scripts/migration-plan.mjs";
import type { Db } from "../db.ts";

export async function openTestDb(): Promise<{ db: Db; pg: PGlite; close: () => Promise<void> }> {
  const pg = new PGlite();
  await pg.waitReady;
  const dir = new URL("../../migrations/", import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const sql = await readFile(new URL(name, dir), "utf8");
    // Logins are for the closed-test Postgres. The embedded database skips them.
    if (isSkipEmbedded(sql)) continue;
    await pg.exec(sql);
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
  });
  return { db: adapter(pg), pg, close: () => pg.close() };
}
