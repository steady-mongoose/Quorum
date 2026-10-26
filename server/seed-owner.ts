import { createAccountFactory } from "./accounts.ts";
import { createClosedAuth } from "./auth.ts";
import { readHostConfig } from "./config.ts";
import { seatFoundingAdmin } from "./closed-test/store.ts";
import { createPool, pgDb } from "./db.ts";
import { clearOwnerPasswordFile } from "./env-file.ts";

/**
 * Seats Josh once. Refuses to run a second time.
 * Requires BOOTSTRAP_OWNER=Josh (or 1 or true), plus email and password.
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
    if (!result.ok) {
      console.error(result.error);
      return 1;
    }
    console.log("Seated Josh once as founding admin and council chair.");
    const envFile = process.env.ENV_FILE;
    if (envFile && clearOwnerPasswordFile(envFile)) {
      console.log(`Removed BOOTSTRAP_OWNER_PASSWORD from ${envFile}.`);
    } else {
      console.log("Remove BOOTSTRAP_OWNER_PASSWORD from deploy/.env, then restart the API.");
    }
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
