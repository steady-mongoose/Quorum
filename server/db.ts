import pg from "pg";

export type Db = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /**
   * One pooled connection for the whole call. A session advisory lock taken
   * inside `fn` stays on that connection until `fn` unlocks it.
   */
  session?<T>(fn: (db: Db) => Promise<T>): Promise<T>;
};

/** What the API says when Postgres drops a connection. No SQL and no driver code. */
export const DB_UNAVAILABLE = "The server could not finish that.";

/**
 * A connection died (restart, failover, pg_terminate_backend, network blip).
 * The message is the same sentence the API returns. There is no `code`.
 */
export class DatabaseUnavailable extends Error {
  constructor() {
    super(DB_UNAVAILABLE);
    this.name = "DatabaseUnavailable";
  }
}

export function isUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error && error.code === "23505") return true;
  const message = error instanceof Error ? error.message : "";
  return /duplicate key|unique constraint/i.test(message);
}

/** Postgres and OS codes that mean this connection is finished. */
const DROP_CODES = new Set([
  "57P01", // admin_shutdown (pg_terminate_backend)
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

/** True when this error means the connection itself is gone. */
export function isConnectionDrop(error: unknown): boolean {
  if (DROP_CODES.has(errorCode(error))) return true;
  return /connection terminated|connection refused|server closed the connection|terminating connection|connection ended|socket hang up|ECONNRESET/i.test(
    errorText(error),
  );
}

/** Logs a driver failure without the connection string, password, or query text. */
function logPg(event: string, error: unknown): void {
  const code = errorCode(error);
  const message = errorText(error)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
    .replace(/(password|pwd)=([^\s&]+)/gi, "$1=[redacted]")
    .slice(0, 200);
  console.error(
    JSON.stringify({
      event,
      ...(code ? { code } : {}),
      message: message || "database connection dropped",
    }),
  );
}

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  // Idle clients emit here. With no listener, Node treats that as a crash.
  pool.on("error", (error) => {
    logPg("pg-pool-error", error);
  });
  return pool;
}

/**
 * Listens for 'error' while this client is checked out. pg-pool only listens
 * while the client is idle, so a drop during a transaction would otherwise
 * crash the process. `release` discards the client when the connection died
 * (`release(err)`), and leaves a sink listener so a late error during destroy
 * cannot crash the process. Call `release` once.
 */
const sink = Symbol("pg-error-sink");

function watchClient(client: pg.PoolClient): {
  broken: () => Error | undefined;
  release: (error?: unknown) => void;
} {
  let broken: Error | undefined;
  let released = false;
  const onError = (error: Error) => {
    broken = error instanceof Error ? error : new Error("database connection dropped");
    logPg("pg-client-error", error);
  };
  client.on("error", onError);
  return {
    broken: () => broken,
    release(error?: unknown) {
      if (released) return;
      released = true;
      client.removeListener("error", onError);
      // One sink for the life of the client. A late error during release must
      // not be unhandled, and a new sink on every checkout would leak listeners.
      const held = client as pg.PoolClient & { [sink]?: () => void };
      if (!held[sink]) {
        held[sink] = () => {};
        client.on("error", held[sink]);
      }
      const cause = broken ?? (isConnectionDrop(error) ? asError(error) : undefined);
      client.release(cause);
    },
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("database connection dropped");
}

/** Constraint failures stay intact so callers can still tell a duplicate key. A dead connection becomes one sentence. */
function surface(error: unknown, broken: Error | undefined): unknown {
  if (!broken && !isConnectionDrop(error)) return error;
  if (errorCode(error).startsWith("23")) return error;
  return new DatabaseUnavailable();
}

export function pgDb(pool: pg.Pool): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const client = await pool.connect();
      const watch = watchClient(client);
      let failed: unknown;
      try {
        const result = await client.query(text, params);
        return result.rows as T[];
      } catch (error) {
        failed = error;
        throw surface(error, watch.broken());
      } finally {
        watch.release(failed);
      }
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      const client = await pool.connect();
      const watch = watchClient(client);
      let failed: unknown;
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
        failed = error;
        if (!watch.broken() && !isConnectionDrop(error)) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Keep the original error when the connection is already dead.
          }
        }
        throw surface(error, watch.broken());
      } finally {
        watch.release(failed);
      }
    },
    async session<T>(fn: (db: Db) => Promise<T>) {
      const client = await pool.connect();
      const watch = watchClient(client);
      const conn = clientDb(client);
      let failed: unknown;
      try {
        return await fn(conn);
      } catch (error) {
        failed = error;
        throw surface(error, watch.broken());
      } finally {
        watch.release(failed);
      }
    },
  };
}

/** Queries on one checked-out connection. Advisory locks stay on this session. */
function clientDb(client: pg.PoolClient): Db {
  const conn: Db = {
    async query<T>(text: string, params: unknown[] = []) {
      const result = await client.query(text, params);
      return result.rows as T[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      await client.query("BEGIN");
      try {
        const value = await fn(conn);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original error when the connection is already dead.
        }
        throw error;
      }
    },
    async session<T>(fn: (db: Db) => Promise<T>) {
      return fn(conn);
    },
  };
  return conn;
}
