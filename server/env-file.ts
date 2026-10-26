import { readFileSync, writeFileSync } from "node:fs";

/** Clears the founding password line. The rest of the file stays. */
export function stripOwnerPassword(text: string): string {
  if (!/^BOOTSTRAP_OWNER_PASSWORD=/m.test(text)) {
    return text.endsWith("\n") || text.length === 0
      ? `${text}BOOTSTRAP_OWNER_PASSWORD=\n`
      : `${text}\nBOOTSTRAP_OWNER_PASSWORD=\n`;
  }
  return text.replace(/^BOOTSTRAP_OWNER_PASSWORD=.*$/m, "BOOTSTRAP_OWNER_PASSWORD=");
}

/**
 * Removes BOOTSTRAP_OWNER_PASSWORD from an env file after Josh is seated.
 * Returns false when the file cannot be written. Never prints the password.
 */
export function clearOwnerPasswordFile(path: string): boolean {
  try {
    const text = readFileSync(path, "utf8");
    writeFileSync(path, stripOwnerPassword(text), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"));
if (isMain) {
  const path = process.argv[2];
  if (!path || !clearOwnerPasswordFile(path)) {
    console.error("Could not remove BOOTSTRAP_OWNER_PASSWORD from the env file.");
    process.exit(1);
  }
  console.log(`Removed BOOTSTRAP_OWNER_PASSWORD from ${path}.`);
}
