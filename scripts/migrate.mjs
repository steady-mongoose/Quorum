#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Applies pending files in ../migrations to DATABASE_URL. Each file is applied
 * in one transaction and recorded in a `_migrations` table, so it runs once
 * and is safe to re-run.
 *
 * The owner must approve every new file under migrations/ before this runs
 * against a real database. The API process does not call this on startup.
 * `npm run build` does not call it either. Run `npm run db:migrate`, or the
 * compose migrate profile, only after that approval. Leave DATABASE_URL unset
 * in the Cloudflare frontend build.
 *
 * The read is non-recursive, so the opt-in auth schema under migrations/auth/
 * is not applied to an app that never asked for sign-in.
 *
 * No DATABASE_URL (local / preview builds) -> skip; the PGLite fallback applies
 * the same files at startup instead (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { mediaWorkerPasswordSql } from "./media-worker-password.mjs";
import { isNoTransaction, pendingMigrations, sqlStatements } from "./migration-plan.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).");
  process.exit(0);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    return;
  }
  // An app with no schema of its own must not pay for a database connection.
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] no migrations — nothing to do.");
    return;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = (await client.query("SELECT name FROM _migrations")).rows.map((r) => r.name);

    let count = 0;
    for (const { name } of pendingMigrations(entries, applied)) {
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        if (isNoTransaction(text)) {
          // CREATE ROLE cannot run inside a transaction block. Each statement
          // is its own implicit transaction. A role that already exists is
          // left in place so a retry can finish the grants.
          for (const statement of sqlStatements(text)) {
            try {
              await client.query(statement);
            } catch (error) {
              const createRole = /^\s*(?:--[^\n]*\n\s*)*create\s+role\s+/i.test(statement);
              if (createRole && error?.code === "42710") continue;
              throw error;
            }
          }
          await client.query("BEGIN");
          await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
          await client.query("COMMIT");
        } else {
          await client.query("BEGIN");
          // pg's simple-query protocol runs a whole multi-statement file at once.
          await client.query(text);
          await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
          await client.query("COMMIT");
        }
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          // ROLLBACK fails when the connection died — keep the original error.
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    const password = process.env.MEDIA_WORKER_DB_PASSWORD;
    if (password) {
      const role = await client.query("select 1 from pg_roles where rolname = 'media_worker'");
      if (role.rowCount !== 1) {
        throw new Error(
          "Approve migrations/0007_media_worker_role.sql before setting MEDIA_WORKER_DB_PASSWORD.",
        );
      }
      // Every run, including a re-run. CREATE ROLE is recorded once and would
      // otherwise keep the previous password.
      await client.query(mediaWorkerPasswordSql(password));
      console.log("[migrate] updated the media_worker password.");
    }
    console.log(
      count ? `[migrate] done — ${count} migration(s) applied.` : "[migrate] up to date.",
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  // pg errors carry the context needed to debug a bad SQL file.
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
