import pg from "pg";

export type Db = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
};

export function isUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error && error.code === "23505") return true;
  const message = error instanceof Error ? error.message : "";
  return /duplicate key|unique constraint/i.test(message);
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export function pgDb(pool: pg.Pool): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const result = await pool.query(text, params);
      return result.rows as T[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: Db = {
          async query<Row>(text: string, params: unknown[] = []) {
            const result = await client.query(text, params);
            return result.rows as Row[];
          },
          transaction() {
            throw new Error("Nested transactions are not used.");
          },
        };
        const value = await fn(tx);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original error when the connection is already dead.
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
