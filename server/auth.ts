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
    // Database rows are shared by every process on the box. Memory would
    // reset on restart and would not be shared. Sign-in is tighter than
    // the default window. The app also limits /api/signup and /api/invites.
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/*": { window: 600, max: 5 },
        "/sign-up/*": { window: 600, max: 3 },
      },
    },
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
      ipAddress: {
        // host.ts sets this from the socket, or from Caddy when the peer is trusted.
        ipAddressHeaders: ["x-avouch-client-ip"],
      },
    },
  });
}

export type ClosedAuth = ReturnType<typeof createClosedAuth>;
