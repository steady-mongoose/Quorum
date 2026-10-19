import { betterAuth } from "better-auth";
import type { Dialect } from "kysely";
import type { Pool } from "pg";
import { assertAccountCreateAllowed } from "./closed-test/account-create.ts";

type AuthDatabase = Pool | { dialect: Dialect; type: "postgres" };

/**
 * Shared database limiter. Sign-in is 5 per minute per client address.
 * The app adds the same cap per email, and the same caps on /api/signup and /api/invites.
 */
export const authRateLimit = {
  enabled: true,
  storage: "database" as const,
  window: 60,
  max: 60,
  customRules: {
    "/sign-in/*": { window: 60, max: 5 },
    "/sign-up/*": { window: 60, max: 5 },
  },
};

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
    rateLimit: authRateLimit,
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
