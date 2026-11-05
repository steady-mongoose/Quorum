import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rootMeta } from "./route-heads.ts";

const meta = (key: string) =>
  rootMeta().find((m) => ("property" in m && m.property === key) || ("name" in m && m.name === key));
const content = (key: string) => (meta(key) as { content: string } | undefined)?.content;

test("a shared link shows one large picture, as a 1200×630 JPEG at a full address", () => {
  assert.equal(content("og:image"), "https://avouchsocial.com/art/share-avouch.jpg");
  assert.equal(content("og:image:width"), "1200");
  assert.equal(content("og:image:height"), "630");
  assert.equal(content("og:image:type"), "image/jpeg");
  assert.ok(content("og:image:alt"));
  assert.equal(content("twitter:card"), "summary_large_image");
  assert.equal(content("twitter:image"), content("og:image"));
  const file = readFileSync(new URL("../../../public/art/share-avouch.jpg", import.meta.url));
  assert.equal(file[0], 0xff);
  assert.equal(file[1], 0xd8);
  assert.ok(file.length < 300 * 1024, `${file.length} B`);
});
