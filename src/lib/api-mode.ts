/**
 * Live API versus the browser demo.
 *
 * An empty base, a failed request, an HTML body, or any response other than
 * `{ ok: true }` keeps the demo. The static Worker answers `/api/*` with a
 * JSON 503, which lands here as demo mode.
 */

export type ApiMode = "demo" | "live";

export async function probeApiMode(
  base: string,
  fetchImpl: typeof fetch,
  timeoutMs = 2500,
): Promise<ApiMode> {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed) return "demo";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${trimmed}/api/health`, {
      signal: controller.signal,
      credentials: "omit",
    });
    if (!response.ok) return "demo";
    const type = response.headers.get("content-type") ?? "";
    if (/text\/html/i.test(type)) return "demo";
    const body = (await response.json()) as { ok?: unknown };
    return body?.ok === true ? "live" : "demo";
  } catch {
    return "demo";
  } finally {
    clearTimeout(timer);
  }
}
