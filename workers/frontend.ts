/**
 * Edge gate for the Avouch Social static site.
 *
 * `/api/*` is not the SPA. The API is the dedicated box at api.avouchsocial.com.
 * This Worker keeps answering every method with a JSON 503 so a same-origin
 * call falls back to demo mode. Paths with a file extension are real files: a miss is a
 * 404, not index.html. Extensionless addresses get the shell so the client
 * router can show the page, including the styled not-found.
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) return withSecurity(apiUnavailable(request));
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
