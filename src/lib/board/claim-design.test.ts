import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const queue = source("../../components/board/claims-queue.tsx");
const room = source("../../components/board/room-view.tsx");

test("claim decisions ask first, and turning one down uses the danger style", () => {
  assert.match(queue, /ConfirmDialog/);
  assert.match(queue, /tone="danger"/);
  assert.match(queue, /Turn down this claim\?/);
  assert.match(queue, /won't host/);
  assert.match(queue, /They can ask again/);
  assert.match(queue, /confirmLabel="Turn down"/);
  assert.match(queue, /cancelLabel="Not now"/);
  assert.match(queue, /Make host/);
  assert.match(queue, /tone="neutral"/);
  assert.match(queue, /border-danger\/60 text-danger/);
  assert.match(queue, /btnSignal/);
  assert.equal(queue.includes(">Reject<"), false);
  assert.equal(queue.includes("found: true"), false);
});

test("claim copy names the code, the email, and the member steps", () => {
  assert.match(queue, /role="status"/);
  assert.match(queue, /aria-live="polite"/);
  assert.match(queue, /now hosts/);
  assert.match(queue, /Claim turned down/);
  assert.match(queue, /Code found\. You can approve it now\./);
  assert.match(queue, /Code to look for:/);
  assert.match(queue, /Email given:/);
  assert.match(queue, /Open their site/);
  assert.match(queue, /Step 1 of 2: which listing\?/);
  assert.match(queue, /Step 2 of 2: add this code to your website/);
  assert.match(queue, /\n\s+Copy\n/);
  assert.match(queue, /Hosting a church or group that's already listed\?/);
  assert.match(queue, /role="alert"/);
  assert.match(queue, /className="plate flex flex-col gap-4"/);
  assert.equal(queue.includes("plate-flat"), false);
  assert.equal(source("../../../public/fluid.css").includes(".plate .plate"), false);
  assert.equal(source("../../../public/fluid.css").includes("plate-flat"), false);
  assert.match(queue, /justify-self-start/);
  assert.match(queue, /Claims to review/);
  assert.match(queue, /Nothing to review\. New claims will show up here\./);
  assert.match(queue, /Now hosted/);
  assert.match(queue, /Turned down/);
  assert.match(queue, /Lapsed/);
  assert.match(queue, /Code found on their site/);
  assert.match(queue, /I found the code/);
  assert.match(queue, /flex-col gap-2 sm:flex-row/);
  assert.match(room, /Only stewards can\s+see this listing until a host claims it\./);
});
