/**
 * Edge gate for the Avouch Social static site.
 *
 * `/api/*` is not the SPA. The API is the dedicated box at api.avouchsocial.com.
 * This Worker keeps answering every method with a JSON 503 so a same-origin
 * call falls back to demo mode. Paths with a file extension are real files: a miss is a
 * 404, not index.html. Extensionless addresses get the shell so the client
 * router can show the page, including the styled not-found.
 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) return apiUnavailable(request);
    if (hasFileExtension(url.pathname)) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: {
          allow: "GET, HEAD",
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    const shell = new URL("/index.html", url);
    return env.ASSETS.fetch(new Request(shell, request));
  },
} satisfies ExportedHandler<Env>;

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
