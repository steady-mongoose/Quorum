import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const profile = readFileSync("src/components/board/profile-view.tsx", "utf8");
const removal = readFileSync("src/components/board/account-removal.tsx", "utf8");
const mfa = readFileSync("src/components/board/mfa-ui.tsx", "utf8");

test("Authenticator comes after the profile content and Account is last, set apart on its own card", () => {
  const met = profile.indexOf("People you've met here");
  const auth = profile.indexOf("<MfaSettings />");
  const account = profile.indexOf("<AccountRemoval");
  assert.ok(met > 0 && auth > met, "Authenticator sits below People you've met here");
  assert.ok(account > auth, "Account comes after Authenticator");
  assert.equal(profile.split("<AccountRemoval").length, 2, "Account is rendered once");
  // Its own card over the plate (Design r131 R5), where it used to be a divider.
  assert.match(profile.slice(auth, account), /className="card pc-card p-4 sm:p-5"/);
});

test("Account controls use aria-disabled, not disabled, and no red outside the confirm", () => {
  const member = removal.slice(0, removal.indexOf("Account deletion requests"));
  assert.equal(/\sdisabled=\{/.test(member), false);
  assert.match(member, /aria-disabled=/);
  assert.equal(/btnDanger|bg-danger|border-danger/.test(member), false);
});

test("the Authenticator heading matches the other profile headings", () => {
  assert.equal(/font-display text-2xl text-fg">Authenticator/.test(mfa), false);
});
