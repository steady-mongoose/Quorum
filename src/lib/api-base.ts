/**
 * Browser calls to the dedicated-box API.
 *
 * `VITE_API_BASE_URL` is baked in at build time (Vite only exposes `VITE_`
 * vars to the client). Leave it empty for same-origin paths: local dev, and
 * any host that reverse-proxies `/api` itself. Set it to the API origin
 * (`https://api.avouchsocial.com`) for the static site on Cloudflare.
 *
 * The static Worker answers `/api` with a JSON 503 until the dedicated box
 * exists. An HTML body (a shell, or an error page) is still treated as
 * unavailable, so the page never parses the site shell as JSON.
 */

const HTML_TYPE = /text\/html/i;

/** Join `path` with an API origin. An empty base keeps a same-origin path. */
export function resolveApiUrl(path: string, base: string | undefined | null): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const trimmed = (base ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return normalized;
  return `${trimmed}${normalized}`;
}

/** Configured API origin, without a trailing slash. Empty when unset. */
export function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  return typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
}

/** Absolute or same-origin URL for an API path such as `/api/auth/get-session`. */
export function apiUrl(path: string): string {
  return resolveApiUrl(path, import.meta.env.VITE_API_BASE_URL as string | undefined);
}

/** JSON 503 used when the API cannot be reached or answered with HTML. */
export function apiUnavailableResponse(): Response {
  return new Response(JSON.stringify({ error: "api-unavailable" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

/** Replace an HTML body (SPA fallback or an error page) with a JSON 503. */
export function softenApiResponse(res: Response): Response {
  const type = res.headers.get("content-type") ?? "";
  if (HTML_TYPE.test(type)) return apiUnavailableResponse();
  return res;
}

/**
 * `fetch` that never throws for transport failures, and never returns the
 * static shell as a successful API body.
 */
export async function softenFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return softenApiResponse(await fetch(input, init));
  } catch {
    return apiUnavailableResponse();
  }
}

/** Fetch `path` against the configured API base. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return softenFetch(apiUrl(path), init);
}
