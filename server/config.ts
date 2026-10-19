import { parseOrigins } from "./origins.ts";

export type HostConfig = {
  databaseUrl: string;
  secret: string;
  baseURL: string;
  origins: string[];
  port: number;
  bootstrapOwner: string;
  bootstrapEmail: string;
  bootstrapPassword: string;
  trustedProxies: string[];
  production: boolean;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} before starting the API.`);
  return value;
}

/** Env for the dedicated-box process. Throws a plain message when it is incomplete. */
export function readHostConfig(): HostConfig {
  const secret = required("BETTER_AUTH_SECRET");
  if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
  const port = Number(process.env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be a port number.");
  const baseURL = required("BETTER_AUTH_URL").replace(/\/+$/, "");
  const production = process.env.NODE_ENV === "production" || baseURL.startsWith("https:");
  return {
    databaseUrl: required("DATABASE_URL"),
    secret,
    baseURL,
    origins: parseOrigins(process.env.WEB_ORIGINS, { production }),
    port,
    bootstrapOwner: process.env.BOOTSTRAP_OWNER?.trim() ?? "",
    bootstrapEmail: process.env.BOOTSTRAP_OWNER_EMAIL?.trim() ?? "",
    bootstrapPassword: process.env.BOOTSTRAP_OWNER_PASSWORD ?? "",
    trustedProxies: (process.env.TRUSTED_PROXIES ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    production,
  };
}
