/**
 * Browser calls to the dedicated-box API.
 *
 * `VITE_API_BASE_URL` is baked in at build time (Vite only exposes `VITE_`
 * vars to the client). Leave it empty for same-origin paths: a host that
 * reverse-proxies `/api` itself. Set it to the API origin
 * (`https://api.avouchsocial.com`) for the static site on Cloudflare.
 * `VITE_DEMO=1` keeps the board in the browser and does not call `/api`.
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

function readVite(name: string): string | undefined {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const value = env?.[name];
  return typeof value === "string" ? value : undefined;
}

/** Configured API origin, without a trailing slash. Empty when unset. */
export function apiBaseUrl(): string {
  return (readVite("VITE_API_BASE_URL") ?? "").trim().replace(/\/+$/, "");
}

/** Absolute or same-origin URL for an API path such as `/api/auth/get-session`. */
export function apiUrl(path: string): string {
  return resolveApiUrl(path, readVite("VITE_API_BASE_URL"));
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

const unauthorizedHandlers = new Set<() => void>();

/**
 * Runs when an API call returns 401. The session is known to be absent.
 * Listeners clear local session state. They do not run for any other status.
 */
export function addUnauthorizedHandler(handler: () => void): () => void {
  unauthorizedHandlers.add(handler);
  return () => {
    unauthorizedHandlers.delete(handler);
  };
}

/** Tell session listeners that this response is a 401. Other statuses do nothing. */
export function noteUnauthorized(response: Response): void {
  if (response.status !== 401) return;
  for (const handler of unauthorizedHandlers) {
    try {
      handler();
    } catch {
      // One listener cannot block the response or the other listeners.
    }
  }
}

/** Fetch `path` against the configured API base. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await softenFetch(apiUrl(path), init);
  noteUnauthorized(response);
  return response;
}
