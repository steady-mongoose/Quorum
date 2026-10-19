import { betterAuth } from "better-auth";
import type { Dialect } from "kysely";
import type { Pool } from "pg";
import { assertAccountCreateAllowed } from "./closed-test/account-create.ts";

type AuthDatabase = Pool | { dialect: Dialect; type: "postgres" };

/**
 * Better Auth for the dedicated box. Email and password only.
 * The Grok broker config in src/lib/auth/server.ts is left as the preview scaffold.
 * Open signup is refused in the database hook; the HTTP route is refused as well.
 */
export function createClosedAuth(options: {
  database: AuthDatabase;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
}) {
  const secure = options.baseURL.startsWith("https:");
  return betterAuth({
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: options.database,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            assertAccountCreateAllowed();
          },
        },
      },
    },
    advanced: {
      useSecureCookies: secure,
      defaultCookieAttributes: { sameSite: "lax", secure, path: "/" },
    },
  });
}

export type ClosedAuth = ReturnType<typeof createClosedAuth>;
