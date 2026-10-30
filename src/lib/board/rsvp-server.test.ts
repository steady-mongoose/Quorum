import "./test-storage.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { forViewer, newCard, seesCame, seesGoing, takesRoll, type MeetingCard } from "./model.ts";
import { SEED_CARDS } from "./seed-cards.ts";
import { ROOMS } from "./model.ts";
import {
  applyServerRsvps,
  CAME_NOT_SAVED,
  ROLL_CALL_STALE,
  cameIdsFor,
  deviceRsvpMoves,
  rollCallPeople,
  RSVP_NOT_SAVED,
  toggleRoll,
  type RsvpList,
} from "./rsvp-api.ts";
import { setBoardClient, type BoardClient } from "./client.ts";
import { useBoard } from "./store.ts";

const G1 = "6b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const G2 = "7c2a3b4d-5e6f-4b7c-9d8e-0f1a2b3c4d5e";

function card(id: string, over: Partial<MeetingCard> = {}): MeetingCard {
  return newCard({ id, room: "shop", kind: "meeting", name: "Lifts", place: "Garage", time: "7", host: "Dale", ...over });
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

test("an admin's board gets everyone, and the roll call carries member ids", () => {
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
  const out = applyServerRsvps([card(G1)], list, { me: "Me", gatheringIds: new Set([G1]) });
  assert.deepEqual(out[0]?.going, ["Me", "Tom"]);
  assert.deepEqual(out[0]?.wentBy, ["Tom"]);
  assert.deepEqual(rollCallPeople(list, "Me")[G1], [
    { userId: "u-me", name: "Me" },
    { userId: "u-tom", name: "Tom" },
  ]);
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

  // Steward of shop: going and who came on G1 and G2 (Josh, 9:24 PM ET);
  // nothing in county; no roll call, because a steward does not mark.
  const steward: RsvpList = { viewer: "u-me", admin: false, hosts: [], stewardRooms: ["shop"], rsvps: rows };
  const stewarded = applyServerRsvps(cards, steward, { me: "Me", gatheringIds: ids });
  assert.deepEqual(stewarded[0]?.going, ["Tom"]);
  assert.deepEqual(stewarded[0]?.wentBy.sort(), ["Ann", "Tom"]);
  assert.deepEqual(stewarded[2]?.wentBy, []);
  assert.deepEqual(stewarded[1]?.going, ["Tom"]);
  assert.deepEqual(stewarded[2]?.going, []);
  assert.deepEqual(rollCallPeople(steward, "Me"), {});
});

test("forViewer: admin, host, steward and member each see what Josh allowed", () => {
  const full = card(G1, { host: "Dale", room: "shop", going: ["Ann", "Me", "Tom"], wentBy: ["Tom", "Me"] });
  const admin = forViewer(full, { admin: true, name: "Me" });
  assert.equal(admin.seeing, "all");
  assert.deepEqual(admin.going, ["Ann", "Me", "Tom"]);
  assert.ok(seesGoing(admin) && seesCame(admin) && takesRoll(admin));

  const host = forViewer(full, { admin: false, name: "Dale" });
  assert.equal(host.seeing, "host");
  assert.deepEqual(host.wentBy, ["Tom", "Me"]);
  assert.ok(seesGoing(host) && seesCame(host) && takesRoll(host));
  // Host by server id, too.
  assert.equal(forViewer(full, { admin: false, name: "Me", hosts: [G1] }).seeing, "host");

  const steward = forViewer(full, { admin: false, name: "Me", stewardRooms: ["shop"] });
  assert.equal(steward.seeing, "steward");
  assert.deepEqual(steward.going, ["Ann", "Me", "Tom"]);
  // Reads who came (Josh, 9:24 PM ET); does not mark it.
  assert.deepEqual(steward.wentBy, ["Tom", "Me"]);
  assert.ok(seesGoing(steward) && seesCame(steward));
  assert.equal(takesRoll(steward), false);

  const otherRoom = forViewer(full, { admin: false, name: "Me", stewardRooms: ["county"] });
  assert.equal(otherRoom.seeing, undefined);
  assert.deepEqual(otherRoom.going, ["Me"]);
  assert.deepEqual(otherRoom.wentBy, ["Me"]);

  const member = forViewer({ ...full, seeing: "all" }, { admin: false, name: "Me" });
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
    assert.deepEqual(attendance, [{ path: `/api/gatherings/${G1}/attendance`, body: { userIds: ["u-tom"], close: true, seen: ["u-tom", "u-ann"] } }]);
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
    useBoard.setState({ remote: true, admin: false, me: "Maria", rsvpHosts: [], cards: [card(G1, { host: "Dale" })] });
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
  // The host of the card: the only kind of non-admin who marks who came.
  const hosted = () => card(G1, { host: "Me", unverified: true });
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

    // A stale handle: the host sees the plain line, and the list is read again.
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
