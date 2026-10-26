import { isGatheringId, publicGatheringHtml } from "../src/lib/board/public-gathering.ts";

/**
 * Edge gate for the Avouch Social static site.
 *
 * `/api/*` is not the SPA. The API is the dedicated box at api.avouchsocial.com.
 * This Worker keeps answering every method with a JSON 503 so a same-origin
 * call falls back to demo mode. Paths with a file extension are real files: a miss is a
 * 404, not index.html. Extensionless addresses get the shell so the client
 * router can show the page, including the styled not-found.
 * `/e/<id>` is the public gathering. It is rendered by the API, so a crawler
 * sees the live page instead of the shell.
 */

/**
 * Scripts and objects come only from this site. Styles and fonts also allow
 * the typefaces the shell already loads. Trusted Types are not required:
 * React writes the page without a policy, and turning the requirement on
 * would stop the app from booting. The policy still refuses injected script
 * sources, plugins, and a swapped base URL.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.avouchsocial.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const GATHERING_PAGE = /^\/e\/([0-9a-f-]{36})$/i;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) return withSecurity(apiUnavailable(request));
    if (url.pathname === "/e" || url.pathname.startsWith("/e/")) {
      return withSecurity(await publicGathering(request, env, url));
    }
    if (hasFileExtension(url.pathname)) return withSecurity(await env.ASSETS.fetch(request));
    if (request.method !== "GET" && request.method !== "HEAD") {
      return withSecurity(
        new Response("Method not allowed", {
          status: 405,
          headers: {
            allow: "GET, HEAD",
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        }),
      );
    }
    const shell = new URL("/index.html", url);
    return withSecurity(await env.ASSETS.fetch(new Request(shell, request)));
  },
} satisfies ExportedHandler<Env>;

function withSecurity(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function apiOrigin(env: Env): string {
  const extra = env as Env & { API_ORIGIN?: string };
  const fromEnv = typeof extra.API_ORIGIN === "string" ? extra.API_ORIGIN.trim() : "";
  return fromEnv.replace(/\/+$/, "") || "https://api.avouchsocial.com";
}

async function publicGathering(request: Request, env: Env, url: URL): Promise<Response> {
  const miss = publicGatheringHtml(null).body;
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...headers, allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" },
    });
  }
  const match = GATHERING_PAGE.exec(url.pathname);
  const id = match?.[1] ?? "";
  if (!isGatheringId(id)) {
    return new Response(request.method === "HEAD" ? null : miss, { status: 404, headers });
  }
  try {
    const upstream = await fetch(`${apiOrigin(env)}/e/${id.toLowerCase()}`, {
      method: request.method,
      redirect: "manual",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(4000),
    });
    if (upstream.status === 200 || upstream.status === 404) {
      return new Response(request.method === "HEAD" ? null : upstream.body, {
        status: upstream.status,
        headers,
      });
    }
  } catch {
    // The API did not answer. The address is still not a shared gathering.
  }
  return new Response(request.method === "HEAD" ? null : miss, { status: 404, headers });
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** Last path segment contains a file extension, as in `icon-180.png`. */
function hasFileExtension(pathname: string): boolean {
  const segment = pathname.split("/").pop() ?? "";
  const dot = segment.lastIndexOf(".");
  return dot > 0 && dot < segment.length - 1;
}

function apiUnavailable(request: Request): Response {
  console.log(
    JSON.stringify({
      event: "api-unavailable",
      method: request.method,
      path: new URL(request.url).pathname,
    }),
  );
  return Response.json(
    { error: "api-unavailable" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
