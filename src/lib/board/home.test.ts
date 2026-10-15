import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COUNCIL_APPROVED_LABEL,
  congregationIdForParish,
  homeOrder,
  homeSections,
  liveApproval,
  normalizeZip,
  toHomeMember,
  townIdForZip,
  type CouncilApproval,
  type HomeCatalog,
  type HomeEntry,
  type HomeMember,
  type HomePlace,
} from "./home.ts";
import { CONGREGATIONS, MEMBER_ROOMS, ZIP_TOWNS, homeCatalog } from "./places.ts";

const room = (id: string): HomePlace => ({ kind: "room", id });
const group = (id: string): HomePlace => ({ kind: "group", id });

const catalog: HomeCatalog = {
  zips: [
    { zip: "33578", townId: "riverview" },
    { zip: "33511", townId: "brandon" },
  ],
  rooms: [
    { id: "rv-shop", scope: { kind: "town", townId: "riverview" } },
    { id: "rv-town", scope: { kind: "town", townId: "riverview" } },
    { id: "brandon-town", scope: { kind: "town", townId: "brandon" } },
    { id: "cong-epiphany", scope: { kind: "congregation", congregationId: "epiphany" } },
    { id: "cong-grace", scope: { kind: "congregation", congregationId: "grace" } },
    { id: "region-hillsborough", scope: { kind: "region", regionId: "hillsborough" } },
  ],
};

function member(patch: Partial<HomeMember> = {}): HomeMember {
  return {
    zip: "33578",
    congregationId: "epiphany",
    joined: [{ kind: "room", id: "rv-shop" }],
    ...patch,
  };
}

function entry(id: string, at: number, place: HomePlace): HomeEntry {
  return { id, at, place };
}

function approval(patch: Partial<CouncilApproval> & Pick<CouncilApproval, "id" | "entryId">): CouncilApproval {
  return { reason: "The council logged a reason.", by: "Council", at: 1, revokedAt: null, ...patch };
}

function ids(rows: { entry: HomeEntry }[]): string[] {
  return rows.map((row) => row.entry.id);
}

describe("zip and congregation", () => {
  it("reads a ZIP and a ZIP+4, and rejects anything else", () => {
    assert.equal(normalizeZip(" 33578 "), "33578");
    assert.equal(normalizeZip("33578-1234"), "33578");
    assert.equal(normalizeZip("3357"), "");
    assert.equal(normalizeZip("335781"), "");
    assert.equal(normalizeZip(""), "");
  });

  it("maps many ZIPs to one town and refuses a ZIP claimed twice", () => {
    assert.equal(townIdForZip("33578", ZIP_TOWNS), "riverview");
    assert.equal(townIdForZip("33569", ZIP_TOWNS), "riverview");
    assert.equal(townIdForZip("33511", ZIP_TOWNS), "brandon");
    assert.equal(townIdForZip("00000", ZIP_TOWNS), null);
    assert.equal(townIdForZip("33578", [{ zip: "33578", townId: "a" }, { zip: "33578", townId: "b" }]), null);
    assert.equal(townIdForZip("33578", [{ zip: "33578", townId: "riverview" }, { zip: "33578", townId: "riverview" }]), "riverview");
  });

  it("keeps an explicit congregation id, and otherwise matches the parish name", () => {
    assert.equal(congregationIdForParish("  epiphany of our lord ", CONGREGATIONS), "epiphany");
    assert.equal(congregationIdForParish("somewhere else", CONGREGATIONS), "");
    const named = toHomeMember({ zip: "33578", parish: "Epiphany of Our Lord", congregationId: "" }, [], CONGREGATIONS);
    assert.equal(named.congregationId, "epiphany");
    const explicit = toHomeMember({ zip: "", parish: "Redeemer Presbyterian", congregationId: "epiphany" }, [], CONGREGATIONS);
    assert.equal(explicit.congregationId, "epiphany");
    const fallback = toHomeMember({ zip: "", parish: "Redeemer Presbyterian", congregationId: "missing" }, [], CONGREGATIONS);
    assert.equal(fallback.congregationId, "redeemer");
  });
});

