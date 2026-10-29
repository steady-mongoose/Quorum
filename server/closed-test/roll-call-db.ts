import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "../db.ts";
import { openTestDb } from "./test-db.ts";

/**
 * A test database where every room takes roll. Roll call is off unless an
 * admin turns it on (migration 0044), so tests about the host's roll call and
 * the attendance it records turn it on first, the way an admin would.
 */
export async function openRollCallDb(): Promise<{ db: Db; pg: PGlite; close: () => Promise<void> }> {
  const opened = await openTestDb();
  await opened.db.query(
    `update room set options = array_append(options, 'roll_call')
     where not ('roll_call' = any (options))`,
  );
  return opened;
}
