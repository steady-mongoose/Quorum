import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { externalizeInlineScripts, inlineScripts } from "./externalize-inline-scripts.mjs";

test("inline scripts move to files in order; src and json scripts stay", () => {
  const input =
    '<script data-tsr-stream-part="">a=1</script><script type="module" src="/x.js"></script><script type="application/json">{}</script><script>document.currentScript.remove();</script>';
  const { html, files } = externalizeInlineScripts(input);
  assert.equal(files.length, 2);
  assert.equal(files[0].body, "a=1");
  assert.ok(html.indexOf(files[0].name) < html.indexOf("/x.js"));
  assert.match(
    html,
    /<script data-tsr-stream-part="" src="\/assets\/boot-[0-9a-f]{16}\.js"><\/script>/,
  );
  assert.deepEqual(inlineScripts(html), []);
});

const built = "dist/frontend/client/index.html";
test("built shell has no inline scripts the CSP would block", { skip: !existsSync(built) }, () => {
  assert.deepEqual(inlineScripts(readFileSync(built, "utf8")), []);
});
