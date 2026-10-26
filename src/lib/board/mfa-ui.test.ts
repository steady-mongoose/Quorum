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
  const css = source("../../styles.css");
  assert.match(ui, /min-h-\[44px\]/);
  assert.match(ui, /w-full sm:w-auto/);
  assert.match(ui, /md:max-w-xl xl:max-w-3xl/);
  assert.match(ui, /fill-parchment/);
  assert.match(ui, /fill-ink/);
  assert.match(ui, /Save these 10 recovery codes now/);
  assert.match(ui, /I've saved these codes/);
  assert.match(ui, /Copy codes/);
  assert.match(ui, /Download \.txt/);
  assert.match(ui, /avouch-recovery-codes\.txt/);
  assert.match(ui, /Copy key/);
  assert.match(ui, /Can't scan\? Enter this key in your app:/);
  assert.match(ui, /secret\.match\(\/\.\{1,4\}\/g\)/);
  assert.match(ui, /Waiting on 1 more admin/);
  assert.match(ui, /Waiting on 2 admins/);
  assert.match(ui, /approverName/);
  assert.match(ui, /No resets are waiting/);
  assert.match(ui, /Member's account ID/);
  assert.match(ui, /Find it on the member's profile/);
  assert.match(ui, /Adds a six-digit code from an app on your phone/);
  assert.match(ui, /maxLength=\{recovery \? undefined : 6\}/);
  assert.match(ui, /requestSubmit\(\)/);
  assert.match(ui, /aria-describedby=\{error \? errorId : undefined\}/);
  assert.match(ui, /inputMode="numeric"/);
  assert.match(ui, /autoComplete="one-time-code"/);
  const turnOff = ui.slice(ui.indexOf("Code to turn it off"), ui.indexOf("Turn off authenticator"));
  assert.match(turnOff, /inputMode="numeric"/);
  assert.match(turnOff, /autoComplete="one-time-code"/);
  assert.match(ui, /Two different admins/);
  assert.match(css, /--font-mono:\s*ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;/);
  assert.match(door, /MfaChallenge/);
  assert.match(profile, /MfaSettings/);
  assert.match(about, /MfaResetQueue/);
  assert.match(about, /data-export/);
  assert.match(app, /server\.mfa === "enroll"/);
});
