import type { Db } from "../db.ts";

/** Shown to the member. The log line names the migration. */
export const BAN_CHECK_UNAVAILABLE = "Ban checks are not available.";

/**
 * Migration 0008 has not been applied, so the server cannot tell who is barred.
 * Callers must refuse the request. Treating the error as "nobody is banned"
 * would let a barred member through.
 */
export class BanCheckUnavailable extends Error {
  readonly status = 503;
  constructor() {
    super(BAN_CHECK_UNAVAILABLE);
    this.name = "BanCheckUnavailable";
  }
}

/** Postgres `undefined_table`. For these queries that relation is `board_ban`. */
export function isMissingBanTable(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && String(error.code) === "42P01",
  );
}

/**
 * Log the missing table and refuse. Any other error is left for the caller.
 */
export function refuseMissingBanTable(error: unknown): void {
  if (!isMissingBanTable(error)) return;
  console.error(
    JSON.stringify({
      event: "ban-table-missing",
      message: "board_ban is missing. Apply migrations/0008_board.sql. The request was refused.",
    }),
  );
  throw new BanCheckUnavailable();
}

/** Run a query that reads `board_ban`. A missing table fails closed. */
export async function queryBanTable<T>(db: Db, text: string, params: unknown[]): Promise<T[]> {
  try {
    return await db.query<T>(text, params);
  } catch (error) {
    refuseMissingBanTable(error);
    throw error;
  }
}
