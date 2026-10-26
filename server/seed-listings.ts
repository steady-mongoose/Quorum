import { readFile } from "node:fs/promises";
import { actorRole } from "./board/access.ts";
import { importListings } from "./board/claims.ts";
import { createPool, pgDb } from "./db.ts";

/**
 * Import seeded listings. The file is JSON (an array or { listings }) or CSV
 * with name, town, county, category, and source_url. Nothing else is stored
 * as a fact about the organization.
 *
 * The actor is the founding admin, or SEED_LISTINGS_ACTOR when that user is
 * an admin. Set DATABASE_URL. A second import of the same name is refused.
 */
export async function seedListings(path: string): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    console.error("Set DATABASE_URL before importing listings.");
    return 1;
  }
  const pool = createPool(databaseUrl);
  try {
    const db = pgDb(pool);
    const actorId = process.env.SEED_LISTINGS_ACTOR?.trim() ?? "";
    const seat = actorId
      ? [{ user_id: actorId }]
      : await db.query<{ user_id: string }>(
          `select user_id from bootstrap_seat where id = 'founding'`,
        );
    const userId = seat[0]?.user_id ?? "";
    if (!userId) {
      console.error("Seat the founding admin before importing listings.");
      return 1;
    }
    const actor = await actorRole(db, userId);
    if (!actor.admin) {
      console.error("Only an admin can import listings.");
      return 1;
    }
    const text = await readFile(path, "utf8");
    const body = path.toLowerCase().endsWith(".csv")
      ? { csv: text }
      : (JSON.parse(text) as unknown);
    const saved = await importListings(db, { userId, body, now: new Date() });
    if (!saved.ok) {
      console.error(saved.error);
      return 1;
    }
    for (const row of saved.value.imported) {
      console.log(`${row.status} ${row.id} ${row.name}`);
    }
    console.log(`Imported ${saved.value.imported.length}.`);
    return 0;
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"));
if (isMain) {
  const path = process.argv[2] ?? "";
  if (!path) {
    console.error("Usage: npm run seed:listings -- listings.json");
    process.exit(1);
  }
  seedListings(path)
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
