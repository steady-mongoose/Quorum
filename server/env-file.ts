import { readFileSync, writeFileSync } from "node:fs";

function passwordValue(raw: string): string {
  let value = raw.trim();
  const quoted =
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
  if (quoted) value = value.slice(1, -1).trim();
  return value;
}

/**
 * Blanks a non-empty BOOTSTRAP_OWNER_PASSWORD line. A file with no password
 * is returned unchanged: nothing is appended.
 */
export function stripOwnerPassword(text: string): string {
  const match = /^BOOTSTRAP_OWNER_PASSWORD=(.*)$/m.exec(text);
  if (!match || !passwordValue(match[1] ?? "")) return text;
  return text.replace(/^BOOTSTRAP_OWNER_PASSWORD=.*$/m, "BOOTSTRAP_OWNER_PASSWORD=");
}

export type PasswordClear = "cleared" | "clean" | "failed";

/**
 * Removes a leftover founding password from an env file.
 * A clean file is not written. Never prints the password.
 */
export function clearOwnerPasswordFile(path: string): PasswordClear {
  try {
    const text = readFileSync(path, "utf8");
    const next = stripOwnerPassword(text);
    if (next === text) return "clean";
    writeFileSync(path, next, { mode: 0o600 });
    return "cleared";
  } catch {
    return "failed";
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"));
if (isMain) {
  const path = process.argv[2];
  const result = path ? clearOwnerPasswordFile(path) : "failed";
  if (result === "failed") {
    console.error("Could not remove BOOTSTRAP_OWNER_PASSWORD from the env file.");
    process.exit(1);
  }
  if (result === "cleared") console.log(`Removed BOOTSTRAP_OWNER_PASSWORD from ${path}.`);
}
