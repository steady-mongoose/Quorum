const LOCAL_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
];

const SITE_ORIGINS = ["https://avouchsocial.com", "https://www.avouchsocial.com"];

/** Browser origins allowed to call the API with cookies. */
export function parseOrigins(value: string | undefined): string[] {
  const fromEnv = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, ...SITE_ORIGINS, ...LOCAL_ORIGINS])];
}
