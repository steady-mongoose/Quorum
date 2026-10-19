// @ts-check
/**
 * Migration bookkeeping shared by the two appliers — `scripts/migrate.mjs`
 * (deploy, `readdir`) and `src/lib/db.ts` (PGLite preview, `import.meta.glob`).
 *
 * Applied files are keyed by BASENAME, so the same file applies once no matter
 * which directory it is globbed from. That is what makes the auth schema safe to
 * copy from `migrations/auth/` into `migrations/` when an app turns sign-in on:
 * a database that already has `0001_auth.sql` will not re-run it.
 *
 * Neither applier descends into subdirectories, so `migrations/auth/*.sql` is
 * out of scope for both until it is copied up.
 */

/**
 * The `_migrations` key for a migration path (or bare filename).
 * @param {string} path
 * @returns {string}
 */
export function migrationName(path) {
  return path.split("/").pop() ?? path;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isMigrationFile(path) {
  return path.endsWith(".sql");
}

/**
 * Migrations in `paths` that are not yet in `applied`, in apply order.
 * Non-`.sql` entries (a `readdir` also yields `migrations/auth/`) are dropped.
 * @param {Iterable<string>} paths
 * @param {Iterable<string>} applied
 * @returns {Array<{ name: string, path: string }>}
 */
export function pendingMigrations(paths, applied) {
  const done = new Set(applied);
  return [...paths]
    .filter(isMigrationFile)
    .map((path) => ({ name: migrationName(path), path }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(({ name }) => !done.has(name));
}

/**
 * Directives in the leading comment block, such as `migrate: skip-embedded`.
 * @param {string} sql
 * @returns {Set<string>}
 */
export function migrationDirectives(sql) {
  const directives = new Set();
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("--")) break;
    const match = trimmed.match(/^--\s*migrate:\s*(\S+)\s*$/);
    if (match?.[1]) directives.add(match[1]);
  }
  return directives;
}

/**
 * Embedded preview databases do not create logins.
 * @param {string} sql
 */
export function isSkipEmbedded(sql) {
  return migrationDirectives(sql).has("skip-embedded");
}

/**
 * Statements such as CREATE ROLE cannot run inside a transaction block.
 * @param {string} sql
 */
export function isNoTransaction(sql) {
  return migrationDirectives(sql).has("no-transaction");
}

/**
 * Substitute the media worker password. The SQL file does not contain it.
 * @param {string} sql
 * @param {string | undefined} password
 * @returns {string}
 */
export function applyMediaWorkerPassword(sql, password) {
  if (!sql.includes("@@MEDIA_WORKER_DB_PASSWORD@@")) return sql;
  if (!password || !/^[A-Za-z0-9]{16,128}$/.test(password)) {
    throw new Error(
      "Set MEDIA_WORKER_DB_PASSWORD to 16 or more letters and digits before applying migrations/0007_media_worker_role.sql. That file needs the owner's approval.",
    );
  }
  return sql.replaceAll("@@MEDIA_WORKER_DB_PASSWORD@@", password);
}

/**
 * Split a migration into statements. Passwords are letters and digits, so a
 * semicolon is always a statement boundary.
 * @param {string} sql
 * @returns {string[]}
 */
export function sqlStatements(sql) {
  /** @type {string[]} */
  const statements = [];
  let current = "";
  let comment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (comment) {
      current += char;
      if (char === "\n") comment = false;
      continue;
    }
    if (char === "-" && next === "-") {
      comment = true;
      current += char;
      continue;
    }
    if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((statement) =>
    statement.split("\n").some((line) => {
      const trimmed = line.trim();
      return trimmed !== "" && !trimmed.startsWith("--");
    }),
  );
}
