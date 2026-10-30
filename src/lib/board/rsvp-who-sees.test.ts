import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Who sees RSVPs (Josh, Oct 29, 9:04 PM ET; replaces #91's admin-only rule):
 * admins see everything, a host sees their own gatherings, a steward sees who
 * is going in the rooms they steward, and a member sees only their own
 * "You're going". Only the host or an admin marks who came.
 */

const read = (name: string) => readFileSync(new URL(`../../components/board/${name}`, import.meta.url), "utf8");

test("every going or has-been list is behind seesGoing, seesCame or takesRoll", () => {
  for (const name of ["week-view.tsx", "find-view.tsx", "room-view.tsx"]) {
    const lines = read(name).split("\n");
    lines.forEach((line, i) => {
      if (/going\.(length|join|map)|wentBy\.join|roll\.(length|map)/.test(line)) {
        const near = lines.slice(Math.max(0, i - 4), i + 1).join(" ");
        assert.match(near, /seesGoing\(|seesCame\(|takesRoll\(/, `${name}: ${line.trim()}`);
      }
    });
    // The old admin-only gate is gone from the lists.
    assert.doesNotMatch(read(name), /admin && (card|closing)\.going/, name);
  }
  // Who came: the host, admins and the room's stewards read it (Josh, 9:24 PM ET).
  assert.match(read("find-view.tsx"), /seesCame\(card\) \? <span>· has been:/);
  // Marking it (the "I went" button and the roll-call pills) stays host or admin only.
  assert.match(read("find-view.tsx"), /takesRoll\(card\) && rollOn && roll\.length > 0/);
  assert.match(read("room-view.tsx"), /closing && takesRoll\(closing\) && roll\.length > 0/);
});

test("members keep their own RSVP, and the 'I went' control is only for the host or an admin", () => {
  assert.match(read("week-view.tsx"), /const going = card\.going\.includes\(me\)/);
  const find = read("find-view.tsx");
  assert.match(find, /const going = card\.going\.includes\(rest\.me\)/);
  assert.match(read("rsvp-control.tsx"), /You’re going/);
  assert.match(find, /\{takesRoll\(card\) \? \(\s*<button[^>]*onClick=\{\(\) => visited\(card\.id\)\}/);
  // The Find intro no longer tells members to press "I went".
  assert.doesNotMatch(find, /<strong className="font-semibold text-fg">I went<\/strong>/);
});

test("about copy says who sees the list", () => {
  const source = read("about-view.tsx");
  assert.doesNotMatch(source, /who is going/);
  assert.match(
    source,
    /Who\\'s coming stays private\. The host sees who is coming to their own gathering, a room\\'s stewards see who is coming and who came in that room, and admins see every list\. Only the host or an admin records who came\./,
  );
});

test("about members copy: who is going and who came stay with the host, stewards and admins", () => {
  const source = read("about-view.tsx");
  assert.doesNotMatch(source, /stays with the admins/);
  assert.doesNotMatch(source, /members can see which gatherings each person came to/);
  assert.match(
    source,
    /The list is in name order, and nobody is ranked\. Who is going and who came stay with the host, the room's stewards, and the admins\./,
  );
});

test("door roll call copy: only host, stewards and admins see who came", () => {
  assert.match(
    read("door.tsx"),
    /In a room that takes roll, the host records who came\. Only the host, the room's stewards, and the admins see it\. You see your own\./,
  );
});

test("a write-up shows a plain member only their own attendance, matched by the server on id", () => {
  // Admin, or a steward of the room (tools on or off), or the host: every name.
  assert.equal(cameText(["Ann", "Ben"], false, true), "There: Ann, Ben. ");
  assert.equal(cameText(["Ann", "Ben"], true, true), "There: Ann, Ben. ");
  // A plain member gets no names, only the server's youCame.
  assert.equal(cameText([], true, false), "You were there. ");
  assert.equal(cameText([], false, false), "");
  // A name in the list is ignored for a member who is not told they came.
  assert.equal(cameText(["Ann"], false, false), "");
  assert.equal(cameText([], false, true), "");
});

test("who came on a write-up follows admin or steward of the room, not steward tools", () => {
  const room = read("room-view.tsx");
  assert.match(room, /seesWhoCame=\{viewerAdmin \|\| viewerRooms\.includes\(room\)\}/);
  assert.match(room, /cameText\(post\.came, post\.youCame === true, mine \|\| seesWhoCame\)/);
  assert.doesNotMatch(room, /cameText\([^)]*steward\)/);
  // Tools still gate only the moderation buttons.
  assert.match(room, /steward=\{steward && tools\}/);
});

test("Find close form: hint, not placeholder; wrapping buttons; focus back to Write it up", () => {
  const find = read("find-view.tsx");
  assert.doesNotMatch(find, /placeholder="One line is enough"/);
  assert.match(find, /aria-describedby=\{lineHintId\}/);
  assert.match(find, /One line is enough\./);
  assert.match(find, /flex flex-wrap items-end gap-2/);
  assert.match(find, /flex basis-full flex-col gap-2 text-sm text-muted">\s*Next date/);
  assert.equal((find.match(/whitespace-nowrap/g) ?? []).length >= 3, true);
  assert.match(find, /ref=\{writeUp\}/);
  assert.match(find, /setClosing\(false\);\s*setRefocus\(true\);/);
});

test("door copy: you see your own answer; host, stewards and admins see who is going", () => {
  const source = read("door.tsx");
  assert.doesNotMatch(source, /Only the room's admins see the full list/);
  assert.match(
    source,
    /Say you're going to a gathering\. You see only your own answer\. The host, the room's stewards, and the admins see who is going\./,
  );
});

test("Find clears refused at each close submit so a repeat failure is announced again", () => {
  const source = read("find-view.tsx");
  assert.match(source, /event\.preventDefault\(\);\s*(\/\/[^\n]*\n\s*)?setRefused\(\[\]\);\s*const happened =/);
});

import { cameText, forViewer } from "./model.ts";
import { SEED_CARDS } from "./seed-cards.ts";

test("a plain member's board data carries no other names", () => {
  const cards = [
    ...SEED_CARDS,
    { ...SEED_CARDS[0]!, id: "x", host: "Dale", going: ["Ann", "Me", "Tom"], wentBy: ["Tom", "Me"] },
  ];
  for (const card of cards.map((c) => forViewer(c, { admin: false, name: "Me" }))) {
    for (const name of [...card.going, ...card.wentBy]) assert.equal(name, "Me", card.id);
  }
  const mine = forViewer(cards.at(-1)!, { admin: false, name: "Me" });
  assert.deepEqual(mine.going, ["Me"]);
  assert.deepEqual(mine.wentBy, ["Me"]);
  const admin = forViewer(cards.at(-1)!, { admin: true, name: "Me" });
  assert.deepEqual(admin.going, ["Ann", "Me", "Tom"]);
});

test("the views read cards through forViewer with the host and steward scope", () => {
  for (const name of ["week-view.tsx", "find-view.tsx", "room-view.tsx"]) {
    const source = read(name);
    assert.doesNotMatch(source, /const cards = useBoard\(\(state\) => state\.cards\)/, name);
    assert.match(
      source,
      /forViewer\(card, \{\s*admin: viewerAdmin,\s*name: viewerName,\s*hosts: viewerHosts,\s*byId: viewerById,\s*stewardRooms: viewerRooms,\s*\}\)/,
      name,
    );
  }
  assert.match(read("room-view.tsx"), /"Say how it went, and set the next date\."/);
});

test("RSVPs are filtered on the server in SQL by role, and forViewer stays as a second layer", () => {
  const server = readFileSync(new URL("../../../server/board/rsvp.ts", import.meta.url), "utf8");
  assert.match(server, /or g\.host_user_id = \$3/);
  // A steward reads every row (going and came) in the rooms they steward.
  assert.match(server, /or \(g\.room_id <> '' and g\.room_id = any \(\$4::text\[\]\)\)/);
  // Only these four may read anyone else's row: admin, own, host, steward.
  assert.match(server, /\$2::boolean\s+or r\.user_id = \$3\s+or g\.host_user_id = \$3\s+or \(g\.room_id/);
  assert.match(server, /seesPeople\(reader, gate\.gathering\) \? \{ people: withHandles\(rows, reader\) \} : \{\}/);
  assert.match(server, /if \(!host && !gate\.actor\.admin\) \{\s*return json\(403, \{ error: MARK_REFUSED \}\);/);
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(store, /await syncRsvps\(/);
  assert.doesNotMatch(store, /TODO\(rsvp-server\)/);
});

test("the RSVP button is aria-busy while saving, says when it failed, and only animates after a tap", () => {
  const control = read("rsvp-control.tsx");
  assert.match(control, /aria-disabled=\{pending \|\| undefined\}/);
  assert.match(control, /aria-busy=\{pending \|\| undefined\}/);
  assert.doesNotMatch(control, /\sdisabled=\{/);
  assert.match(control, /if \(pending\) return;/);
  assert.match(control, /data-tapped=\{tapped \? "" : undefined\}/);
  // One message, the full sentence, only in the line under the button.
  assert.match(control, /role="status">\s*\{failed && !pending \? RSVP_NOT_SAVED : ""\}/);
  // data-tapped is dropped after the draw, so a later server change does not animate.
  assert.match(control, /setTimeout\(\(\) => setTapped\(false\), RSVP_DRAW_MS\)/);
  const css = readFileSync(new URL("../../../public/backgrounds.css", import.meta.url), "utf8");
  // Pending keeps the label at 4.5:1 or better (.5 gave 4.38:1).
  assert.match(css, /\.btn-rsvp\[aria-disabled="true"\]\{opacity:\.75;cursor:wait\}/);
  assert.match(css, /\.btn-rsvp\[data-tapped\] \+ \.rsvp-mark \.rule\{transition:/);
  assert.match(css, /\.btn-rsvp\[data-tapped\] \+ \.rsvp-mark \.laurel\{transition:/);
  assert.doesNotMatch(css, /^\.rsvp-mark \.(rule|laurel)\{[^}]*transition/m);
  // The sheet-wide reduced-motion rule (every transition at 0s) covers the mark;
  // a rule of its own would push the sheet past its 3 KB budget.
  assert.match(css, /prefers-reduced-motion:reduce\)\{[^@]*\*,\*::before,\*::after\{animation:none!important;transition-duration:0s!important\}/);
});

test("Find's close form: a stale roll call resets the picks and offers Reload; focus survives a card leaving (#126)", () => {
  const src = read("find-view.tsx");
  assert.match(src, /check\.stops\.includes\(ROLL_CALL_STALE\)\) resetPicks\(\)/);
  assert.match(src, /stop === ROLL_CALL_STALE \?[\s\S]{0,400}reloadRsvps\(\)\.then\(\(\) => \{\s*resetPicks\(\);/);
  assert.match(src, />\s*Reload\s*</);
  assert.match(src, /id=\{FIND_LIST_HEADING\}\s*tabIndex=\{-1\}\s*className="focus-target /);
  assert.match(src, /document\.getElementById\(FIND_LIST_HEADING\)\?\.focus\(\)/);
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.focus-target:focus \{\s*outline: 2px solid #f0e7d3;/);
});

test("the roll call option copy (Design #126)", async () => {
  const { ROOM_OPTION_WHAT } = await import("./room-options.ts");
  assert.equal(
    ROOM_OPTION_WHAT.roll_call,
    "After a gathering, the host records who came. The host, the room's stewards, and the admins see it. You see your own.",
  );
});
