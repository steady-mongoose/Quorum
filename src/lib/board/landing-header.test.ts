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
  assert.match(css, /\.mast-flag\{[^}]*height:clamp\(36px,4\.5vw,56px\)/);
  assert.match(css, /\.mast-flag\{[^}]*width:auto/);
  assert.match(css, /\.mast-bar\{[^}]*container-name:mast/);
  assert.match(css, /\.mast-bar\{[^}]*container-type:inline-size/);
  assert.match(css, /@container mast \(max-width:420px\)\{[^}]*\.mast-tagline\{[^}]*font-size:\.85rem/);
  assert.match(css, /@container mast \(max-width:420px\)\{[^}]*\.mast-tagline\{[^}]*display:-webkit-box/);
  assert.match(css, /@container mast \(max-width:420px\)\{[^}]*\.mast-tagline\{[^}]*-webkit-line-clamp:2/);
  assert.match(css, /@container mast \(max-width:420px\)\{[^}]*\.mast-tagline\{[^}]*-webkit-box-orient:vertical/);
  assert.match(css, /@container mast \(max-width:420px\)\{[^}]*\.mast-tagline\{[^}]*overflow:hidden/);
  const narrow = css.slice(css.indexOf("@container mast (max-width:420px)"));
  assert.equal(narrow.slice(0, narrow.indexOf("\n}")).includes("text-overflow"), false);
  assert.equal(narrow.slice(0, narrow.indexOf("\n}")).includes("white-space"), false);

  assert.match(app, /<header className="top mast-bar">/);
  assert.match(app, /className="mast"/);
  assert.match(app, /<AppealMark \/>/);
  assert.match(app, /className="mast-name">\{APP_NAME\}/);
  assert.match(app, /className="mast-tagline">\{TAGLINE\}/);
  assert.match(app, /const apiDown = server\.configured && server\.mode === "demo"/);
  assert.match(app, /const signingIn = !entered && \(server\.mode === "live" \|\| apiDown\)/);
  assert.match(app, /href=\{signingIn \? "#sign-in" : "#open-the-door"\}/);
  assert.match(app, /\{signingIn \? "Sign in" : "Open the door"\}/);
  assert.match(app, /onClick=\{focusDoorField\}/);
  assert.match(app, /querySelector<HTMLElement>\("input, textarea, select, button"\)/);
  assert.match(app, /field\?\.focus\(\)/);
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
  assert.equal(/clipPath|clip-path/i.test(gold), false);
  assert.equal(/q[-+]?\d/.test(gold), false, "motto lettering is not drawn");
  const viewBox = gold.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/);
  assert.ok(viewBox);
  const drawnWidth = Number(viewBox[3]);
  const drawnHeight = Number(viewBox[4]);
  assert.ok(drawnWidth < 300 && drawnHeight < 420 && drawnHeight > drawnWidth);
});

test("a down API keeps Sign in and offers another check", () => {
  const app = source("../../components/board/app.tsx");
  const door = source("../../components/board/door.tsx");
  const session = source("../server-session.tsx");
  const gates = source("../auth/gates.tsx");
  assert.match(door, /Sign-in is unavailable right now/);
  assert.match(door, /Try again/);
  assert.match(door, /server\.recheck\(\)/);
  assert.match(door, /server\.configured && server\.mode === "demo"/);
  assert.match(door, /id="sign-in"/);
  assert.match(door, /Membership is\s+by invitation only/);
  assert.match(door, /There is no sign-up form and nothing to browse until\s+then/);
  assert.match(door, /Invite codes can't be checked right now\. Try again in a moment\./);
  assert.match(door, /apiDown \?/);
  assert.equal(door.includes("door-demo"), false);
  assert.equal(door.includes("This browser is in demo mode"), false);
  assert.match(door, /\{live \?/);
  assert.match(session, /const recheck = async \(\) => \{[\s\S]*probeApiMode\(/);
  assert.match(gates, /SIGN_IN_PATH = "\/#sign-in"/);
  assert.match(gates, /hash=\{hash\}/);
  assert.match(app, /apiDown/);
});

test("the door column starts with the invite line", () => {
  const door = source("../../components/board/door.tsx");
  const account = source("../../components/board/account-door.tsx");
  const css = source("../../../public/fluid.css");
  assert.match(door, /lg:items-start/);
  assert.equal(door.includes("lg:items-center"), false);
  assert.equal(door.includes("lg:min-h-[70vh]"), false);
  const formAt = door.indexOf('id="open-the-door"');
  const headingAt = door.indexOf(">Open the door</h2>");
  assert.ok(formAt > 0 && headingAt > formAt);
  assert.equal(door.includes("door-demo"), false);
  assert.match(door, /id="open-the-door"/);
  assert.match(door, /className="door-hero/);
  assert.match(door, /lg:order-last/);
  assert.match(account, /id="sign-in"/);
  assert.match(css, /\.door-columns\{align-items:start\}/);
  assert.match(css, /#open-the-door,#sign-in\{scroll-margin-top:6rem\}/);
});