describe("homeOrder", () => {
  const entries: HomeEntry[] = [
    entry("hearing", 4, room("region-hillsborough")),
    entry("mass", 3, room("cong-epiphany")),
    entry("coop", 2, room("rv-town")),
    entry("lifts", 1, room("rv-shop")),
    entry("framing", 2, room("rv-shop")),
    entry("brandon", 0, room("brandon-town")),
    entry("grace", 0, room("cong-grace")),
  ];

  it("orders joined, then town, then congregation, then wider, earlier first inside each", () => {
    const rows = homeOrder(member(), entries, catalog);
    assert.deepEqual(ids(rows), ["lifts", "framing", "coop", "mass", "hearing"]);
    assert.deepEqual(rows.map((row) => row.tier), ["joined", "joined", "town", "congregation", "region"]);
  });

  it("does not let a newer wider item outrank an earlier joined one", () => {
    const rows = homeOrder(member(), [entry("soon-region", 0, room("region-hillsborough")), entry("later-joined", 100, room("rv-shop"))], catalog);
    assert.deepEqual(ids(rows), ["later-joined", "soon-region"]);
  });

  it("keeps a joined town room in the joined tier only", () => {
    const rows = homeOrder(member(), [entry("shop", 5, room("rv-shop")), entry("shop", 9, room("rv-shop"))], catalog);
    assert.deepEqual(ids(rows), ["shop"]);
    assert.equal(rows[0]?.tier, "joined");
  });

  it("omits another town and another congregation", () => {
    const rows = homeOrder(member(), entries, catalog);
    assert.equal(rows.some((row) => row.entry.id === "brandon" || row.entry.id === "grace"), false);
  });

  it("skips the town tier when the ZIP is blank, invalid, or ambiguous", () => {
    const town = [entry("coop", 1, room("rv-town"))];
    assert.deepEqual(ids(homeOrder(member({ zip: "" }), town, catalog)), []);
    assert.deepEqual(ids(homeOrder(member({ zip: "3357" }), town, catalog)), []);
    const ambiguous: HomeCatalog = { ...catalog, zips: [{ zip: "33578", townId: "riverview" }, { zip: "33578", townId: "brandon" }] };
    assert.deepEqual(ids(homeOrder(member(), town, ambiguous)), []);
  });

  it("breaks a time tie by id, and ignores a score stuffed onto the entry", () => {
    const noisy = [
      { id: "b", at: 5, place: room("rv-shop"), score: 1 },
      { id: "a", at: 5, place: room("rv-shop"), score: 1000 },
    ];
    assert.deepEqual(ids(homeOrder(member(), noisy, catalog)), ["a", "b"]);
  });

  it("puts a joined group in the first tier and leaves an unjoined group out", () => {
    const rows = homeOrder(
      member({ joined: [{ kind: "group", id: "men-gym" }] }),
      [entry("gym", 9, group("men-gym")), entry("other", 0, group("other-theme")), entry("coop", 1, room("rv-town"))],
      catalog,
    );
    assert.deepEqual(ids(rows), ["gym", "coop"]);
    assert.equal(rows[0]?.tier, "joined");
    assert.equal(rows[0]?.councilApproved, false);
  });

  it("does not treat a group id as the room with the same id", () => {
    const rows = homeOrder(
      member({ joined: [group("rv-shop")] }),
      [entry("as-room", 1, room("rv-shop")), entry("as-group", 2, group("rv-shop"))],
      catalog,
    );
    assert.deepEqual(
      rows.map((row) => [row.entry.id, row.tier]),
      [
        ["as-group", "joined"],
        ["as-room", "town"],
      ],
    );
  });

  it("still lists a joined room that is not in the directory", () => {
    const rows = homeOrder(member({ joined: [room("future-room")] }), [entry("x", 1, room("future-room"))], catalog);
    assert.equal(rows[0]?.tier, "joined");
  });
});

