import { createAccountFactory } from "./accounts.ts";
import { createClosedAuth } from "./auth.ts";
import { readHostConfig } from "./config.ts";
import { seatFoundingAdmin } from "./closed-test/store.ts";
import { createPool, pgDb } from "./db.ts";
import { clearOwnerPasswordFile } from "./env-file.ts";

/**
 * Seats Josh once. A second run prints that he is already seated and exits 0.
 * Requires BOOTSTRAP_OWNER=Josh (or 1 or true), plus email and password.
 * If a leftover password cannot be cleared from the env file, exits 2.
 */
export async function seedOwner(): Promise<number> {
  const config = readHostConfig();
  const pool = createPool(config.databaseUrl);
  try {
    const auth = createClosedAuth({
      database: pool,
      secret: config.secret,
      baseURL: config.baseURL,
      trustedOrigins: config.origins,
    });
    const headers = new Headers({ origin: config.baseURL });
    const result = await seatFoundingAdmin(
      pgDb(pool),
      {
        envName: config.bootstrapOwner,
        email: config.bootstrapEmail,
        password: config.bootstrapPassword,
        headers,
      },
      createAccountFactory(auth, config.baseURL, "bootstrap"),
    );
    const envFile = process.env.ENV_FILE;
    if (envFile) {
      const cleared = clearOwnerPasswordFile(envFile);
      if (cleared === "cleared") {
        console.log(`Removed BOOTSTRAP_OWNER_PASSWORD from ${envFile}.`);
      } else if (cleared === "failed") {
        console.error("Could not remove BOOTSTRAP_OWNER_PASSWORD from the env file.");
        if (!result.ok) console.error(result.error);
        return 2;
      }
    }
    if (!result.ok) {
      console.error(result.error);
      if (result.error.includes("already seated")) return 0;
      return 1;
    }
    console.log("Seated Josh once as founding admin and council chair.");
    return 0;
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"));
if (isMain) {
  seedOwner()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
