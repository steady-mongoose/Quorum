import type { Db } from "../db.ts";

/** The worker asks this before keeping an upload. */
export async function isBlockedHash(db: Db, sha256: string): Promise<boolean> {
  if (!sha256) return false;
  const rows = await db.query<{ sha256: string }>(
    `select sha256 from media_block_hash where sha256 = $1`,
    [sha256],
  );
  return rows.length > 0;
}
