import "./test-storage.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { forViewer, newCard, type MeetingCard } from "./model.ts";
import { SEED_CARDS } from "./seed-cards.ts";
import { applyServerRsvps, deviceRsvpMoves, rsvpIdsByName, type RsvpList } from "./rsvp-api.ts";
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
    rsvps: [
      { gatheringId: G1, userId: "u-me", name: "Server Name", going: true, attended: false },
      { gatheringId: G1, userId: "u-tom", name: "Tom", going: true, attended: true },
    ],
  };
  const cards = [card(G1, { going: ["Ann"], wentBy: ["Ann"] }), card("brief", { going: ["Ann"] })];
  const out = applyServerRsvps(cards, list, { me: "Me", gatheringIds: new Set([G1]) });
  assert.deepEqual(out[0]?.going, ["Me"]);
  assert.deepEqual(out[0]?.wentBy, []);
  // A card the server does not list keeps the device's data, and forViewer still trims it.
  assert.deepEqual(out[1]?.going, ["Ann"]);
  assert.deepEqual(forViewer(out[1]!, { admin: false, name: "Me" }).going, []);
  assert.equal(rsvpIdsByName(list, "Me").size, 0);
});

test("an admin's board gets everyone, and roll call maps names to ids", () => {
  const list: RsvpList = {
    viewer: "u-me",
    admin: true,
    rsvps: [
      { gatheringId: G1, userId: "u-me", name: "Josh", going: true, attended: false },
      { gatheringId: G1, userId: "u-tom", name: "Tom", going: true, attended: true },
    ],
  };
  const out = applyServerRsvps([card(G1)], list, { me: "Me", gatheringIds: new Set([G1]) });
  assert.deepEqual(out[0]?.going, ["Me", "Tom"]);
  assert.deepEqual(out[0]?.wentBy, ["Tom"]);
  assert.equal(rsvpIdsByName(list, "Me").get(G1)?.get("Tom"), "u-tom");
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

test("a signed-in RSVP is saved on the server first; before 0049 it stays on the device", async () => {
  const sent: unknown[] = [];
  let status = 200;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    if (url.pathname === `/api/gatherings/${G1}/rsvp`) {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(status === 200 ? { mine: {} } : { error: "RSVPs are not on the server yet." }), { status });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    setBoardClient(stubClient());
    useBoard.setState({ remote: true, me: "Me", boardError: "", cards: [card(G1)] });
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(sent, [{ going: true }]);
    assert.deepEqual(useBoard.getState().cards[0]?.going, ["Me"]);

    status = 503;
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(sent.at(-1), { going: false });
    assert.deepEqual(useBoard.getState().cards[0]?.going, []);
    assert.equal(useBoard.getState().boardError, "");

    status = 403;
    useBoard.getState().rsvp(G1);
    await settle();
    assert.deepEqual(useBoard.getState().cards[0]?.going, []);
    assert.notEqual(useBoard.getState().boardError, "");
  } finally {
    globalThis.fetch = priorFetch;
    setBoardClient(null);
  }
});
