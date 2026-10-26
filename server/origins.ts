const LOCAL_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
];

const SITE_ORIGINS = ["https://avouchsocial.com", "https://www.avouchsocial.com"];

function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** Localhost is trusted only when NODE_ENV is not "production". */
export function allowLocalOrigins(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "production";
}

/**
 * Browser origins allowed to call the API with cookies.
 * Loopback origins are added only when NODE_ENV is not production, and a
 * production WEB_ORIGINS list cannot put them back.
 */
export function parseOrigins(
  value: string | undefined,
  options?: { production?: boolean },
): string[] {
  const production = options?.production === true;
  const fromEnv = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const origins = production
    ? [...fromEnv, ...SITE_ORIGINS]
    : [...fromEnv, ...SITE_ORIGINS, ...LOCAL_ORIGINS];
  return [...new Set(origins.filter((origin) => (production ? !isLoopbackOrigin(origin) : true)))];
}
