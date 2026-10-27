import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Public Sans is self-hosted and nothing loads from Google Fonts", () => {
  for (const file of ["PublicSans-latin.woff2", "PublicSans-italic-latin.woff2", "OFL-PublicSans.txt"]) {
    assert.ok(existsSync(new URL(`../../../public/fonts/${file}`, import.meta.url)), file);
  }
  const styles = read("../../styles.css");
  const gathering = read("../../../public/gathering.css");
  const root = read("../../routes/__root.tsx");
  const worker = read("../../../workers/frontend.ts");
  assert.match(styles, /font-family: "Public Sans";\s*src: url\("\/fonts\/PublicSans-latin\.woff2"\)/);
  assert.match(gathering, /src: url\("\/fonts\/PublicSans-latin\.woff2"\)/);
  assert.match(root, /href: "\/fonts\/PublicSans-latin\.woff2"/);
  for (const text of [styles, gathering, root, worker]) {
    assert.equal(text.includes("fonts.googleapis.com"), false);
    assert.equal(text.includes("fonts.gstatic.com"), false);
  }
  assert.match(worker, /"font-src 'self'"/);
  assert.match(worker, /"style-src 'self'"/);
});
