import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homeOrder, type HomeCatalog, type HomeMember } from "./home.ts";
import {
  SEED_GROUPS,
  appealGroupNote,
  createGroup,
  decideGroupAppeal,
  englishOnly,
  fileGroupNote,
  groupFeed,
  groupHomeEntries,
  markGroupNote,
  removeGroupNote,
  type GroupAppeal,
  type GroupNote,
  type ThemeGroup,
} from "./groups.ts";

const carpentry = SEED_GROUPS[0]!;
const catalog: HomeCatalog = { zips: [], rooms: [] };
const member: HomeMember = { zip: "", congregationId: "", joined: [{ kind: "group", id: "carpentry" }] };

function note(patch: Partial<GroupNote> & Pick<GroupNote, "id">): GroupNote {
  return {
    groupId: "carpentry",
    author: "Josh",
    body: "Bring a hand plane.",
    on: "",
    at: 1,
    mark: null,
    removed: false,
    removedFor: null,
    ...patch,
  };
}

describe("english", () => {
  it("accepts English and refuses a substantial non-Latin body", () => {
    assert.equal(englishOnly("  Saturday bench, bring a plane. ").ok, true);
    assert.equal(englishOnly("José's saw").ok, true);
    assert.equal(englishOnly("").ok, false);
    assert.equal(englishOnly("Суббота в мастерской, принеси рубанок пожалуйста").ok, false);
    assert.equal(englishOnly("木工の夜").ok, false);
  });
});

describe("groups", () => {
  it("seeds the interest groups and refuses a duplicate name", () => {
    assert.deepEqual(
      SEED_GROUPS.map((group) => group.id),
      ["carpentry", "gardening", "brewing", "literary", "christian-businesses"],
    );
    const made = createGroup("Josh", "Beekeeping", "Hives and the first spring check.", SEED_GROUPS, 10);
    assert.equal(made.ok, true);
    if (made.ok) assert.equal(made.value.admin, "Josh");
    assert.equal(createGroup("Josh", "Carpentry", "Another shop.", SEED_GROUPS, 10).ok, false);
    assert.equal(createGroup("Josh", "木工", "Shop.", SEED_GROUPS, 10).ok, false);
  });

  it("lets a joined member post, and keeps the feed newest-first with marks in place", () => {
    const filed = fileGroupNote("Josh", carpentry, true, { body: "Saturday bench.", on: "2026-10-17" }, 5, "n1");
    assert.equal(filed.ok, true);
    assert.equal(fileGroupNote("Pete", carpentry, false, { body: "I am not in.", on: "" }, 6, "n2").ok, false);
    const older = note({ id: "old", at: 1, mark: "sloppy" });
    const newer = note({ id: "new", at: 9, mark: "unsupported" });
    assert.deepEqual(groupFeed([older, newer, note({ id: "gone", at: 20, removed: true })], "carpentry").map((item) => item.id), ["new", "old"]);
  });

  it("puts only an upcoming joined gathering on Home, with no score", () => {
    const notes = [
      note({ id: "soon", on: "2026-10-16", at: 1 }),
      note({ id: "later", on: "2026-10-30", at: 1 }),
      note({ id: "nodate", on: "", at: 1 }),
      note({ id: "brew", groupId: "brewing", on: "2026-10-16", at: 1 }),
    ];
    const entries = groupHomeEntries(notes, "2026-10-15");
    assert.deepEqual(entries.map((item) => item.id), ["soon", "brew"]);
    assert.equal(entries[0]?.place.kind, "group");
    const rows = homeOrder(member, entries, catalog);
    assert.deepEqual(rows.map((row) => [row.entry.id, row.tier]), [["soon", "joined"]]);
  });
});

describe("moderation and appeals", () => {
  const group: ThemeGroup = carpentry;
  const posted = note({ id: "n1", author: "Josh" });

  it("lets the group admin mark and hard-remove, and nobody else", () => {
    const marked = markGroupNote("Tom", group, posted, "sloppy", 3, "m1");
    assert.equal(marked.ok, true);
    if (marked.ok) {
      assert.equal(marked.value.note.mark, "sloppy");
      assert.equal(marked.value.row.action, "mark");
    }
    assert.equal(markGroupNote("Josh", group, posted, "sloppy", 3, "m2").ok, false);
    assert.equal(removeGroupNote("Tom", group, posted, "threat", 4, "m3").ok, true);
    const bad = removeGroupNote("Tom", group, posted, "sloppy" as "threat", 4, "m4");
    assert.equal(bad.ok, false);
  });

  it("lets the author appeal to a steward, who can lift the mark", () => {
    const marked = note({ id: "n1", mark: "unsupported" });
    const appeal = appealGroupNote("Josh", marked, [], "The claim is sourced in the thread.", 5, "a1");
    assert.equal(appeal.ok, true);
    if (!appeal.ok) return;
    assert.equal(appealGroupNote("Tom", marked, [], "Not my note.", 5, "a2").ok, false);
    assert.equal(appealGroupNote("Josh", marked, [appeal.value], "Again.", 6, "a3").ok, false);
    const denied = decideGroupAppeal("Maria", false, appeal.value, marked, "lifted", 7);
    assert.equal(denied.ok, false);
    const own = decideGroupAppeal("Josh", true, appeal.value, marked, "lifted", 7);
    assert.equal(own.ok, false);
    const lifted = decideGroupAppeal("Maria", true, appeal.value, marked, "lifted", 7);
    assert.equal(lifted.ok, true);
    if (lifted.ok) {
      assert.equal(lifted.value.note.mark, null);
      assert.equal(lifted.value.appeal.status, "lifted");
      assert.equal(lifted.value.appeal.decidedBy, "Maria");
    }
  });

  it("puts a removed note back when a steward lifts the appeal", () => {
    const removed = note({ id: "n1", removed: true, removedFor: "porn" });
    const appeal: GroupAppeal = {
      id: "a1",
      noteId: "n1",
      groupId: "carpentry",
      by: "Josh",
      text: "This was a false mark.",
      at: 1,
      status: "open",
      decidedBy: "",
      decidedAt: null,
    };
    const upheld = decideGroupAppeal("Maria", true, appeal, removed, "upheld", 2);
    assert.equal(upheld.ok && upheld.value.note.removed, true);
    const lifted = decideGroupAppeal("Maria", true, appeal, removed, "lifted", 3);
    assert.equal(lifted.ok && lifted.value.note.removed, false);
    assert.equal(lifted.ok && lifted.value.note.removedFor, null);
  });
});