describe("council approval", () => {
  const region = entry("hearing", 10, room("region-hillsborough"));
  const joined = entry("lifts", 1, room("rv-shop"));

  it("lifts an approved entry above joined content and labels it", () => {
    const rows = homeOrder(member(), [joined, region], catalog, [approval({ id: "c1", entryId: "hearing", at: 5 })]);
    assert.deepEqual(ids(rows), ["hearing", "lifts"]);
    assert.equal(rows[0]?.label, COUNCIL_APPROVED_LABEL);
    assert.equal(rows[0]?.approvalId, "c1");
    assert.equal(rows[0]?.councilApproved, true);
    assert.equal(rows.filter((row) => row.entry.id === "hearing").length, 1);
  });

  it("promotes another town's post that would otherwise be hidden", () => {
    const brandon = entry("breakfast", 50, room("brandon-town"));
    const rows = homeOrder(member(), [joined, brandon], catalog, [approval({ id: "c2", entryId: "breakfast", reason: "Standing notice." })]);
    assert.deepEqual(ids(rows), ["breakfast", "lifts"]);
    assert.equal(rows[0]?.reason, "Standing notice.");
  });

  it("orders promoted entries by their own time, not by when the council acted", () => {
    const earlier = entry("earlier", 1, room("region-hillsborough"));
    const later = entry("later", 9, room("region-hillsborough"));
    const rows = homeOrder(member({ joined: [] }), [later, earlier], catalog, [
      approval({ id: "late-ok", entryId: "later", at: 1 }),
      approval({ id: "early-ok", entryId: "earlier", at: 100 }),
    ]);
    assert.deepEqual(ids(rows), ["earlier", "later"]);
    assert.equal(rows.every((row) => row.tier === "council"), true);
  });

  it("uses the newest log row: a revocation or a blank reason does not promote", () => {
    const kept = [region];
    const revoked = homeOrder(member({ joined: [] }), kept, catalog, [
      approval({ id: "a", entryId: "hearing", at: 1, reason: "First reason." }),
      approval({ id: "b", entryId: "hearing", at: 2, reason: "Withdrawn.", revokedAt: 2 }),
    ]);
    assert.equal(revoked[0]?.tier, "region");
    assert.equal(revoked[0]?.label, null);

    const blank = homeOrder(member({ joined: [] }), kept, catalog, [approval({ id: "c", entryId: "hearing", reason: "   " })]);
    assert.equal(blank[0]?.councilApproved, false);

    const replaced = liveApproval("hearing", [
      approval({ id: "old", entryId: "hearing", at: 1, reason: "First reason." }),
      approval({ id: "new", entryId: "hearing", at: 2, reason: "Second reason." }),
    ]);
    assert.equal(replaced?.id, "new");
    assert.equal(replaced?.reason, "Second reason.");
  });

  it("does not promote an entry that was not passed in", () => {
    assert.equal(homeOrder(member(), [], catalog, [approval({ id: "c", entryId: "missing" })]).length, 0);
  });
});

describe("homeSections", () => {
  it("groups consecutive tiers and skips tiers with nothing in them", () => {
    const rows = homeOrder(member(), [entry("lifts", 1, room("rv-shop")), entry("hearing", 2, room("region-hillsborough"))], catalog);
    const sections = homeSections(rows);
    assert.deepEqual(
      sections.map((section) => section.label),
      ["What you've joined", "Farther out"],
    );
    assert.equal(sections.some((section) => section.rows.length === 0), false);
  });
});

describe("sample directory", () => {
  it("places Riverview shop nights in Riverview and Epiphany on that congregation", () => {
    const shop = MEMBER_ROOMS.find((item) => item.id === "rv-shop");
    const church = MEMBER_ROOMS.find((item) => item.id === "cong-epiphany");
    assert.deepEqual(shop?.scope, { kind: "town", townId: "riverview" });
    assert.deepEqual(church?.scope, { kind: "congregation", congregationId: "epiphany" });
    const catalogWithShop = homeCatalog(["shop"]);
    const rows = homeOrder(member({ joined: [], zip: "", congregationId: "" }), [entry("loose", 1, room("shop"))], catalogWithShop);
    assert.equal(rows[0]?.tier, "region");
    assert.equal(MEMBER_ROOMS.some((item) => item.id === "shop"), false);
  });
});
