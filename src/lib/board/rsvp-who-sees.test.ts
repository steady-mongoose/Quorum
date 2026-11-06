import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Who sees RSVPs (Josh, Oct 29, 9:04 PM ET; admins dropped Oct 30): a host
 * sees their own gatherings, a steward sees who is going and who came in the
 * rooms they steward, an admin as an admin gets counts only (the admin
 * summary), and a member sees only their own
 * "You're going". Only the host or the room's steward can mark who came.
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
  // Who came: the host and the room's stewards read it (Josh, 9:24 PM ET; admins dropped 7:55 AM Oct 30).
  assert.match(read("find-view.tsx"), /seesCame\(card\) \? <span>· has been:/);
  // Marking it (the roll-call pills) is the host or a steward, once it has started.
  assert.match(read("find-view.tsx"), /takesRoll\(card\) && rollOn && started && roll\.length > 0/);
  assert.match(read("room-view.tsx"), /closing && takesRoll\(closing\) && roll\.length > 0/);
});

test("members keep their own RSVP, and 'I went' is for members who can say going (not the host)", () => {
  assert.match(read("week-view.tsx"), /const going = card\.going\.includes\(me\)/);
  const find = read("find-view.tsx");
  assert.match(find, /const going = card\.going\.includes\(rest\.me\)/);
  assert.match(read("rsvp-control.tsx"), /You’re going/);
  // "I went" is aria-disabled with a guard until it has started and you're going (QA F4, Design).
  assert.match(find, /const showWent = takesRoll\(card\) && !isHost;[\s\S]*\{showWent \? \(\s*<button[\s\S]{0,400}?if \(!canSayWent\) return;\s*visited\(card\.id\);/);
  // The Find intro no longer tells members to press "I went".
  assert.doesNotMatch(find, /<strong className="font-semibold text-fg">I went<\/strong>/);
});

test("about copy says who sees the list", () => {
  const source = read("about-view.tsx");
  assert.doesNotMatch(source, /who is going/);
  assert.match(
    source,
    /Who\\'s coming stays private\. The host sees who is coming to their own gathering, and a room\\'s stewards see who is coming and who came in that room\. An admin who isn\\'t the host or a steward sees only totals, with small counts hidden\. Press "I\\'ll be there"/,
  );
});

test("about members copy: who is going and who came stay with the host and the stewards (Josh 7:55)", () => {
  const source = read("about-view.tsx");
  assert.doesNotMatch(source, /stays with the admins/);
  assert.doesNotMatch(source, /members can see which gatherings each person came to/);
  assert.match(
    source,
    /The list is in name order, and nobody is ranked\. Who is going and who came stay with the host and the room's stewards\./,
  );
});

test("door roll call copy: the host or a steward records who came, and only they see it", () => {
  assert.match(
    read("door.tsx"),
    /At a special event in a room that takes roll, the host or a steward records who came\. Only they see the list\. You see your own\./,
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

test("who came on a write-up follows the room's stewards (not admin, not steward tools)", () => {
  const room = read("room-view.tsx");
  assert.match(room, /seesWhoCame=\{roleCounts\(viewerAdmin\) && viewerRooms\.includes\(room\)\}/);
  const sight = readFileSync(new URL("../../../server/board/came-sight.ts", import.meta.url), "utf8");
  assert.match(sight, /viewer\.actor\.stewardRooms\.includes\(roomId\)/);
  assert.doesNotMatch(sight, /import[^;]*stewardsRoom|stewardsRoom\(viewer/);
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

test("door copy: you see your own answer; the host and stewards see who is going", () => {
  const source = read("door.tsx");
  assert.doesNotMatch(source, /Only the room's admins see the full list/);
  assert.match(
    source,
    /At a special event, say you're going\. You see only your own answer\. The host and the room's stewards see who is going\./,
  );
});

test("Find clears refused at each close submit so a repeat failure is announced again", () => {
  const source = read("find-view.tsx");
  assert.match(source, /event\.preventDefault\(\);\s*if \(submitting\) return;\s*(\/\/[^\n]*\n\s*)?setRefused\(\[\]\);\s*setDroppedPeople\(\[\]\);\s*const happened =/);
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
  // An admin as an admin gets no other names either (Oct 30).
  const admin = forViewer(cards.at(-1)!, { admin: true, name: "Me" });
  assert.deepEqual(admin.going, ["Me"]);
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
  // Only own, host and steward may read anyone else's row (Oct 30): no admin
  // bypass; $2 is the role flag (ADMIN_ROLE_SEES_NAMES for an admin).
  assert.match(server, /r\.user_id = \$3\s+or \(\$2::boolean and g\.host_user_id = \$3\)\s+or \(\$2::boolean and g\.room_id <> '' and g\.room_id = any \(\$4::text\[\]\)\)/);
  assert.match(server, /\[input\.gatheringIds, roleCounts\(input\.admin\), input\.userId/);
  assert.doesNotMatch(server, /if \(reader\.admin\) return rows;/);
  assert.match(server, /seesPeople\(reader, gate\.gathering\) \? \{ people: withHandles\(rows, reader\) \} : \{\}/);
  assert.match(server, /if \(!marksCame\(reader, gate\.gathering\)\) \{\s*return json\(403, \{ error: !roleCounts\(reader\.admin\) \? ADMIN_NO_NAMES : MARK_REFUSED \}\);/);
  assert.doesNotMatch(server, /gate\.actor\.admin\) \{\s*return json\(403/);
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
  // Design 5714690804 M1: no reserved laurel space. The mark is 0 wide (and
  // cancels the row's gap-3) until "going", then grows in; reduced motion
  // zeroes the transition with the sheet-wide rule.
  assert.doesNotMatch(css, /\.rsvp-mark\{[^}]*width:7\.5rem/);
  assert.match(css, /\.rsvp-mark\{[^}]*width:max-content;max-width:0;overflow:hidden;margin-inline-start:-\.75rem;transition:max-width 240ms var\(--ease-press\),margin 240ms var\(--ease-press\)\}/);
  assert.match(css, /\.btn-rsvp\.btn-primary \+ \.rsvp-mark\{max-width:4rem;margin-inline-start:0\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\}\*,\*::before,\*::after\{animation:none!important;transition-duration:0s!important;transition-delay:0s!important\}/);
  // The gap it cancels is the row's gap-3 (.75rem), with the mark right after the button.
  assert.match(control, /<div className="flex flex-wrap items-center gap-3">/);
  // The sheet-wide reduced-motion rule (every transition at 0s) covers the mark;
  // a rule of its own would push the sheet past its 3 KB budget.
  assert.match(css, /prefers-reduced-motion:reduce\)\{[^@]*\*,\*::before,\*::after\{animation:none!important;transition-duration:0s!important;transition-delay:0s!important\}/);
});

test("Find's close form: a stale roll call resets the picks and offers Reload; focus survives a card leaving (#126)", () => {
  const src = read("find-view.tsx");
  assert.match(src, /check\.stops\.includes\(ROLL_CALL_STALE\)\) resetPicks\(\)/);
  assert.match(src, /stop === ROLL_CALL_STALE \?[\s\S]{0,400}reloadRsvps\(\)\.then\(\(\) => \{\s*resetPicks\(\);/);
  assert.match(src, />\s*Reload the list\s*</);
  // Ghost (bordered), not quiet (Design #126 low 2).
  assert.match(src, /className=\{cn\(btnGhost, "min-h-\[44px\]"\)\}\s*onClick=\{\(\) => \{\s*void reloadRsvps\(\)/);
  assert.match(src, /id=\{FIND_LIST_HEADING\}\s*tabIndex=\{-1\}\s*className="focus-target /);
  assert.match(src, /document\.getElementById\(FIND_LIST_HEADING\)\?\.focus\(\)/);
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  // One house definition (#117); no second rule.
  assert.match(css, /\.focus-target:focus,\s*\[data-focus-ring\]:focus \{\s*outline: 2px solid currentColor;/);
  assert.equal(css.match(/\.focus-target:focus/g)?.length, 1);
});

test("the roll call option copy (Design #126)", async () => {
  const { ROOM_OPTION_WHAT } = await import("./room-options.ts");
  assert.equal(
    ROOM_OPTION_WHAT.roll_call,
    "After a special event, the host or a steward records who came. Only they see it. You see your own.",
  );
});

test("Design #126 M1: dropped picks are named in a status line, cleared on the next submit", () => {
  const src = read("find-view.tsx");
  // Reload runs the reset again and drops nobody: the line stays until submit (QA S4 #3).
  // A list of people, not a stored sentence: each reset adds and removes (Design #126 M1).
  assert.match(src, /setDroppedPeople\(\(shown\) => nextDropped\(shown, roll, fresh, cameKeys\)\)/);
  assert.match(src, /const dropped = droppedLine\(/);
  assert.match(src, /<p role="status" className=\{cn\("text-sm text-fg", !dropped && "sr-only"\)\}>\s*\{dropped\}/);
  assert.match(src, /setRefused\(\[\]\);\s*setDroppedPeople\(\[\]\);\s*const happened/);
});

test("Design #126 M2: after Reload, focus goes to the first chip with the ring, or Save", () => {
  const src = read("find-view.tsx");
  assert.match(src, /setAfterReload\(true\)/);
  assert.match(src, /focusWithRing\(firstChip\.current \?\? saveButton\.current\)/);
  assert.match(src, /ref=\{index === 0 \? firstChip : undefined\}/);
  assert.match(src, /<button\s+ref=\{saveButton\}\s+type="submit"\s+value="yes"/);
});

test("the sheet-wide reduced-motion rule zeroes transition delays too (Design #126 low 3)", () => {
  const css = readFileSync(new URL("../../../public/backgrounds.css", import.meta.url), "utf8");
  assert.match(css, /transition-duration:0s!important;transition-delay:0s!important/);
});

test("Design #126 M1: a saved close locks the form from the store, so a remount or reopen stays locked", () => {
  const src = read("find-view.tsx");
  // Derived each render from the saved close, never a local flag that starts false.
  assert.match(src, /const saved = savedClose\(card\.id, card\.next \|\| todayIso\(\)\);\s*const savedNames = saved \? saved\.names : null;\s*const whoSaved = saved !== null;/);
  assert.doesNotMatch(src, /useState\(false\);\s*\n[^\n]*whoSaved|\[whoSaved, setWhoSaved\]/);
  // Locked: no chips to toggle; the line names who that close marked.
  assert.match(src, /roll\.length > 0 && !whoSaved \? \(/);
  assert.match(src, /\{saved \? \(saved\.happened \? whoCameSavedLine\(savedNames \?\? \[\]\) : DID_NOT_SAVED_LINE\) : ""\}/);
  // L2: dropped names are not collapsed by name.
  assert.match(src, /const dropped = droppedLine\(droppedPeople\.map\(\(person\) => person\.name\)\);/);
});

test("QA S3: Find reopened after a failed write-up opens locked with the kept names", () => {
  const src = read("find-view.tsx");
  // Read on every render, not set by a failed submit: a reopen is locked at once.
  assert.match(src, /const saved = savedClose\(card\.id, card\.next \|\| todayIso\(\)\);/);
  assert.doesNotMatch(src, /setWhoSaved/);
  assert.match(src, /\{saved \? \(saved\.happened \? whoCameSavedLine\(savedNames \?\? \[\]\) : DID_NOT_SAVED_LINE\) : ""\}/);
});

test("QA S3: the composer opened after a saved close is locked with the kept names", () => {
  const src = read("room-view.tsx");
  assert.match(src, /const savedNames = closing \? savedCloseNames\(closing\.id, closing\.next \|\| todayIso\(\)\) : null;/);
  assert.match(src, /<p role="status" className=\{cn\("text-fg", !savedNames && "sr-only"\)\}>\s*\{savedNames \? whoCameSavedLine\(savedNames\) : ""\}/);
});

test("Design #126 M1: a locked Find form offers only the saved outcome; the other renders null", () => {
  const src = read("find-view.tsx");
  assert.match(src, /\{!saved \|\| saved\.happened \? \(\s*<button\s+ref=\{saveButton\}\s+type="submit"\s+value="yes"/);
  assert.match(src, /\{!saved \|\| !saved\.happened \? \(\s*<button\s+ref=\{saved \? saveButton : undefined\}\s+type="submit"\s+value="no"/);
});

test("Design #126 L1: the composer's 'Name one person' lists the saved close's names", () => {
  const src = read("room-view.tsx");
  assert.match(src, /const cameNames = savedNames \?\? current\.came;/);
  assert.match(src, /\{rollCall && cameNames\.length > 0 \? \(/);
  assert.match(src, /\{cameNames\.map\(\(name\) => \(/);
});

test("Design #126 L2: the composer's status line is always mounted; only the chips hide", () => {
  const src = read("room-view.tsx");
  assert.match(src, /\{savedNames \? null : closing && takesRoll\(closing\) && roll\.length > 0 \? \(/);
  assert.doesNotMatch(src, /\{savedNames \? \(\s*<p role="status"/);
});

test("Design #126 L3: opening the close form focuses 'How it went'", () => {
  const src = read("find-view.tsx");
  assert.match(src, /useEffect\(\(\) => \{\s*if \(closing\) lineInput\.current\?\.focus\(\);\s*\}, \[closing\]\);/);
  assert.match(src, /<input\s+ref=\{lineInput\}\s+id=\{lineId\}/);
});
