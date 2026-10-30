import "./test-storage.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { blankDraft } from "./model.ts";
import { forViewer, newCard, seesCame, seesGoing, takesRoll, type MeetingCard, type RsvpViewer } from "./model.ts";
import { SEED_CARDS } from "./seed-cards.ts";
import { ROOMS } from "./model.ts";
import {
  applyServerRsvps,
  CAME_NOT_SAVED,
  ROLL_CALL_STALE,
  droppedLine,
  nextDropped,
  whoCameSavedLine,
  resetRollPicks,
  cameIdsFor,
  deviceRsvpMoves,
  rollCallPeople,
  RSVP_NOT_SAVED,
  toggleRoll,
  type RsvpList,
} from "./rsvp-api.ts";
import { setBoardClient, type BoardClient } from "./client.ts";
import { ADMIN_ROLE_SEES_NAMES, MARK_TOO_EARLY } from "./rsvp-rules.ts";
import { readFileSync } from "node:fs";
import { savedWhoCameLine } from "./rsvp-api.ts";
import { closeSavedFor, forgetSavedClose, savedClose, savedCloseNames, useBoard } from "./store.ts";

const G1 = "6b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const G2 = "7c2a3b4d-5e6f-4b7c-9d8e-0f1a2b3c4d5e";

function card(id: string, over: Partial<MeetingCard> = {}): MeetingCard {
  return newCard({ id, room: "shop", kind: "meeting", name: "Lifts", place: "Garage", time: "7", host: "Dale", special: true, ...over });
}

test("the move sends only my own name, and never a seed card", () => {
  const cards = [
    card(G1, { going: ["Ann", "Me"], wentBy: ["Tom"] }),
    card(G2, { going: ["Tom"], wentBy: ["Me", "Tom"] }),
    { ...SEED_CARDS[0]!, going: ["Me"], wentBy: ["Me"] },
    card("brief", { going: ["Me"] }),
  ];
  assert.deepEqual(deviceRsvpMoves(cards, "Me"), [
    { gatheringId: G1, going: true, attended: false },
    { gatheringId: G2, going: false, attended: true },
  ]);
  const text = JSON.stringify(deviceRsvpMoves(cards, "Me"));
  assert.equal(text.includes("Ann") || text.includes("Tom"), false);
  assert.deepEqual(deviceRsvpMoves(cards, " "), []);
});

test("a member's board gets only their own name from the server, even if a row slips through", () => {
  const list: RsvpList = {
    viewer: "u-me",
    admin: false,
    hosts: [],
    stewardRooms: [],
    rsvps: [
      { gatheringId: G1, roomId: "shop", userId: "u-me", name: "Server Name", going: true, attended: false },
      { gatheringId: G1, roomId: "shop", userId: "u-tom", name: "Tom", going: true, attended: true },
    ],
  };
  const cards = [card(G1, { going: ["Ann"], wentBy: ["Ann"] }), card("brief", { going: ["Ann"] })];
  const out = applyServerRsvps(cards, list, { me: "Me", gatheringIds: new Set([G1]) });
  assert.deepEqual(out[0]?.going, ["Me"]);
  assert.deepEqual(out[0]?.wentBy, []);
  // A card the server does not list keeps the device's data, and forViewer still trims it.
  assert.deepEqual(out[1]?.going, ["Ann"]);
  assert.deepEqual(forViewer(out[1]!, { admin: false, name: "Me" }).going, []);
  assert.deepEqual(rollCallPeople(list, "Me"), {});
});

test("an admin's board, as an admin, keeps only their own row and gets no roll call (Oct 30)", () => {
  const list: RsvpList = {
    viewer: "u-me",
    admin: true,
    hosts: [],
    stewardRooms: [],
    rsvps: [
      { gatheringId: G1, roomId: "shop", userId: "u-me", name: "Josh", going: true, attended: false },
      { gatheringId: G1, roomId: "shop", userId: "u-tom", name: "Tom", going: true, attended: true },
    ],
  };
  // Even if a row slipped through, the client drops it.
  const out = applyServerRsvps([card(G1)], list, { me: "Me", gatheringIds: new Set([G1]) });
  assert.deepEqual(out[0]?.going, ["Me"]);
  assert.deepEqual(out[0]?.wentBy, []);
  assert.deepEqual(rollCallPeople(list, "Me"), {});
});

test("an admin who hosts, or stewards the room, follows ADMIN_ROLE_SEES_NAMES", () => {
  const rows = [
    { gatheringId: G1, roomId: "shop", userId: "u-me", name: "Josh", going: true, attended: false },
    { gatheringId: G1, roomId: "shop", userId: "h_tom", name: "Tom", going: true, attended: true },
  ];
  const asHost: RsvpList = { viewer: "u-me", admin: true, hosts: [G1], stewardRooms: [], rsvps: rows };
  const asSteward: RsvpList = { viewer: "u-me", admin: true, hosts: [], stewardRooms: ["shop"], rsvps: rows };
  const full = card(G1, { host: "Dale", room: "shop", going: ["Me", "Tom"], wentBy: ["Tom"] });
  for (const list of [asHost, asSteward]) {
    const out = applyServerRsvps([card(G1)], list, { me: "Me", gatheringIds: new Set([G1]) });
    const roll = rollCallPeople(list, "Me")[G1];
    const seen = forViewer(full, { admin: true, name: "Me", hosts: list.hosts, stewardRooms: list.stewardRooms, byId: true });
    if (ADMIN_ROLE_SEES_NAMES) {
      assert.deepEqual(out[0]?.going, ["Me", "Tom"]);
      assert.equal(roll?.length, 2);
      assert.ok(takesRoll(seen) && seesCame(seen));
    } else {
      assert.deepEqual(out[0]?.going, ["Me"]);
      assert.equal(roll, undefined);
      assert.equal(takesRoll(seen) || seesCame(seen), false);
    }
  }
});

function stubClient(): BoardClient {
  const ok = async () => ({ ok: true as const });
  return new Proxy({} as BoardClient, {
    get: (_t, key) => {
      if (key === "then") return undefined;
      if (key === "load")
        return async () => ({
          ok: true,
          board: {
            me: {
              member: true, steward: false, admin: false, council: false, councilChair: false,
              stewardRooms: [], ban: null, gender: null, genderConfirmed: false,
            },
            genderPolicy: { setBy: "self", requiresConfirmation: false, changeBy: "admin" },
            rooms: [], posts: [], marks: [], removals: [], bans: [], appeals: [], csamReports: [], pages: [],
          },
        });
      if (key === "loadHome") return async () => ({ ok: false, error: "no" });
      return ok;
    },
  });
}

