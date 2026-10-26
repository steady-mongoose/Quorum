import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("the signed-out header sits in the centred 72rem column", () => {
  const app = source("../../components/board/app.tsx");
  const css = source("../../../public/fluid.css");
  const emblem = source("../../components/board/emblem.tsx");

  assert.match(css, /--content-max:72rem/);
  assert.match(
    css,
    /\.mast-bar\{[^}]*grid-template-columns:minmax\(0,1fr\) min\(var\(--content-max\),100%\) minmax\(0,1fr\)/,
  );
  assert.match(
    css,
    /\.shell-body\{[^}]*grid-template-columns:minmax\(0,1fr\) min\(var\(--content-max\),100%\) minmax\(0,1fr\)/,
  );
  assert.match(css, /\.mast\{[^}]*display:flex/);
  assert.match(css, /\.mast\{[^}]*justify-content:space-between/);
  assert.match(css, /\.mast\{[^}]*align-items:center/);
  assert.match(css, /\.mast\{[^}]*padding:clamp\(16px,2vw,28px\)/);
  assert.match(
    css,
    /\.shell-body > main\{[^}]*padding-inline:max\(clamp\(16px,2vw,28px\),env\(safe-area-inset-left\)\)/,
  );
  assert.match(css, /\.mast-bar\{[^}]*border-bottom:1px solid #c9a45c/);
  assert.match(css, /\.mast-tagline\{[^}]*font-size:0\.95rem/);
  assert.match(css, /\.mast-tagline\{[^}]*color:#bcae94/);
  assert.match(css, /\.mast-door\{[^}]*color:#f0e7d3/);
  assert.match(css, /\.mast-door\{[^}]*min-height:44px/);
  assert.match(css, /\.mast-flag\{[^}]*height:28px/);

  assert.match(app, /<header className="top mast-bar">/);
  assert.match(app, /className="mast"/);
  assert.match(app, /<AppealMark \/>/);
  assert.match(app, /className="mast-name">\{APP_NAME\}/);
  assert.match(app, /className="mast-tagline">\{TAGLINE\}/);
  assert.match(app, /href=\{signingIn \? "#sign-in" : "#open-the-door"\}/);
  assert.match(app, /\{signingIn \? "Sign in" : "Open the door"\}/);
  assert.equal(app.includes('size="header"'), false);
  assert.equal(app.includes("bg-[#f7f4ec]"), false);

  assert.match(emblem, /src="\/flags\/appeal-to-heaven-gold\.svg"/);
  assert.match(emblem, /alt="An Appeal to Heaven flag"/);
  assert.match(emblem, /className="mast-flag"/);
});

test("the gold flag is one colour and has no white field", () => {
  const gold = source("../../../public/flags/appeal-to-heaven-gold.svg");
  assert.match(gold, /#c9a45c/);
  assert.equal(gold.includes("#ffffff"), false);
  assert.equal(gold.includes("#f7f4ec"), false);
  assert.equal(gold.includes("#3b9442"), false);
  assert.equal(/<script/i.test(gold), false);
  assert.equal(/\son[a-z]+=/i.test(gold), false);
});

test("the door column starts with the invite line", () => {
  const door = source("../../components/board/door.tsx");
  const account = source("../../components/board/account-door.tsx");
  const css = source("../../../public/fluid.css");
  assert.match(door, /lg:items-start/);
  assert.equal(door.includes("lg:items-center"), false);
  assert.equal(door.includes("lg:min-h-[70vh]"), false);
  const formAt = door.indexOf('id="open-the-door"');
  const noteAt = door.indexOf("door-demo");
  const headingAt = door.indexOf(">Open the door</h2>");
  assert.ok(formAt > 0 && noteAt > formAt && headingAt > noteAt);
  assert.match(door, /id="open-the-door"/);
  assert.match(door, /className="door-hero/);
  assert.match(door, /lg:order-last/);
  assert.match(account, /id="sign-in"/);
  assert.match(css, /\.door-columns\{align-items:start\}/);
  assert.match(css, /#open-the-door,#sign-in\{scroll-margin-top:6rem\}/);
});
