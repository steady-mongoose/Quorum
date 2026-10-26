#!/usr/bin/env node
/**
 * After `BUILD_TARGET=frontend` vite build: write the files the static host
 * needs that the Nitro middleware would otherwise generate at request time.
 *
 * The client bundle lands in dist/frontend/client (Vite outDir + TanStack's
 * client environment). Wrangler uploads that directory only.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { externalizeInlineScripts, inlineScripts } from "./externalize-inline-scripts.mjs";
import { join } from "node:path";

const clientDir = join(process.cwd(), "dist/frontend/client");

// Document title from APP_NAME in src/lib/board/model.ts. English only.
const manifest = {
  name: "Avouch Social",
  short_name: "Avouch Social",
  id: "/",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#000000",
  theme_color: "#0e0e0c",
  lang: "en",
  icons: [
    {
      src: "/__grok/icon-180.png",
      sizes: "180x180",
      type: "image/png",
      purpose: "any",
    },
  ],
};

const headers = `# Static frontend on Cloudflare Workers.
# The shell must revalidate so a new deploy is what visitors get.
# Hashed files under /assets can stay cached.
/index.html
  Cache-Control: public, max-age=0, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

async function main() {
  try {
    await access(join(clientDir, "index.html"));
  } catch {
    console.error(
      `[frontend] ${clientDir}/index.html is missing. The static build did not emit an SPA shell.`,
    );
    process.exit(1);
  }

  const shellPath = join(clientDir, "index.html");
  const { html, files } = externalizeInlineScripts(await readFile(shellPath, "utf8"));
  await mkdir(join(clientDir, "assets"), { recursive: true });
  for (const file of files) await writeFile(join(clientDir, file.name), file.body);
  if (inlineScripts(html).length > 0) {
    console.error("[frontend] index.html still has inline scripts the CSP would block.");
    process.exit(1);
  }
  await writeFile(shellPath, html);
  console.log(`[frontend] moved ${files.length} inline script(s) to /assets`);

  await mkdir(join(clientDir, "__grok"), { recursive: true });
  await writeFile(
    join(clientDir, "__grok", "manifest.webmanifest"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(join(clientDir, "_headers"), headers);
  console.log(`[frontend] static assets ready in ${clientDir}`);
}

await main();