test("sign-in moves this browser's RSVPs once, then reads the server's", async () => {
  const server = new Map<string, { going: boolean; attended: boolean }>();
  const calls: string[] = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.pathname === "/api/gatherings") {
      return reply({
        gatherings: [{ id: G1, roomId: "shop", title: "Lifts", date: "", time: "7", town: "", place: "Garage", shared: false, mine: false }],
      });
    }
    if (url.pathname === "/api/rsvps/move") {
      const body = JSON.parse(String(init?.body)) as { entries: { gatheringId: string; going: boolean; attended: boolean }[] };
      for (const entry of body.entries) {
        if (entry.gatheringId !== G1) continue;
        const prior = server.get(entry.gatheringId) ?? { going: false, attended: false };
        server.set(entry.gatheringId, { going: prior.going || entry.going, attended: prior.attended || entry.attended });
      }
      return reply({ ok: true, saved: [G1] });
    }
    if (url.pathname === "/api/rsvps") {
      return reply({
        viewer: "u-me",
        admin: false,
        rsvps: [...server].map(([gatheringId, row]) => ({ gatheringId, userId: "u-me", name: "Me", ...row })),
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    setBoardClient(stubClient());
    useBoard.setState({
      remote: false,
      me: "Me",
      member: true,
      rsvpMovedFor: [],
      cards: [card(G1, { going: ["Ann", "Me"], wentBy: ["Ann"] }), card("brief", { going: ["Me"] })],
    });
    await useBoard.getState().connectRemote();
    assert.deepEqual(useBoard.getState().rsvpMovedFor, ["u-me"]);
    assert.equal(calls.filter((c) => c === "POST /api/rsvps/move").length, 1);
    const g1 = useBoard.getState().cards.find((c) => c.id === G1);
    assert.deepEqual(g1?.going, ["Me"]);
    assert.deepEqual(g1?.wentBy, []);
    assert.deepEqual(useBoard.getState().cards.find((c) => c.id === "brief")?.going, ["Me"]);

    // Signing in again does not move anything a second time.
    await useBoard.getState().connectRemote();
    assert.equal(calls.filter((c) => c === "POST /api/rsvps/move").length, 1);
    assert.deepEqual(server.get(G1), { going: true, attended: false });
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("a signed-in RSVP is saved on the server first; only rsvp-not-ready stays on the device", async () => {
  const sent: unknown[] = [];
  let mode: "ok" | "not-ready" | "throw" | "forbidden" | "old-api" = "ok";
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname === `/api/gatherings/${G1}/rsvp`) {
      sent.push(JSON.parse(String(init?.body)));
      if (mode === "throw") throw new TypeError("Failed to fetch");
      if (mode === "not-ready") return new Response(JSON.stringify({ error: "rsvp-not-ready" }), { status: 503 });
      if (mode === "forbidden") return new Response(JSON.stringify({ error: "Not found.", api: "rsvp" }), { status: 404 });
      if (mode === "old-api") return new Response(JSON.stringify({ error: "Not found." }), { status: 404 });
      return new Response(JSON.stringify({ mine: {} }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    setBoardClient(stubClient());
    useBoard.setState({ remote: true, me: "Me", boardError: "", rsvpFailed: [], rsvpPending: [], cards: [card(G1)] });
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(sent, [{ going: true }]);
    assert.deepEqual(useBoard.getState().cards[0]?.going, ["Me"]);

    // Before 0049 (the server's one code): kept on this device, no error.
    mode = "not-ready";
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(sent.at(-1), { going: false });
    assert.deepEqual(useBoard.getState().cards[0]?.going, []);
    assert.equal(useBoard.getState().boardError, "");

    // A dropped connection (softenFetch makes it a 503 api-unavailable) is a
    // failure: the button does not change and the line under it says so. The
    // page banner stays empty, so the failure is announced once, not twice.
    mode = "throw";
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(sent.at(-1), { going: true });
    assert.deepEqual(useBoard.getState().cards[0]?.going, []);
    assert.equal(useBoard.getState().boardError, "");
    assert.deepEqual(useBoard.getState().rsvpFailed, [G1]);
    assert.deepEqual(useBoard.getState().rsvpPending, []);

    // Any other refusal: the same.
    useBoard.setState({ rsvpFailed: [] });
    mode = "forbidden";
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(useBoard.getState().cards[0]?.going, []);
    assert.equal(useBoard.getState().boardError, "");
    assert.deepEqual(useBoard.getState().rsvpFailed, [G1]);

    // A 404 from an API that predates the RSVP routes (no marker): kept on
    // this device, like rsvp-not-ready, so the client can ship first.
    useBoard.setState({ rsvpFailed: [] });
    mode = "old-api";
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(useBoard.getState().cards[0]?.going, ["Me"]);
    assert.deepEqual(useBoard.getState().rsvpFailed, []);
    useBoard.setState({ cards: [card(G1)] });

    // The next good tap clears the "Not saved" line.
    mode = "ok";
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(useBoard.getState().cards[0]?.going, ["Me"]);
    assert.deepEqual(useBoard.getState().rsvpFailed, []);
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("two quick taps send one request, and the screen ends matching the server", async () => {
  const sent: unknown[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname === `/api/gatherings/${G1}/rsvp`) {
      sent.push(JSON.parse(String(init?.body)));
      await gate;
      return new Response(JSON.stringify({ mine: { going: true, attended: false } }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    setBoardClient(stubClient());
    useBoard.setState({ remote: true, me: "Me", boardError: "", rsvpPending: [], rsvpFailed: [], cards: [card(G1)] });
    useBoard.getState().rsvp(G1);
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(useBoard.getState().rsvpPending, [G1]);
    useBoard.getState().rsvp(G1);
    release();
    await settle();
    assert.deepEqual(sent, [{ going: true }]);
    assert.deepEqual(useBoard.getState().cards[0]?.going, ["Me"]);
    assert.deepEqual(useBoard.getState().rsvpPending, []);
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("a host sees their own gathering's going and came; a steward reads going and came in their rooms only", () => {
  const G3 = "8d3b4c5e-6f70-4c8d-8e9f-1a2b3c4d5e6f";
  const rows = [
    { gatheringId: G1, roomId: "shop", userId: "u-tom", name: "Tom", going: true, attended: true },
    { gatheringId: G1, roomId: "shop", userId: "u-ann", name: "Ann", going: false, attended: true },
    { gatheringId: G2, roomId: "shop", userId: "u-tom", name: "Tom", going: true, attended: false },
    { gatheringId: G3, roomId: "county", userId: "u-ann", name: "Ann", going: true, attended: false },
  ];
  const cards = [card(G1), card(G2), card(G3, { room: "county" })];
  const ids = new Set([G1, G2, G3]);

  // Host of G1 only: all of G1, nothing of G2 or G3 (even if the server slipped).
  const host: RsvpList = { viewer: "u-me", admin: false, hosts: [G1], stewardRooms: [], rsvps: rows };
  const hosted = applyServerRsvps(cards, host, { me: "Me", gatheringIds: ids });
  assert.deepEqual(hosted[0]?.going, ["Tom"]);
  assert.deepEqual(hosted[0]?.wentBy.sort(), ["Ann", "Tom"]);
  assert.deepEqual(hosted[1]?.going, []);
  assert.deepEqual(hosted[2]?.going, []);
  assert.deepEqual(Object.keys(rollCallPeople(host, "Me")), [G1]);

  // Steward of shop: going and who came on G1 and G2; nothing in county; a
  // roll call for shop's gatherings, because a steward marks (Oct 30).
  const steward: RsvpList = { viewer: "u-me", admin: false, hosts: [], stewardRooms: ["shop"], rsvps: rows };
  const stewarded = applyServerRsvps(cards, steward, { me: "Me", gatheringIds: ids });
  assert.deepEqual(stewarded[0]?.going, ["Tom"]);
  assert.deepEqual(stewarded[0]?.wentBy.sort(), ["Ann", "Tom"]);
  assert.deepEqual(stewarded[2]?.wentBy, []);
  assert.deepEqual(stewarded[1]?.going, ["Tom"]);
  assert.deepEqual(stewarded[2]?.going, []);
  assert.deepEqual(Object.keys(rollCallPeople(steward, "Me")).sort(), [G1, G2].sort());
});

test("forViewer: admin, host, steward and member each see what Josh allowed (Oct 30)", () => {
  const full = card(G1, { host: "Dale", room: "shop", going: ["Ann", "Me", "Tom"], wentBy: ["Tom", "Me"] });
  // An admin as an admin: only their own, no roll call (counts are in the summary).
  const admin = forViewer(full, { admin: true, name: "Me" });
  assert.equal(admin.seeing, undefined);
  assert.deepEqual(admin.going, ["Me"]);
  assert.deepEqual(admin.wentBy, ["Me"]);
  assert.equal(seesGoing(admin) || seesCame(admin) || takesRoll(admin), false);

  const host = forViewer(full, { admin: false, name: "Dale" });
  assert.equal(host.seeing, "host");
  assert.deepEqual(host.wentBy, ["Tom", "Me"]);
  assert.ok(seesGoing(host) && seesCame(host) && takesRoll(host));
  // Host by server id, too.
  assert.equal(forViewer(full, { admin: false, name: "Me", hosts: [G1] }).seeing, "host");

  const steward = forViewer(full, { admin: false, name: "Me", stewardRooms: ["shop"] });
  assert.equal(steward.seeing, "steward");
  assert.deepEqual(steward.going, ["Ann", "Me", "Tom"]);
  // Reads who came, and marks it (Oct 30).
  assert.deepEqual(steward.wentBy, ["Tom", "Me"]);
  assert.ok(seesGoing(steward) && seesCame(steward) && takesRoll(steward));

  const otherRoom = forViewer(full, { admin: false, name: "Me", stewardRooms: ["county"] });
  assert.equal(otherRoom.seeing, undefined);
  assert.deepEqual(otherRoom.going, ["Me"]);
  assert.deepEqual(otherRoom.wentBy, ["Me"]);

  const member = forViewer({ ...full, seeing: "host" }, { admin: false, name: "Me" });
  assert.equal(member.seeing, undefined);
  assert.deepEqual(member.going, ["Me"]);
  assert.deepEqual(member.wentBy, ["Me"]);
  assert.equal(seesGoing(member) || seesCame(member) || takesRoll(member), false);
});

test("the roll call sends member ids, so two people with one name are not mixed up", () => {
  const people = [
    { userId: "u-john-1", name: "John" },
    { userId: "u-john-2", name: "John" },
    { userId: "u-ann", name: "Ann" },
  ];
  const picked = toggleRoll(people, [], people[1]!);
  assert.deepEqual(picked, { keys: ["u-john-2"], came: ["John"], cameIds: ["u-john-2"] });
  assert.deepEqual(cameIdsFor(people, { picked: picked.cameIds, names: picked.came }), ["u-john-2"]);
  // Without picks, an ambiguous name is never guessed.
  assert.deepEqual(cameIdsFor(people, { names: ["John", "Ann"] }), ["u-ann"]);
  // An id not on the roll call is dropped.
  assert.deepEqual(cameIdsFor(people, { picked: ["u-stranger"], names: [] }), []);
});

test("a host who is not an admin closes a date and the server gets who came, by id", async () => {
  const sent: { path: string; body: unknown }[] = [];
  let fail = false;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (init?.method === "POST") sent.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
    if (url.pathname === `/api/gatherings/${G1}/attendance`) {
      if (fail) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    setBoardClient(stubClient());
    useBoard.setState({
      remote: true,
      admin: false,
      me: "Dale",
      boardError: "",
      rooms: ROOMS.map((room) => (room.id === "shop" ? { ...room, options: ["roll_call"] } : room)),
      rsvpHosts: [G1],
      rollCall: { [G1]: [{ userId: "u-tom", name: "Tom" }, { userId: "u-ann", name: "Ann" }] },
      cards: [card(G1, { host: "Dale", next: "2026-10-31", going: ["Tom", "Ann"] })],
    });
    const check = await useBoard.getState().closeCard(G1, true, "", "Good morning.", ["Tom"], "", ["u-tom"]);
    assert.equal(check.ok, true, JSON.stringify(check));
    await settle();
    const attendance = sent.filter((s) => s.path.endsWith("/attendance"));
    assert.deepEqual(attendance, [{ path: `/api/gatherings/${G1}/attendance`, body: { userIds: ["u-tom"], close: true, happened: true, seen: ["u-tom", "u-ann"] } }]);
    assert.equal(useBoard.getState().boardError, "");

    // A failed roll call: the card stays open with its going list, so the
    // host can try again. The close dialog shows the one message.
    fail = true;
    const open = card(G1, { host: "Dale", next: "2026-11-07", going: ["Tom"] });
    useBoard.setState({ cards: [open] });
    const failed = await useBoard.getState().closeCard(G1, true, "", "Again.", ["Tom"], "", ["u-tom"]);
    await settle();
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.ok ? [] : failed.stops, [CAME_NOT_SAVED]);
    assert.deepEqual(useBoard.getState().cards, [open]);
    assert.equal(useBoard.getState().boardError, "");

    // The retry goes through and closes it.
    fail = false;
    const retried = await useBoard.getState().closeCard(G1, true, "", "Again.", ["Tom"], "", ["u-tom"]);
    assert.equal(retried.ok, true, JSON.stringify(retried));
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("a member cannot mark 'I've been'; the host can", async () => {
  const sent: string[] = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (init?.method === "POST") sent.push(`${url.pathname} ${String(init.body)}`);
    return new Response(JSON.stringify({ mine: {} }), { status: 200 });
  }) as typeof fetch;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    setBoardClient(stubClient());
    // Dale said "going": only members going can be marked (QA F4). Dated in the past (QA N2).
    useBoard.setState({ remote: true, admin: false, me: "Maria", rsvpHosts: [], cards: [card(G1, { host: "Dale", next: "2026-10-24", going: ["Dale"] })] });
    useBoard.getState().visited(G1);
    await settle();
    assert.deepEqual(useBoard.getState().cards[0]?.wentBy, []);
    assert.deepEqual(sent, []);

    // Signed in, the host is known by id: a member named Dale is not the host.
    useBoard.setState({ me: "Dale" });
    useBoard.getState().visited(G1);
    await settle();
    assert.deepEqual(useBoard.getState().cards[0]?.wentBy, []);
    assert.deepEqual(sent, []);

    useBoard.setState({ rsvpHosts: [G1] });
    useBoard.getState().visited(G1);
    await settle();
    assert.deepEqual(useBoard.getState().cards[0]?.wentBy, ["Dale"]);
    assert.deepEqual(sent, [`/api/gatherings/${G1}/rsvp {"attended":true}`]);
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("a board that does not load, or throws, before an RSVP shows the line and sends nothing", async () => {
  const sent: unknown[] = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(String(input), init?.body);
    return new Response(JSON.stringify({ mine: {} }), { status: 200 });
  }) as typeof fetch;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const client = (load: () => Promise<unknown>) =>
    new Proxy({} as BoardClient, {
      get: (_t, key) => (key === "then" ? undefined : key === "load" ? load : async () => ({ ok: true })),
    });
  try {
    setBoardClient(client(async () => ({ ok: false, error: "The board did not load.", code: "api-unavailable" })));
    useBoard.setState({ remote: true, me: "Me", boardError: "", rsvpFailed: [], rsvpPending: [], cards: [card(G1)] });
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(sent, []);
    assert.deepEqual(useBoard.getState().cards[0]?.going, []);
    assert.deepEqual(useBoard.getState().rsvpFailed, [G1]);
    assert.deepEqual(useBoard.getState().rsvpPending, []);

    setBoardClient(client(async () => {
      throw new TypeError("Failed to fetch");
    }));
    useBoard.setState({ rsvpFailed: [] });
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(sent, []);
    assert.deepEqual(useBoard.getState().cards[0]?.going, []);
    assert.deepEqual(useBoard.getState().rsvpFailed, [G1]);
    assert.deepEqual(useBoard.getState().rsvpPending, []);
    assert.equal(useBoard.getState().boardError, "");
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("\"I went\" is saved first: the card changes only on success or rsvp-not-ready", async () => {
  const sent: unknown[] = [];
  let mode: "ok" | "not-ready" | "throw" | "forbidden" | "old-api" = "throw";
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname === `/api/gatherings/${G1}/rsvp`) {
      sent.push(JSON.parse(String(init?.body)));
      if (mode === "throw") throw new TypeError("Failed to fetch");
      if (mode === "not-ready") return new Response(JSON.stringify({ error: "rsvp-not-ready" }), { status: 503 });
      if (mode === "forbidden") return new Response(JSON.stringify({ error: "Not found.", api: "rsvp" }), { status: 404 });
      if (mode === "old-api") return new Response(JSON.stringify({ error: "Not found." }), { status: 404 });
      return new Response(JSON.stringify({ mine: { going: false, attended: true } }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  // The host of the card: one of the two roles (host, room steward) that mark who came.
  // Dated in the past: an undated gathering never opens marking (QA N2).
  const hosted = () => card(G1, { host: "Me", next: "2026-10-24", unverified: true, going: ["Me"] });
  try {
    setBoardClient(stubClient());
    useBoard.setState({ remote: true, admin: false, me: "Me", boardError: "", rsvpHosts: [G1], cards: [hosted()] });

    // fetch throws: nothing changes, and the banner says so.
    useBoard.getState().visited(G1);
    assert.deepEqual(useBoard.getState().cards[0]?.wentBy, [], "not marked before the server answers");
    await settle();
    assert.deepEqual(sent, [{ attended: true }]);
    assert.deepEqual(useBoard.getState().cards[0]?.wentBy, []);
    assert.equal(useBoard.getState().cards[0]?.unverified, true);
    assert.equal(useBoard.getState().boardError, RSVP_NOT_SAVED);

    // Any other refusal: the same.
    useBoard.setState({ boardError: "" });
    mode = "forbidden";
    useBoard.getState().visited(G1);
    await settle();
    assert.deepEqual(useBoard.getState().cards[0]?.wentBy, []);
    assert.equal(useBoard.getState().boardError, RSVP_NOT_SAVED);

    // Before 0049: kept on this device, no error.
    useBoard.setState({ boardError: "", cards: [hosted()] });
    mode = "not-ready";
    useBoard.getState().visited(G1);
    await settle();
    assert.deepEqual(useBoard.getState().cards[0]?.wentBy, ["Me"]);
    assert.equal(useBoard.getState().cards[0]?.unverified, false);
    assert.equal(useBoard.getState().boardError, "");

    // Saved on the server: marked.
    useBoard.setState({ boardError: "", cards: [hosted()] });
    mode = "ok";
    useBoard.getState().visited(G1);
    await settle();
    assert.deepEqual(useBoard.getState().cards[0]?.wentBy, ["Me"]);
    assert.equal(useBoard.getState().boardError, "");
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("signed in, the host view is chosen by id, not by name", () => {
  const theirs = card(G1, { host: "Dale", going: ["Tom", "Ann"], wentBy: ["Tom"] });
  const namesake = forViewer(theirs, { admin: false, name: "Dale", hosts: [], byId: true });
  assert.deepEqual(namesake.going, []);
  assert.deepEqual(namesake.wentBy, []);
  const host = forViewer(theirs, { admin: false, name: "Dale", hosts: [G1], byId: true });
  assert.deepEqual(host.going, ["Tom", "Ann"]);
  // On this device only (not signed in), the name still decides.
  assert.deepEqual(forViewer(theirs, { admin: false, name: "Dale", hosts: [] }).going, ["Tom", "Ann"]);
  // A seed card (not a server id) keeps the name rule even when signed in.
  const seed = card("seed-1", { host: "Dale", going: ["Tom"] });
  assert.deepEqual(forViewer(seed, { admin: false, name: "Dale", hosts: [], byId: true }).going, ["Tom"]);
});

test("Find's 'Write it up' re-reads RSVPs after a failed write-up, and shows a stale roll call", async () => {
  const reads: string[] = [];
  let attendance: "ok" | "stale" = "ok";
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname === "/api/rsvps" && (init?.method ?? "GET") === "GET") reads.push(url.pathname);
    if (url.pathname === `/api/gatherings/${G1}/attendance`) {
      return attendance === "ok"
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(JSON.stringify({ error: ROLL_CALL_STALE, api: "rsvp" }), { status: 409 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const base = stubClient();
  try {
    // The close saves, the write-up does not: the card is read again.
    setBoardClient(
      new Proxy(base, {
        get: (target, key, receiver) =>
          key === "createPost"
            ? async () => ({ ok: false as const, error: "Not saved." })
            : Reflect.get(target, key, receiver),
      }),
    );
    useBoard.setState({
      remote: true,
      admin: false,
      me: "Dale",
      boardError: "",
      rooms: ROOMS.map((room) => (room.id === "shop" ? { ...room, options: ["roll_call"] } : room)),
      rsvpHosts: [G1],
      rollCall: { [G1]: [{ userId: "h_tom", name: "Tom" }] },
      cards: [card(G1, { host: "Dale", next: "2026-10-31", going: ["Tom"] })],
    });
    const failed = await useBoard.getState().closeCard(G1, true, "", "Good.", ["Tom"], "", ["h_tom"]);
    await settle();
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.ok ? [] : failed.stops, ["Not saved."]);
    assert.equal(reads.length, 1, "RSVPs read again after the failed write-up");

    // The host cancels (which forgets the saved close), then a stale handle:
    // the host sees the plain line, and the list is read again.
    forgetSavedClose(G1);
    reads.length = 0;
    attendance = "stale";
    setBoardClient(base);
    const stale = await useBoard.getState().closeCard(G1, true, "", "Good.", ["Tom"], "", ["h_tom"]);
    await settle();
    assert.equal(stale.ok, false);
    assert.deepEqual(stale.ok ? [] : stale.stops, [ROLL_CALL_STALE]);
    assert.equal(reads.length, 1, "RSVPs read again after a stale roll call");
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("Design #126 M1: after a stale roll call, kept picks stay and dropped ones are named from the old list only", () => {
  const before = [
    { userId: "h_tom", name: "Tom" },
    { userId: "h_ann", name: "Ann" },
    { userId: "h_ben", name: "Ben" },
  ];
  // Ann and Ben left; Cal is new and was never on the host's list.
  const fresh = [
    { userId: "h_tom", name: "Tom" },
    { userId: "h_cal", name: "Cal" },
  ];
  const next = resetRollPicks(before, fresh, ["h_tom", "h_ann", "h_ben"]);
  assert.deepEqual(next, { keys: ["h_tom"], came: ["Tom"], cameIds: ["h_tom"], dropped: ["Ann", "Ben"] });
  assert.equal(droppedLine(next.dropped), "No longer on this list, so not marked: Ann, Ben.");
  assert.equal(droppedLine([]), "");
  // Unpicked people who left are not named.
  assert.deepEqual(resetRollPicks(before, fresh, ["h_tom"]).dropped, []);
  assert.equal(ROLL_CALL_STALE, "That list is out of date.");
});

const G3 = "8d3b4c5e-6f7a-4c8d-8e9f-1a2b3c4d5e6f";

test("QA S3 #2: the close saves but the write-up fails; the retry reuses the close's roll call and closes once", async () => {
  const sent: { path: string; body: unknown }[] = [];
  const drafts: { cameIds?: string[]; came: string[] }[] = [];
  let postFails = true;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (init?.method === "POST") sent.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
    if (url.pathname === `/api/gatherings/${G3}/attendance`) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    const base = stubClient();
    const createPost: BoardClient["createPost"] = async (draft) => {
      drafts.push({ came: draft.came, ...(draft.cameIds ? { cameIds: draft.cameIds } : {}) });
      if (postFails) return { ok: false, error: "Not allowed." };
      return base.createPost(draft);
    };
    setBoardClient(new Proxy(base, { get: (t, key) => (key === "createPost" ? createPost : Reflect.get(t, key)) }));
    useBoard.setState({
      remote: true,
      admin: false,
      me: "Dale",
      boardError: "",
      rooms: ROOMS.map((room) => (room.id === "shop" ? { ...room, options: ["roll_call"] } : room)),
      rsvpHosts: [G3],
      rollCall: { [G3]: [{ userId: "h_tom", name: "Tom" }] },
      cards: [card(G3, { host: "Dale", next: "2026-10-31", going: ["Tom"] })],
    });
    assert.equal(closeSavedFor(G3), false);
    const first = await useBoard.getState().closeCard(G3, true, "", "Good morning.", ["Tom"], "", ["h_tom"]);
    assert.equal(first.ok, false);
    // Design #126 L1: the form locks its chips and says who came is saved.
    assert.equal(closeSavedFor(G3), true);
    assert.deepEqual(savedCloseNames(G3, "2026-10-31"), ["Tom"]);
    // The close saved, so Tom left the list: the form now has no picks to send.
    useBoard.setState({ rollCall: { [G3]: [] } });
    postFails = false;
    const retry = await useBoard.getState().closeCard(G3, true, "", "Good morning.", ["Tom"], "", []);
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(sent.filter((s) => s.path.endsWith("/attendance")).length, 1, "the date is closed once");
    assert.deepEqual(drafts.map((d) => d.cameIds), [["h_tom"], ["h_tom"]]);
    assert.equal(closeSavedFor(G3), false, "cleared once the write-up is filed");
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("Design #126 M1: dropped picks accumulate, and anyone back on the list leaves the line", () => {
  const tom = { userId: "h_tom", name: "Tom" };
  const ann = { userId: "h_ann", name: "Ann" };
  const ben = { userId: "h_ben", name: "Ben" };
  const cal = { userId: "h_cal", name: "Cal" };
  const names = (people: { name: string }[]) => droppedLine(people.map((p) => p.name));
  // First 409: Ann left. Cal is new and is never named.
  let shown = nextDropped([], [tom, ann, ben], [tom, ben, cal], ["h_tom", "h_ann", "h_ben"]);
  assert.equal(names(shown), "No longer on this list, so not marked: Ann.");
  // Second 409: Ben left too. Ann is still named.
  shown = nextDropped(shown, [tom, ben, cal], [tom, cal], ["h_tom", "h_ben"]);
  assert.equal(names(shown), "No longer on this list, so not marked: Ann, Ben.");
  // Reload brings Ann back: she leaves the line, and stays unticked.
  const back = [tom, ann, cal];
  shown = nextDropped(shown, [tom, cal], back, ["h_tom"]);
  assert.equal(names(shown), "No longer on this list, so not marked: Ben.");
  assert.deepEqual(resetRollPicks([tom, cal], back, ["h_tom"]).keys, ["h_tom"]);
  // Everyone back: the line is empty. Submit clears the list (shown = []).
  assert.equal(names(nextDropped(shown, [tom, ann, cal], [tom, ann, ben, cal], ["h_tom"])), "");
  assert.equal(names([]), "");
});

test("QA S3 #1: a saved close is for one date; Cancel, a new week, or sign-out calls attendance fresh", async () => {
  const G4 = "9e4c5d6f-7a8b-4d9e-8fa0-2b3c4d5e6f70";
  const sent: { path: string; body: { userIds: string[] } }[] = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname === `/api/gatherings/${G4}/attendance`) {
      sent.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const base = stubClient();
  const failing = new Proxy(base, {
    get: (t, key) => (key === "createPost" ? async () => ({ ok: false as const, error: "Not saved." }) : Reflect.get(t, key)),
  });
  const week = (next: string, roll: { userId: string; name: string }[]) =>
    useBoard.setState({
      remote: true,
      admin: false,
      me: "Dale",
      boardError: "",
      rooms: ROOMS.map((room) => (room.id === "shop" ? { ...room, options: ["roll_call"] } : room)),
      rsvpHosts: [G4],
      rollCall: { [G4]: roll },
      cards: [card(G4, { host: "Dale", next, going: roll.map((p) => p.name) })],
    });
  try {
    setBoardClient(failing);
    // Week 1: the close saves with Tom, the write-up fails, the host cancels.
    week("2026-10-31", [{ userId: "h_tom", name: "Tom" }]);
    await useBoard.getState().closeCard(G4, true, "", "Good.", ["Tom"], "", ["h_tom"]);
    assert.equal(closeSavedFor(G4, "2026-10-31"), true);
    forgetSavedClose(G4);
    assert.equal(closeSavedFor(G4), false, "Cancel forgets it");
    // Week 2 with Ann: attendance is called again, with Ann, not week 1's Tom.
    week("2026-11-07", [{ userId: "h_ann", name: "Ann" }]);
    await useBoard.getState().closeCard(G4, true, "", "Good.", ["Ann"], "", ["h_ann"]);
    assert.deepEqual(sent.map((s) => s.body.userIds), [["h_tom"], ["h_ann"]]);
    // Without a Cancel, a new date still closes fresh (the saved close is per date).
    week("2026-11-14", [{ userId: "h_ben", name: "Ben" }]);
    assert.equal(closeSavedFor(G4, "2026-11-14"), false);
    await useBoard.getState().closeCard(G4, true, "", "Good.", ["Ben"], "", ["h_ben"]);
    assert.deepEqual(sent.map((s) => s.body.userIds).at(-1), ["h_ben"]);
    // Sign-out clears it.
    assert.equal(closeSavedFor(G4), true);
    useBoard.getState().disconnectRemote();
    assert.equal(closeSavedFor(G4), false, "sign-out forgets it");
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("Design #126 M1: the saved-close line names who came, or says the close is saved", () => {
  assert.equal(whoCameSavedLine(["Ann", "Ben"]), "Who came is already saved: Ann, Ben. Send the write-up again.");
  assert.equal(whoCameSavedLine([]), "This close is already saved. Send the write-up again.");
});

test("Design #126 L2: two different people named Ann both show in the dropped line", () => {
  const ann1 = { userId: "h_ann1", name: "Ann" };
  const ann2 = { userId: "h_ann2", name: "Ann" };
  const shown = nextDropped([], [ann1, ann2], [], ["h_ann1", "h_ann2"]);
  assert.equal(droppedLine(shown.map((p) => p.name)), "No longer on this list, so not marked: Ann, Ann.");
});

test("Design #126 M1: after a saved close, an empty re-read roll and a reopened form, the retry's There: line keeps the names", async () => {
  const G5 = "0f5d6e7a-8b9c-4eaf-9fb1-3c4d5e6f7a81";
  const drafts: { came: string[]; cameIds?: string[] }[] = [];
  let postFails = true;
  let closes = 0;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname === `/api/gatherings/${G5}/attendance`) {
      closes += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const base = stubClient();
  const createPost: BoardClient["createPost"] = async (draft) => {
    drafts.push({ came: draft.came, ...(draft.cameIds ? { cameIds: draft.cameIds } : {}) });
    return postFails ? { ok: false, error: "Not saved." } : base.createPost(draft);
  };
  try {
    setBoardClient(new Proxy(base, { get: (t, key) => (key === "createPost" ? createPost : Reflect.get(t, key)) }));
    useBoard.setState({
      remote: true,
      admin: false,
      me: "Dale",
      boardError: "",
      rooms: ROOMS.map((room) => (room.id === "shop" ? { ...room, options: ["roll_call"] } : room)),
      rsvpHosts: [G5],
      rollCall: { [G5]: [{ userId: "h_ann", name: "Ann" }, { userId: "h_ben", name: "Ben" }] },
      cards: [card(G5, { host: "Dale", next: "2026-10-31", going: ["Ann", "Ben"] })],
    });
    const first = await useBoard.getState().closeCard(G5, true, "", "Good.", ["Ann", "Ben"], "", ["h_ann", "h_ben"]);
    assert.equal(first.ok, false);
    // The re-read roll is empty; a remounted or reopened form still reads the saved close.
    useBoard.setState({ rollCall: { [G5]: [] } });
    assert.deepEqual(savedCloseNames(G5, "2026-10-31"), ["Ann", "Ben"]);
    assert.equal(whoCameSavedLine(savedCloseNames(G5, "2026-10-31") ?? []), "Who came is already saved: Ann, Ben. Send the write-up again.");
    // The reopened form has no picks: came [] and cameIds []. The write-up still names Ann and Ben.
    postFails = false;
    const retry = await useBoard.getState().closeCard(G5, true, "", "Good.", [], "", []);
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(closes, 1);
    assert.deepEqual(drafts.at(-1), { came: ["Ann", "Ben"], cameIds: ["h_ann", "h_ben"] });
    assert.equal(savedCloseNames(G5, "2026-10-31"), null, "cleared once filed");
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("QA S3: after the composer's saved close, Find's close is locked to its names and does not close again", async () => {
  const G6 = "1a6e7f8b-9cad-4fb0-8ac2-4d5e6f7a8b92";
  const drafts: { came: string[]; cameIds?: string[] }[] = [];
  let postFails = true;
  const closes: unknown[] = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname === `/api/gatherings/${G6}/attendance`) {
      closes.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const base = stubClient();
  const createPost: BoardClient["createPost"] = async (draft) => {
    drafts.push({ came: draft.came, ...(draft.cameIds ? { cameIds: draft.cameIds } : {}) });
    return postFails ? { ok: false, error: "Not saved." } : base.createPost(draft);
  };
  try {
    setBoardClient(new Proxy(base, { get: (t, key) => (key === "createPost" ? createPost : Reflect.get(t, key)) }));
    const open = card(G6, { host: "Dale", next: "2026-10-31", going: ["Tom", "Ann"] });
    useBoard.setState({
      remote: true,
      admin: false,
      me: "Dale",
      boardError: "",
      rooms: ROOMS.map((room) => (room.id === "shop" ? { ...room, options: ["roll_call"] } : room)),
      rsvpHosts: [G6],
      rollCall: { [G6]: [{ userId: "h_tom", name: "Tom" }, { userId: "h_ann", name: "Ann" }] },
      cards: [open],
    });
    // The composer files the write-up: the close saves with Tom, the post fails.
    const filed = await useBoard.getState().file(
      { ...blankDraft("shop"), type: "hosted", claim: "Good.", on: "2026-10-31", next: "", came: ["Tom"], cardId: G6 },
      { cameIds: ["h_tom"] },
    );
    assert.equal(filed.ok, false);
    // Find opens on the same date: locked to Tom, shown before any submit.
    assert.deepEqual(savedCloseNames(G6, "2026-10-31"), ["Tom"]);
    // Even a pick of Ann does not reach the server or the write-up.
    postFails = false;
    const retry = await useBoard.getState().closeCard(G6, true, "", "Good.", ["Ann"], "", ["h_ann"]);
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(closes.length, 1, "attendance once, from the composer");
    assert.deepEqual(drafts.at(-1), { came: ["Tom"], cameIds: ["h_tom"] });
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

async function lockedRun(
  first: { happened: boolean; came: string[]; ids: string[] } | { composer: { came: string[]; ids: string[] } },
  retry: (state: ReturnType<typeof useBoard.getState>) => Promise<{ ok: boolean }>,
) {
  const G7 = "2b7f8a9c-0dbe-4ac1-9bd3-5e6f7a8b9ca3";
  const drafts: { claim: string; came: string[]; named: string; cameIds?: string[]; happened?: boolean }[] = [];
  const bodies: Record<string, unknown>[] = [];
  let postFails = true;
  let closes = 0;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname === `/api/gatherings/${G7}/attendance`) {
      closes += 1;
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const base = stubClient();
  const createPost: BoardClient["createPost"] = async (draft) => {
    drafts.push({ claim: draft.claim, came: draft.came, named: draft.named, ...(draft.cameIds ? { cameIds: draft.cameIds } : {}), ...(draft.happened !== undefined ? { happened: draft.happened } : {}) });
    return postFails ? { ok: false, error: "Not saved." } : base.createPost(draft);
  };
  try {
    forgetSavedClose();
    setBoardClient(new Proxy(base, { get: (t, key) => (key === "createPost" ? createPost : Reflect.get(t, key)) }));
    useBoard.setState({
      remote: true,
      admin: false,
      me: "Dale",
      boardError: "",
      rooms: ROOMS.map((room) => (room.id === "shop" ? { ...room, options: ["roll_call"] } : room)),
      rsvpHosts: [G7],
      rollCall: { [G7]: [{ userId: "h_ann", name: "Ann" }, { userId: "h_ben", name: "Ben" }] },
      cards: [card(G7, { host: "Dale", next: "2026-10-31", going: ["Ann", "Ben"] })],
    });
    const failed =
      "composer" in first
        ? await useBoard.getState().file(
            { ...blankDraft("shop"), type: "hosted", claim: "Good.", on: "2026-10-31", next: "", came: first.composer.came, cardId: G7 },
            { cameIds: first.composer.ids },
          )
        : await useBoard.getState().closeCard(G7, first.happened, "", "", first.came, "", first.ids);
    assert.equal(failed.ok, false);
    postFails = false;
    const done = await retry(useBoard.getState());
    assert.equal(done.ok, true);
    return { G7, drafts, closes, bodies };
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
}

test("QA S2: saved close with Tom, failed write-up, then 'It did not' files came: [] and no handles", async () => {
  const { drafts, closes } = await lockedRun({ happened: true, came: ["Ann", "Ben"], ids: ["h_ann", "h_ben"] }, (s) =>
    s.closeCard("2b7f8a9c-0dbe-4ac1-9bd3-5e6f7a8b9ca3", false, "", "", ["Ann"], "", ["h_ann"]),
  );
  assert.equal(closes, 1);
  assert.equal(drafts.at(-1)?.claim, "It did not happen.");
  assert.deepEqual(drafts.at(-1)?.came, []);
  assert.equal(drafts.at(-1)?.happened, false);
  assert.ok(!drafts.at(-1)?.cameIds?.length, "no handles");
});

test("QA S2: the composer's did-not-happen write-up drops the kept names and handles", async () => {
  const { drafts } = await lockedRun({ composer: { came: ["Ben"], ids: ["h_ben"] } }, (s) =>
    s.file(
      { ...blankDraft("shop"), type: "hosted", claim: "Rained out.", on: "2026-10-31", next: "", came: ["Ben"], named: "Ben", cardId: "2b7f8a9c-0dbe-4ac1-9bd3-5e6f7a8b9ca3", happened: false },
      { cameIds: ["h_ben"] },
    ),
  );
  assert.deepEqual(drafts.at(-1), { claim: "Rained out.", came: [], named: "", cameIds: [], happened: false });
});

test("QA S3: a did-not-happen close sends happened: false and no member ids", async () => {
  const { bodies } = await lockedRun({ happened: false, came: ["Ann"], ids: ["h_ann"] }, (s) =>
    s.closeCard("2b7f8a9c-0dbe-4ac1-9bd3-5e6f7a8b9ca3", false, "", "", [], "", []),
  );
  assert.equal(bodies[0]?.happened, false);
  assert.deepEqual(bodies[0]?.userIds, []);
});

test("Design #126 M1: after a saved 'It did not' close, a retry files it did not, naming no one", async () => {
  const { drafts, closes } = await lockedRun({ happened: false, came: [], ids: [] }, (s) =>
    s.closeCard("2b7f8a9c-0dbe-4ac1-9bd3-5e6f7a8b9ca3", true, "", "", ["Ann"], "", ["h_ann"]),
  );
  assert.equal(closes, 1);
  assert.equal(drafts.at(-1)?.claim, "It did not happen.");
  assert.deepEqual(drafts.at(-1)?.came, []);
});

test("Design #126 L1: the composer's retry drops a named person the saved close did not mark", async () => {
  const { drafts, closes } = await lockedRun({ composer: { came: ["Ben"], ids: ["h_ben"] } }, (s) =>
    s.file(
      { ...blankDraft("shop"), type: "hosted", claim: "Good.", on: "2026-10-31", next: "", came: ["Ann"], named: "Ann", cardId: "2b7f8a9c-0dbe-4ac1-9bd3-5e6f7a8b9ca3" },
      { cameIds: ["h_ann"] },
    ),
  );
  assert.equal(closes, 1);
  assert.deepEqual(drafts.at(-1), { claim: "Good.", came: ["Ben"], named: "", cameIds: ["h_ben"] });
});

test("a steward marks who came WITHOUT closing the date (Design #126 H1)", async () => {
  const sent: { path: string; body: unknown }[] = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (init?.method === "POST") sent.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
    if (url.pathname === `/api/gatherings/${G1}/attendance`) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    setBoardClient(stubClient());
    // A date that has passed: marking is open (QA F4).
    const open = card(G1, { host: "Dale", room: "shop", next: "2026-10-24", going: ["Tom", "Ann"] });
    useBoard.setState({
      remote: true,
      admin: false,
      me: "Sam",
      stewardRooms: ["shop"],
      rsvpHosts: [],
      rollCall: { [G1]: [{ userId: "h_tom", name: "Tom" }, { userId: "h_ann", name: "Ann" }] },
      cards: [open],
    });
    const result = await useBoard.getState().markWhoCame(G1, { userIds: ["h_tom"], names: ["Tom"] });
    assert.deepEqual(result, { ok: true });
    const attendance = sent.filter((s) => s.path.endsWith("/attendance"));
    assert.deepEqual(attendance, [{ path: `/api/gatherings/${G1}/attendance`, body: { userIds: ["h_tom"], close: false } }]);
    // The date stays open: same next date, nobody's going reset, no write-up posted.
    const after = useBoard.getState().cards[0]!;
    assert.equal(after.next, "2026-10-24");
    assert.deepEqual(after.going, ["Tom", "Ann"]);
    assert.ok(after.wentBy.includes("Tom"));
    assert.equal(sent.some((s) => !s.path.endsWith("/attendance") && s.path.includes("post")), false);

    // A member who is not host or steward cannot.
    useBoard.setState({ me: "Maria", stewardRooms: [], cards: [open] });
    sent.length = 0;
    const refused = await useBoard.getState().markWhoCame(G1, { userIds: ["h_tom"], names: ["Tom"] });
    assert.equal(refused.ok, false);
    assert.deepEqual(sent, []);
    // Nor an admin as an admin.
    useBoard.setState({ me: "Josh", admin: true, stewardRooms: [], cards: [open] });
    assert.equal((await useBoard.getState().markWhoCame(G1, { userIds: ["h_tom"], names: ["Tom"] })).ok, false);
    assert.deepEqual(sent, []);
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
    useBoard.setState({ admin: false, stewardRooms: [] });
  }
});

test("the steward's 'Mark who came' form has no next date, no outcome buttons and no write-up", () => {
  const src = readFileSync(new URL("../../components/board/find-view.tsx", import.meta.url), "utf8");
  const start = src.indexOf("export function StewardRollCall");
  const end = src.indexOf("\n}\n", start);
  const form = src.slice(start, end);
  assert.ok(start > 0);
  assert.match(form, /Save who came/);
  assert.match(form, /aria-disabled=\{sending \|\| undefined\}/);
  assert.match(form, /markWhoCame\(/);
  assert.match(form, /Reload the list/);
  assert.match(form, /role="status"/);
  for (const banned of [/Next date/, /It happened/, /It did not/, /closeCard/, /How it went/, /close: true/]) {
    assert.doesNotMatch(form, banned);
  }
  assert.match(src, /!isHost && takesRoll\(card\) && rollOn && card\.next && started \? <StewardRollCall card=\{card\} \/> : null/);
  assert.equal(savedWhoCameLine(["Ann", "Ben"]), "Saved: Ann, Ben.");
});

test("QA F4: \"I went\" and a steward's marks wait for the start, and need a \"going\"", async () => {
  const sent: string[] = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (init?.method === "POST") sent.push(`${url.pathname} ${String(init.body)}`);
    return new Response(JSON.stringify({ ok: true, mine: { going: true, attended: true } }), { status: 200 });
  }) as typeof fetch;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    setBoardClient(stubClient());
    // Next year: not started.
    useBoard.setState({
      remote: true,
      admin: false,
      me: "Dale",
      rsvpHosts: [G1],
      stewardRooms: [],
      cards: [card(G1, { host: "Dale", room: "shop", next: "2099-01-01", going: ["Dale", "Tom"] })],
    });
    useBoard.getState().visited(G1);
    await settle();
    const early = await useBoard.getState().markWhoCame(G1, { userIds: ["h_tom"], names: ["Tom"] });
    assert.equal(early.ok, false);
    assert.deepEqual(early.ok ? [] : early.stops, [MARK_TOO_EARLY]);
    assert.deepEqual(sent, []);
    // Started, but Dale is not going: "I went" sends nothing.
    useBoard.setState({ cards: [card(G1, { host: "Dale", room: "shop", next: "2026-10-24", going: ["Tom"] })] });
    useBoard.getState().visited(G1);
    await settle();
    assert.deepEqual(sent, []);
    // A steward takes a mark back: sent as unmark, and the name leaves the card.
    useBoard.setState({ cards: [card(G1, { host: "Dale", room: "shop", next: "2026-10-24", going: ["Tom"], wentBy: ["Tom"] })] });
    const back = await useBoard.getState().markWhoCame(G1, { userIds: [], names: [], unmark: ["h_tom"], unmarkNames: ["Tom"] });
    assert.equal(back.ok, true);
    assert.deepEqual(sent, [`/api/gatherings/${G1}/attendance {"userIds":[],"close":false,"unmark":["h_tom"]}`]);
    assert.deepEqual(useBoard.getState().cards[0]?.wentBy, []);
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});

test("QA F4 + Design lows: the form starts from saved marks, sends unmark, and buttons use aria-disabled guards", () => {
  const src = readFileSync(new URL("../../components/board/find-view.tsx", import.meta.url), "utf8");
  // Not before the start, and only once going.
  assert.match(src, /const started = markOpen\(\{ date: card\.next, time: card\.time \}, new Date\(\)\);/);
  assert.match(src, /const canSayWent = !went && started && going;/);
  // "I went": aria-disabled with a guard, never native disabled.
  assert.match(src, /aria-disabled=\{!canSayWent \|\| undefined\}/);
  assert.match(src, /if \(!canSayWent\) return;\s*visited\(card\.id\);/);
  assert.equal(/disabled=\{went\}/.test(src), false);
  // The host's chips wait for the start too.
  assert.match(src, /takesRoll\(card\) && rollOn && started && roll\.length > 0/);
  // Existing marks pre-checked; un-picked ones go back as unmark.
  assert.match(src, /const marked = roll\.filter\(\(person\) => person\.came\);/);
  assert.match(src, /unmark: back\.map\(\(person\) => person\.userId\)/);
  // Host close: one submit at a time.
  assert.match(src, /if \(submitting\) return;/);
  assert.match(src, /\.finally\(\(\) => setSubmitting\(false\)\)/);
  assert.equal((src.match(/aria-busy=\{submitting \|\| undefined\}/g) ?? []).length, 2);
  assert.match(src, /aria-disabled:opacity-70/);
  // A saved "did not happen" close says so.
  assert.match(src, /saved\.happened \? whoCameSavedLine\(savedNames \?\? \[\]\) : DID_NOT_SAVED_LINE/);
});

// ---- Josh's card answers via CoS, Oct 30 12:47 PM ET ----

function gatheringFetch() {
  const saves: Record<string, unknown>[] = [];
  const rsvps: string[] = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname === "/api/gatherings" && init?.method === "POST") {
      saves.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ gathering: {} }), { status: 200 });
    }
    if (url.pathname.includes("/rsvp") || url.pathname.includes("/attendance")) {
      rsvps.push(url.pathname);
      return new Response(JSON.stringify({ mine: {} }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { saves, rsvps, restore: () => (globalThis.fetch = priorFetch) };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("Josh 1 (app): the host's 'special event' tick is saved with the gathering; a steward's edit leaves it alone", async () => {
  const net = gatheringFetch();
  try {
    setBoardClient(stubClient());
    useBoard.setState({ remote: true, me: "Dale", boardError: "", rsvpHosts: [], cards: [] });
    useBoard.getState().addCard({ room: "shop", kind: "meeting", name: "Lifts", place: "Garage", time: "7", host: "Dale", next: "2026-11-07", special: true });
    await settle();
    assert.equal(net.saves.at(-1)?.special, true);
    const id = useBoard.getState().cards[0]!.id;
    useBoard.getState().updateCard(id, { special: false });
    await settle();
    assert.equal(net.saves.at(-1)?.special, false);
    assert.equal(useBoard.getState().cards[0]?.special, false);
    // Sam (a steward, not the host) edits: the body carries no "special".
    useBoard.setState({ me: "Sam", rsvpHosts: [] });
    useBoard.getState().updateCard(id, { name: "Saturday lifts" });
    await settle();
    assert.equal("special" in (net.saves.at(-1) ?? {}), false);
  } finally {
    net.restore();
    setBoardClient(null);
  }
});

test("Josh 1 (app): the server's 'special' reaches the card", async () => {
  const { loadGatherings } = await import("./gathering-public.ts");
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        gatherings: [
          { id: G1, roomId: "shop", title: "A", special: true },
          { id: G2, roomId: "shop", title: "B" },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    const loaded = await loadGatherings();
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.ok ? loaded.gatherings.map((row) => row.special) : [], [true, false]);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("Josh 2 (app): a gathering that is not special shows no going, no came, no roll call, and sends no RSVP or mark", async () => {
  const plain = card(G1, { special: false, going: ["Ann"], wentBy: ["Dale", "Ann"], next: "2026-10-28" });
  const viewers: RsvpViewer[] = [{ admin: false, name: "Dale", hosts: [G1] }, { admin: false, name: "Sam", stewardRooms: ["shop"] }];
  for (const viewer of viewers) {
    const seen = forViewer(plain, viewer);
    assert.equal(seesGoing(seen), false);
    assert.equal(seesCame(seen), false);
    assert.equal(takesRoll(seen), false);
    // The same card, special, shows them.
    const special = forViewer({ ...plain, special: true }, viewer);
    assert.equal(seesGoing(special) && takesRoll(special), true);
  }
  const net = gatheringFetch();
  try {
    setBoardClient(stubClient());
    useBoard.setState({ remote: true, me: "Sam", stewardRooms: ["shop"], boardError: "", rsvpFailed: [], rsvpPending: [], cards: [plain] });
    useBoard.getState().rsvp(G1);
    useBoard.getState().visited(G1);
    await settle();
    assert.deepEqual(net.rsvps, []);
    assert.deepEqual(useBoard.getState().cards[0]?.going, ["Ann"]);
    assert.deepEqual(useBoard.getState().rsvpPending, []);
  } finally {
    net.restore();
    setBoardClient(null);
    useBoard.setState({ stewardRooms: [] });
  }
});

test("Josh 4 (app): a host's move sends the new room (the server checks they joined it)", async () => {
  const net = gatheringFetch();
  try {
    setBoardClient(stubClient());
    useBoard.setState({ remote: true, me: "Dale", rsvpHosts: [G1], boardError: "", cards: [card(G1)] });
    useBoard.getState().updateCard(G1, { room: "county" });
    await settle();
    assert.equal(net.saves.at(-1)?.roomId, "county");
    assert.equal(net.saves.at(-1)?.special, true, "the move keeps it a special event");
  } finally {
    net.restore();
    setBoardClient(null);
  }
});

test("Josh 5 (app): a steward's new date is saved with the gathering", async () => {
  const net = gatheringFetch();
  try {
    setBoardClient(stubClient());
    useBoard.setState({ remote: true, me: "Sam", stewardRooms: ["shop"], rsvpHosts: [], boardError: "", cards: [card(G1, { next: "2026-10-31" })] });
    useBoard.getState().updateCard(G1, { next: "2026-11-07" });
    await settle();
    assert.equal(net.saves.at(-1)?.date, "2026-11-07");
    assert.equal("special" in (net.saves.at(-1) ?? {}), false);
    assert.equal(useBoard.getState().cards[0]?.next, "2026-11-07");
  } finally {
    net.restore();
    setBoardClient(null);
    useBoard.setState({ stewardRooms: [] });
  }
});
