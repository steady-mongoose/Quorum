import { writeFileSync } from "node:fs";

/** pgpass escapes backslash and colon in each field. */
function field(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

/**
 * Writes a mode-600 pgpass line for DATABASE_URL and prints host, port, user,
 * and database on separate lines. The password stays in the file.
 */
const target = process.argv[2];
const raw = process.env.DATABASE_URL ?? "";
if (!target || !raw) {
  console.error("pg-pass.mjs needs a file path and DATABASE_URL.");
  process.exit(1);
}
let url;
try {
  url = new URL(raw);
} catch {
  console.error("DATABASE_URL is not a URL.");
  process.exit(1);
}
if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
  console.error("DATABASE_URL must be a postgres URL.");
  process.exit(1);
}
const host = url.hostname;
const port = url.port || "5432";
const user = decodeURIComponent(url.username);
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
const password = decodeURIComponent(url.password);
if (!host || !user || !database) {
  console.error("DATABASE_URL needs a host, user, and database.");
  process.exit(1);
}
writeFileSync(target, `${field(host)}:${field(port)}:${field(database)}:${field(user)}:${field(password)}\n`, {
  mode: 0o600,
});
process.stdout.write(`${host}\n${port}\n${user}\n${database}\n`);
