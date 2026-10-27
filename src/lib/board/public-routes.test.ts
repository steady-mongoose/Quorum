import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const about = source("../../routes/about.tsx");
const privacy = source("../../routes/privacy.tsx");
const terms = source("../../routes/terms.tsx");
const notice = source("../../components/board/legal-notice.tsx");
const footer = source("../../components/board/legal-footer.tsx");
const door = source("../../components/board/door.tsx");
const missing = source("../../components/not-found.tsx");
const account = source("../../components/board/account-door.tsx");
const app = source("../../components/board/app.tsx");

test("about, privacy, and terms are public routes, outside the signed-in gate", () => {
  assert.match(about, /createFileRoute\("\/about"\)/);
  assert.match(privacy, /createFileRoute\("\/privacy"\)/);
  assert.match(terms, /createFileRoute\("\/terms"\)/);
  assert.match(about, /<AboutView publicView \/>/);
  assert.match(privacy, /<LegalNotice title="Privacy" \/>/);
  assert.match(terms, /<LegalNotice title="Terms" \/>/);
  for (const file of [about, privacy, terms]) {
    assert.equal(file.includes("entered"), false);
    assert.equal(file.includes("RedirectToSignIn"), false);
    assert.equal(file.includes("SignedIn"), false);
  }
  assert.match(app, /\{entered && shown === "about" && <AboutView \/>\}/);
});

test("privacy and terms say the notice is not published yet", () => {
  assert.equal(notice.includes("Placeholder"), false);
  assert.equal(notice.includes("uppercase"), false);
  assert.match(
    notice,
    /We are finishing this notice\. It will be posted here before anyone is asked to agree to it\./,
  );
  assert.match(notice, /Last updated: not yet published\./);
  assert.match(notice, /text-sm text-muted/);
  const drafted = /we collect|personal data|liability|governing law|cookies|gdpr|arbitration/i;
  assert.equal(drafted.test(notice), false);
  assert.equal(drafted.test(privacy), false);
  assert.equal(drafted.test(terms), false);
});

test("the door and the missing page link to about, privacy, and terms", () => {
  assert.match(footer, /inline-flex min-h-\[44px\] items-center/);
  assert.match(footer, /href="\/about"/);
  assert.match(footer, /href="\/privacy"/);
  assert.match(footer, /href="\/terms"/);
  assert.equal(footer.match(/className=\{LINK\}/g)?.length, 3);
  assert.match(door, /<LegalFooter \/>/);
  assert.match(missing, /<LegalFooter \/>/);
});

test("the door intro comes before the form and keeps the desktop order", () => {
  const pitchAt = door.indexOf("Welcome to {APP_NAME}");
  const sideAt = door.indexOf('className="door-side ');
  assert.ok(pitchAt > 0 && sideAt > pitchAt);
  assert.match(door, /lg:order-last/);
  assert.doesNotMatch(door, /<Kicker>/);
  assert.equal((door.match(/invite-only/g) ?? []).length <= 1, true);
  assert.match(door, /A member who knows you gives you\s+an invite code\./);
  assert.match(door, /Already a member\? Sign in below\.<\/p>\s*<AccountDoor/);
  assert.match(door, /Enter your name and that code to\s+come in\./);
  assert.match(door, /text-base text-fg/);
});

test("the account form announces an empty or wrong sign-in above the button", () => {
  assert.match(account, /Enter your email and password\./);
  assert.match(account, /That email and password don't match an account\./);
  assert.match(account, /Enter the code your host gave you\./);
  assert.match(account, /className="text-base text-muted"/);
  assert.equal(account.includes("sm:text-sm"), false);
  assert.match(account, /text-base text-fg/);
  assert.equal(account.includes("There is no open sign-up"), false);
  assert.match(
    account,
    /TODO: Restore the agreement line when the real Terms and Privacy text ships\./,
  );
  assert.equal(/<a\s[^>]*href="\/terms"/.test(account), false);
  assert.equal(/<a\s[^>]*href="\/privacy"/.test(account), false);
  assert.match(account, /required/);
  assert.match(account, /aria-invalid=/);
  assert.match(account, /setEmailInvalid\(false\)/);
  assert.match(account, /setPasswordInvalid\(false\)/);
  assert.match(account, /focusFirst\(/);
  const submitAt = account.indexOf('type="submit"');
  const alertAt = account.lastIndexOf('role="alert"', submitAt);
  assert.ok(alertAt > 0 && alertAt < submitAt);
});
