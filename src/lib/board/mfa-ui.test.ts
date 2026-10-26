import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("authenticator screens use the plate, 44px targets, and no inline script", () => {
  const ui = source("../../components/board/mfa-ui.tsx");
  const door = source("../../components/board/account-door.tsx");
  const profile = source("../../components/board/profile-view.tsx");
  const about = source("../../components/board/about-view.tsx");
  const app = source("../../components/board/app.tsx");
  for (const file of [ui, door, profile, about, app]) {
    assert.equal(file.includes("<script"), false);
    assert.equal(file.includes("dangerouslySetInnerHTML"), false);
  }
  assert.match(ui, /min-h-\[44px\]/);
  assert.match(ui, /w-full sm:w-auto/);
  assert.match(ui, /md:max-w-xl xl:max-w-3xl/);
  assert.match(ui, /fill-parchment/);
  assert.match(ui, /fill-ink/);
  assert.match(ui, /Write these down/);
  assert.match(ui, /Two different admins/);
  assert.match(ui, /A passkey can be added later/);
  assert.match(door, /MfaChallenge/);
  assert.match(profile, /MfaSettings/);
  assert.match(about, /MfaResetQueue/);
  assert.match(about, /data-export/);
  assert.match(app, /server\.mfa === "enroll"/);
});
