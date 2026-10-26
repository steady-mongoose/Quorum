/**
 * The site's CSP allows scripts only from this origin (script-src 'self').
 * The prerendered shell carries inline boot scripts from TanStack Start, which
 * that policy blocks, leaving a blank page. This moves each inline script into
 * a content-hashed file under /assets, loaded by a classic <script src> in the
 * same place, so execution order and document.currentScript still hold.
 */
import { createHash } from "node:crypto";

const INLINE = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;

export function externalizeInlineScripts(html) {
  const files = [];
  const out = html.replace(INLINE, (whole, attrs = "", body) => {
    if (/\ssrc\s*=/i.test(attrs)) return whole;
    if (/\stype\s*=\s*["']?(application\/(ld\+)?json|importmap)/i.test(attrs)) return whole;
    if (body.trim() === "") return whole;
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    const name = `assets/boot-${hash}.js`;
    files.push({ name, body });
    return `<script${attrs} src="/${name}"></script>`;
  });
  return { html: out, files };
}

/** Inline scripts that would still run (and be blocked by script-src 'self'). */
export function inlineScripts(html) {
  return [...html.matchAll(INLINE)]
    .filter(([, attrs = ""]) => !/\ssrc\s*=/i.test(attrs))
    .filter(
      ([, attrs = ""]) => !/\stype\s*=\s*["']?(application\/(ld\+)?json|importmap)/i.test(attrs),
    )
    .filter(([, , body]) => body.trim() !== "")
    .map(([, , body]) => body);
}
