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
  const turnOff = ui.slice(ui.indexOf("Six-digit code or a recovery code"), ui.indexOf("Turn off authenticator"));
  assert.match(turnOff, /inputMode="text"/);
  assert.match(turnOff, /autoComplete="one-time-code"/);
  assert.doesNotMatch(turnOff, /autoCapitalize/);
  assert.match(ui, /Two different admins/);
  assert.match(css, /--font-mono:\s*ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;/);
  assert.match(door, /MfaChallenge/);
  assert.match(profile, /MfaSettings/);
  assert.match(about, /MfaResetQueue/);
  assert.match(about, /data-export/);
  assert.match(app, /server\.mfa === "enroll"/);
});

test("authenticator code fields take six digits and the start button hides while codes show", async () => {
  const { readFileSync } = await import("node:fs");
  const ui = readFileSync(new URL("../../components/board/mfa-ui.tsx", import.meta.url), "utf8");
  assert.equal(ui.split('maxLength={6}\n').length - 1 >= 2, true);
  assert.equal(ui.split('pattern="[0-9]*"\n').length - 1 >= 2, true);
  assert.match(ui, /!status\?\.enrolled && !modules && !recovery \?/);
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  assert.match(app, /before you moderate, grant a role, approve a reset, or export/);
});

test("the disable field accepts a recovery code as well as a six-digit code", () => {
  const ui = source("../../components/board/mfa-ui.tsx");
  assert.match(ui, /Six-digit code or a recovery code/);
  assert.match(ui, /setCode\(disableCodeInput\(event\.target\.value\)\)/);
  const filter = /return raw\.replace\((\/.*\/g), ""\)\.slice\(0, 16\)/.exec(ui);
  assert.ok(filter);
  const keep = (raw: string) => raw.replace(/[^A-Za-z0-9 -]/g, "").slice(0, 16);
  assert.equal(filter[1], "/[^A-Za-z0-9 -]/g");
  assert.equal(keep("abcde-fgh23"), "abcde-fgh23");
  assert.equal(keep("123456"), "123456");
});
