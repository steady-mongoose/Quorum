import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homeOrder, type HomeCatalog, type HomeMember } from "./home.ts";
import type { AccessRow } from "./access.ts";
import {
  SEED_GROUPS,
  appealGroupNote,
  decideGroupAppeal,
  decideGroupRequest,
  fileGroupNote,
  groupFeed,
  groupHomeEntries,
  markGroupNote,
  removeGroupNote,
  requestGroup,
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

function access(patch: Partial<AccessRow> & Pick<AccessRow, "id" | "name" | "role" | "roomId">): AccessRow {
  return {
    action: "grant",
    vouchedBy: "Josh",
    approvedBy: "Josh",
    by: "Josh",
    at: 1,
    note: "",
    ...patch,
  };
}

const shopLog: AccessRow[] = [
  access({ id: "m-maria", name: "Maria", role: "member", roomId: "rv-shop" }),
  access({ id: "s-josh", name: "Josh", role: "steward", roomId: "rv-shop", at: 2 }),
  access({ id: "s-tom", name: "Tom", role: "steward", roomId: "other-room", at: 3 }),
];

describe("groups", () => {
  it("seeds the interest groups and does not create one until a steward of that room approves", () => {
    assert.deepEqual(
      SEED_GROUPS.map((group) => group.id),
      ["carpentry", "gardening", "brewing", "literary", "christian-businesses"],
    );
    const asked = requestGroup("Maria", ["rv-shop"], SEED_GROUPS, [], { name: "Beekeeping", about: "Hives and the first spring check.", roomId: "rv-shop" }, 5, "gr1");
    assert.equal(asked.ok, true);
    if (!asked.ok) return;
    assert.equal(SEED_GROUPS.some((group) => group.id === "beekeeping"), false);
    const kanji = requestGroup("Maria", ["rv-shop"], SEED_GROUPS, [], { name: "木工", about: "木工の夜", roomId: "rv-shop" }, 5, "gr-k");
    assert.equal(kanji.ok, true);
    if (kanji.ok) assert.equal(kanji.value.groupId, "木工");
    assert.equal(decideGroupRequest("Maria", shopLog, SEED_GROUPS, asked.value, "approved", "Fine.", 6).ok, false);
    assert.equal(decideGroupRequest("Tom", shopLog, SEED_GROUPS, asked.value, "approved", "Fine.", 6).ok, false);
    assert.equal(decideGroupRequest("Pete", shopLog, SEED_GROUPS, asked.value, "approved", "Fine.", 6).ok, false);
    assert.equal(decideGroupRequest("Josh", shopLog, SEED_GROUPS, asked.value, "approved", "", 6).ok, false);
    const approved = decideGroupRequest("Josh", shopLog, SEED_GROUPS, asked.value, "approved", "Members asked.", 6);
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.equal(approved.value.group?.admin, "Maria");
    assert.equal(approved.value.group?.id, "beekeeping");
    assert.equal(approved.value.request.status, "approved");
    assert.equal(approved.value.request.decidedBy, "Josh");
    assert.equal(approved.value.request.note, "Members asked.");
  });

  it("refuses a request from a room you have not joined, a duplicate, and a second open request", () => {
    assert.equal(requestGroup("Maria", [], SEED_GROUPS, [], { name: "Beekeeping", about: "Hives.", roomId: "rv-shop" }, 1, "gr").ok, false);
    assert.equal(requestGroup("Maria", ["rv-shop"], SEED_GROUPS, [], { name: "Carpentry", about: "Another.", roomId: "rv-shop" }, 1, "gr").ok, false);
    const open = requestGroup("Maria", ["rv-shop"], SEED_GROUPS, [], { name: "Beekeeping", about: "Hives.", roomId: "rv-shop" }, 1, "gr");
    assert.equal(open.ok, true);
    if (!open.ok) return;
    assert.equal(requestGroup("Ruth", ["rv-shop"], SEED_GROUPS, [open.value], { name: "Beekeeping", about: "Also.", roomId: "rv-shop" }, 2, "gr2").ok, false);
    const refused = decideGroupRequest("Josh", shopLog, SEED_GROUPS, open.value, "refused", "Not yet.", 3);
    assert.equal(refused.ok, true);
    if (refused.ok) assert.equal(refused.value.group, null);
  });

  it("accepts a note and an appeal in any script", () => {
    const filed = fileGroupNote("Josh", carpentry, true, { body: "木工の夜", on: "" }, 5, "n-k");
    assert.equal(filed.ok, true);
    const appeal = appealGroupNote("Josh", note({ id: "n1", mark: "sloppy" }), [], "木工の夜", 6, "a-k");
    assert.equal(appeal.ok, true);
    assert.equal(fileGroupNote("Josh", carpentry, true, { body: "   ", on: "" }, 5, "n-blank").ok, false);
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
