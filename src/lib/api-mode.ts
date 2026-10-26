/**
 * Live API versus the browser demo.
 *
 * `VITE_DEMO=1` is the demo, and it does not call the API.
 * An empty `VITE_API_BASE_URL` is same-origin `/api`, not the demo.
 * A set base is that origin. Either way, a failed probe, an HTML body, or
 * any response other than `{ ok: true }` falls back to the demo. The static
 * Worker answers `/api/*` with a JSON 503, which lands here as demo mode.
 */

export type ApiMode = "demo" | "live";

/** `1`, `true`, or `yes`. Anything else, including empty, is not the demo flag. */
export function isDemoFlag(value: string | undefined | null): boolean {
  const flag = (value ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function readPublic(name: string): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const fromVite = env?.[name];
  if (typeof fromVite === "string") return fromVite;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name] ?? "";
}

/** True when this build was asked to stay in the browser. */
export function readDemoFlag(): boolean {
  return isDemoFlag(readPublic("VITE_DEMO"));
}

export async function probeApiMode(
  base: string,
  fetchImpl: typeof fetch,
  timeoutMs = 2500,
  demo = false,
): Promise<ApiMode> {
  if (demo) return "demo";
  const trimmed = base.trim().replace(/\/+$/, "");
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
