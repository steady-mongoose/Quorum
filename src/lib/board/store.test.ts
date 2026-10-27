import "./test-storage.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock } from "node:test";
import test from "node:test";
import { setBoardClient, type BoardClient, type BoardSnapshot } from "./client.ts";
import { removalFailedCopy, userFacingError } from "./errors.ts";
import type { HomePayload } from "./home.ts";
import { blankDraft, newCard, todayIso, weekFor, type MeetingCard, type Post } from "./model.ts";
import { scrollRestoredCard } from "./scroll-card.ts";
import { REMOVAL_UNDO_MS, UNDO_TTL_MS, dropSampleWeek, migrateBoardStorage, useBoard } from "./store.ts";

const idle = async () => ({ ok: false as const, error: "unused" });

function client(over: Partial<BoardClient> = {}): BoardClient {
  return {
    load: idle,
    createPost: async () => ({ ok: false, error: "unused" }),
    reply: idle,
    revise: idle,
    closeAsked: idle,
    mark: idle,
    remove: idle,
    createRoom: idle,
    setRoomAudience: idle,
    setGender: idle,
    confirmGender: idle,
    appointSteward: idle,
    loadHome: idle,
    savePlace: idle,
    joinRoom: idle,
    leaveRoom: idle,
    requestRoom: idle,
    decideRoom: async () => ({ ok: false, error: "unused" }),
    correctZip: idle,
    changeAccess: idle,
    setCouncil: async () => ({ ok: false, error: "unused" }),
    appeal: idle,
    listAppeals: async () => ({ ok: true, appeals: [] }),
    decideAppeal: async () => ({ ok: false, error: "unused" }),
    ...over,
  };
}

function draft() {
  return {
    ...blankDraft("shop"),
    type: "did" as const,
    claim: "Sharpened the chisels in the shop.",
    reason: "Tom checked them on Thursday.",
    on: todayIso(),
  };
}

/** A small local board: one member, two posts. */
function fillLocalBoard() {
  const post = (id: string, claim: string): Post => ({
    id,
    room: "shop",
    type: "did",
    claim,
    reason: "Tom checked them.",
    on: todayIso(),
    next: "",
    came: [],
    named: "",
    author: "Maria",
    at: 1,
    parentId: null,
    closed: false,
    mark: null,
    removed: false,
    media: [],
  });
  useBoard.setState({
    remote: false,
    member: true,
    founded: true,
    me: "Maria",
    section: "week",
    posts: [post("l1", "Sharpened the chisels."), post("l2", "Swept the shop.")],
  });
}

function reset() {
  setBoardClient(null);
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    useBoard.getState().commitPendingRemovals("keepalive");
  } finally {
    globalThis.fetch = priorFetch;
  }
  useBoard.setState({
    remote: false,
    admin: false,
    steward: true,
    member: true,
    me: "Maria",
    posts: [],
    removals: [],
    markLog: [],
    bans: [],
    appeals: [],
    csamReports: [],
    boardError: "",
    failedRemovalNames: [],
    undoQueue: [],
    undoClear: null,
    localEntry: false,
  });
}

test("VITE_DEMO keeps posts in the browser, and same-origin calls the API", async () => {
  reset();
  let calls = 0;
  setBoardClient({
    load: async () => {
      calls += 1;
      return { ok: false, error: "no" };
    },
  } as BoardClient);
  process.env.VITE_DEMO = "1";
  try {
    await useBoard.getState().connectRemote();
    assert.equal(useBoard.getState().remote, false);
    assert.equal(calls, 0);
    const check = await useBoard.getState().file(draft());
    assert.equal(check.ok, true);
    assert.equal(useBoard.getState().posts.length, 1);
    assert.equal(useBoard.getState().posts[0]?.author, "Maria");
    assert.equal(calls, 0);
  } finally {
    delete process.env.VITE_DEMO;
  }
  await useBoard.getState().connectRemote();
  assert.equal(calls, 1);
  assert.equal(useBoard.getState().remote, true);
});

test("a mark needs one sentence and does not hide the post", async () => {
  reset();
  await useBoard.getState().file(draft());
  const id = useBoard.getState().posts[0]?.id ?? "";
  const bad = await useBoard.getState().mark(id, "sloppy", "no");
  assert.equal(bad.ok, false);
  assert.equal(useBoard.getState().posts[0]?.mark, null);
  const good = await useBoard
    .getState()
    .mark(id, "unsupported", "The notice does not say where that came from.");
  assert.equal(good.ok, true);
  assert.equal(useBoard.getState().posts[0]?.mark, "unsupported");
  assert.equal(useBoard.getState().posts[0]?.removed, false);
  assert.equal(
    useBoard.getState().markLog[0]?.reason,
    "The notice does not say where that came from.",
  );
});

test("a hard removal is logged with its reason", async () => {
  reset();
  await useBoard.getState().file(draft());
  const id = useBoard.getState().posts[0]?.id ?? "";
  const removed = await useBoard.getState().remove(id, "threat");
  assert.equal(removed.ok, true);
  assert.equal(useBoard.getState().posts[0]?.removed, true);
  assert.equal(useBoard.getState().removals[0]?.reason, "threat");
  assert.equal(useBoard.getState().removals[0]?.author, "Maria");
});

test("a live board writes through the API client", async () => {
  reset();
  const serverPost: Post = {
    id: "server-1",
    room: "shop",
    type: "did",
    claim: "Sharpened the chisels in the shop.",
    reason: "Tom checked them on Thursday.",
    on: todayIso(),
    next: "",
    came: [],
    named: "",
    author: "Maria",
    at: 20,
    parentId: null,
    closed: false,
    mark: null,
    removed: false,
    media: [],
  };
  setBoardClient(
    client({
      createPost: async () => ({ ok: true, post: serverPost }),
    }),
  );
  useBoard.setState({ remote: true });
  const check = await useBoard.getState().file(draft());
  assert.equal(check.ok, true);
  assert.equal(useBoard.getState().posts[0]?.id, "server-1");
  assert.equal(useBoard.getState().posts[0]?.removed, false);
});

test("out of scope stays on the post, and the appeal and the decision are logged", async () => {
  reset();
  await useBoard.getState().file(draft());
  const id = useBoard.getState().posts[0]?.id ?? "";
  const marked = await useBoard
    .getState()
    .mark(id, "out_of_scope", "This belongs in the county room.");
  assert.equal(marked.ok, true);
  assert.equal(useBoard.getState().posts[0]?.mark, "out_of_scope");
  assert.equal(useBoard.getState().posts[0]?.removed, false);
  const filed = await useBoard.getState().appeal(id, "mark", "The post is about the shop night.");
  assert.equal(filed.ok, true);
  assert.equal(useBoard.getState().appeals[0]?.decision, null);
  useBoard.setState({ me: "Tom" });
  const lifted = await useBoard
    .getState()
    .decideAppeal(useBoard.getState().appeals[0]?.id ?? "", "lift", "The post stays in this room.");
  assert.equal(lifted.ok, true);
  assert.equal(useBoard.getState().posts[0]?.mark, null);
  assert.equal(useBoard.getState().posts[0]?.removed, false);
  assert.equal(useBoard.getState().appeals[0]?.decision, "lift");
  assert.equal(useBoard.getState().appeals[0]?.decidedBy, "Tom");
});

test("a local CSAM removal keeps the words off the post and bans the account", async () => {
  reset();
  await useBoard.getState().file(draft());
  const id = useBoard.getState().posts[0]?.id ?? "";
  const removed = await useBoard.getState().remove(id, "csam");
  assert.equal(removed.ok, true);
  assert.equal(useBoard.getState().posts[0]?.claim, "[removed]");
  assert.equal(useBoard.getState().posts[0]?.reason, "");
  assert.equal(useBoard.getState().bans[0]?.reason, "csam");
  const again = await useBoard.getState().file(draft());
  assert.equal(again.ok, false);
});

test("a confirmed clear stays on an empty week and undo puts the board back", () => {
  reset();
  fillLocalBoard();
  const before = useBoard.getState();
  const posts = before.posts.length;
  const name = before.me;
  assert.ok(posts > 0);
  useBoard.getState().clearLocalBoard();
  const cleared = useBoard.getState();
  assert.equal(cleared.localEntry, true);
  assert.equal(cleared.section, "week");
  assert.equal(cleared.posts.length, 0);
  assert.equal(weekFor(cleared.cards, new Map(), todayIso()).length, 0);
  assert.equal(cleared.undoClear?.me, name);
  assert.equal(cleared.undoClear?.posts.length, posts);
  useBoard.getState().undoClearBoard();
  const restored = useBoard.getState();
  assert.equal(restored.me, name);
  assert.equal(restored.posts.length, posts);
  assert.equal(restored.undoClear, null);
  assert.equal(restored.localEntry, true);
});

function persisted(): {
  state: { posts: Post[]; undoClear: { at: number; posts: Post[]; me: string } | null };
} {
  const raw = localStorage.getItem("the-board-v1");
  assert.ok(raw);
  return JSON.parse(raw) as {
    state: { posts: Post[]; undoClear: { at: number; posts: Post[]; me: string } | null };
  };
}

/** Drop the in-memory board, then load whatever was put back in storage. */
async function reload(raw: string) {
  useBoard.setState({ posts: [], undoClear: null, me: "", member: false });
  localStorage.setItem("the-board-v1", raw);
  await useBoard.persist.rehydrate();
}

test("a reload during the undo window still has the board", async () => {
  reset();
  fillLocalBoard();
  const posts = useBoard.getState().posts.length;
  const name = useBoard.getState().me;
  assert.ok(posts > 0);
  useBoard.getState().clearLocalBoard();
  const saved = localStorage.getItem("the-board-v1");
  assert.ok(saved);
  const stored = persisted();
  assert.equal(stored.state.posts.length, 0);
  assert.equal(stored.state.undoClear?.posts.length, posts);
  assert.equal(stored.state.undoClear?.me, name);

  await reload(saved);
  const reloaded = useBoard.getState();
  assert.equal(reloaded.posts.length, 0);
  assert.equal(reloaded.member, true);
  assert.equal(reloaded.undoClear?.posts.length, posts);
  assert.equal(reloaded.undoClear?.me, name);
  useBoard.getState().undoClearBoard();
  assert.equal(useBoard.getState().posts.length, posts);
  assert.equal(useBoard.getState().me, name);
  assert.equal(useBoard.getState().undoClear, null);
});

test("an expired undo snapshot is dropped on reload", async () => {
  reset();
  fillLocalBoard();
  useBoard.getState().clearLocalBoard();
  const stored = persisted();
  assert.ok(stored.state.undoClear);
  stored.state.undoClear.at = Date.now() - UNDO_TTL_MS - 1;
  await reload(JSON.stringify(stored));
  assert.equal(useBoard.getState().undoClear, null);
  assert.equal(useBoard.getState().posts.length, 0);
});

test("two files in one turn create one post", async () => {
  reset();
  const first = useBoard.getState().file(draft());
  const second = useBoard.getState().file(draft());
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.deepEqual(b.stops, []);
  assert.equal(useBoard.getState().posts.length, 1);
  const third = await useBoard.getState().file(draft());
  assert.equal(third.ok, true);
  assert.equal(useBoard.getState().posts.length, 2);
});

test("a second file does not post while the first is still sending", async () => {
  reset();
  let calls = 0;
  let release: (value: { ok: true; post: Post }) => void = () => {};
  const gate = new Promise<{ ok: true; post: Post }>((resolve) => {
    release = resolve;
  });
  const serverPost: Post = {
    id: "server-lock",
    room: "shop",
    type: "did",
    claim: "Sharpened the chisels in the shop.",
    reason: "Tom checked them on Thursday.",
    on: todayIso(),
    next: "",
    came: [],
    named: "",
    author: "Maria",
    at: 21,
    parentId: null,
    closed: false,
    mark: null,
    removed: false,
    media: [],
  };
  setBoardClient(
    client({
      createPost: () => {
        calls += 1;
        return gate;
      },
    }),
  );
  useBoard.setState({ remote: true, posts: [] });
  const first = useBoard.getState().file(draft());
  const second = await useBoard.getState().file(draft());
  assert.equal(calls, 1);
  assert.equal(second.ok, false);
  assert.equal(useBoard.getState().posts.length, 0);
  release({ ok: true, post: serverPost });
  const done = await first;
  assert.equal(done.ok, true);
  assert.equal(useBoard.getState().posts.length, 1);
  assert.equal(useBoard.getState().posts[0]?.id, "server-lock");
});

test("a silent clear and a remote board do not offer undo", () => {
  reset();
  fillLocalBoard();
  useBoard.getState().clearBoard();
  assert.equal(useBoard.getState().undoClear, null);
  fillLocalBoard();
  const posts = useBoard.getState().posts.length;
  useBoard.setState({ remote: true });
  useBoard.getState().clearLocalBoard();
  assert.equal(useBoard.getState().remote, true);
  assert.equal(useBoard.getState().posts.length, posts);
  assert.equal(useBoard.getState().undoClear, null);
});

test("a saved sample week is dropped on load", () => {
  const sample = dropSampleWeek({
    sample: true,
    sampleVersion: 8,
    me: "Josh",
    member: true,
    posts: [{}],
    room: "shop",
  });
  assert.deepEqual(sample, { room: "shop", deskOn: undefined, lineDismissedAt: undefined });
  const legacy = dropSampleWeek({ cards: [{ id: "s-framing" }], me: "Josh" });
  assert.equal(legacy.me, undefined);
  const real = dropSampleWeek({ sample: false, sampleVersion: 0, me: "Maria", posts: [{}] });
  assert.deepEqual(real, { me: "Maria", posts: [{}] });
});

test("storage migrations chain: v5 and v6 sample weeks are dropped, real boards kept", () => {
  const mark = { id: "m1", postId: "p1", by: "Tom", at: 1 };
  const v5Sample = migrateBoardStorage(
    {
      sample: true,
      sampleVersion: 8,
      me: "Josh",
      member: true,
      posts: [{ id: "s1" }],
      markLog: [mark],
      room: "shop",
    },
    5,
  ) as Record<string, unknown>;
  assert.equal(v5Sample.me, undefined);
  assert.equal(v5Sample.posts, undefined);
  assert.equal(v5Sample.markLog, undefined);
  assert.equal(v5Sample.room, "shop");

  const v5Legacy = migrateBoardStorage({ me: "Josh", cards: [{ id: "s-framing" }] }, 5) as Record<
    string,
    unknown
  >;
  assert.equal(v5Legacy.me, undefined);

  const v5Real = migrateBoardStorage(
    { sample: false, sampleVersion: 0, me: "Maria", posts: [{ id: "p1" }], markLog: [mark] },
    5,
  ) as Record<string, unknown>;
  assert.equal(v5Real.me, "Maria");
  assert.deepEqual(v5Real.posts, [{ id: "p1" }]);
  assert.deepEqual(v5Real.markLog, [{ ...mark, reason: "" }]);
  assert.equal("sample" in v5Real, false);
  assert.equal("sampleVersion" in v5Real, false);

  const v6Sample = migrateBoardStorage(
    { sample: true, me: "Josh", posts: [{}], room: "county" },
    6,
  ) as Record<string, unknown>;
  assert.equal(v6Sample.me, undefined);
  assert.equal(v6Sample.room, "county");

  const v7 = { me: "Maria", posts: [{}] };
  assert.equal(migrateBoardStorage(v7, 7), v7);
  assert.deepEqual(migrateBoardStorage({ me: "x" }, 4), {});
});

test("a live board keeps the server home order", async () => {
  reset();
  const home: HomePayload = {
    zip: "33578",
    townId: "riverview-fl",
    townName: "Riverview",
    congregationId: "grace",
    congregations: [],
    sections: [
      {
        tier: "joined",
        label: "What you've joined",
        rooms: [{ id: "shop", name: "The Shop" }],
      },
      {
        tier: "region",
        label: "Farther out",
        rooms: [{ id: "region-hillsborough", name: "Hillsborough" }],
      },
    ],
    requests: [],
    accessLog: [],
  };
  const board: BoardSnapshot = {
    me: {
      member: true,
      steward: false,
      admin: false,
      council: true,
      councilChair: false,
      stewardRooms: [],
      ban: null,
      gender: null,
      genderConfirmed: false,
    },
    genderPolicy: { setBy: "self", requiresConfirmation: false, changeBy: "admin" },
    rooms: [],
    posts: [],
    marks: [],
    removals: [],
    bans: [],
    appeals: [],
    csamReports: [],
    pages: [],
  };
  setBoardClient(
    client({
      load: async () => ({ ok: true, board }),
      loadHome: async () => ({ ok: true, home }),
    }),
  );
  delete process.env.VITE_DEMO;
  await useBoard.getState().connectRemote();
  assert.deepEqual(
    useBoard.getState().home?.sections.map((section) => section.tier),
    ["joined", "region"],
  );
  assert.equal(useBoard.getState().council, true);
  assert.equal(useBoard.getState().home?.sections[0]?.label, "What you've joined");
});

const LIFTS_ID = "3f2a9c1e-8241-4c3e-9a11-8241abcd1234";

function removalCards() {
  const card = newCard({
    id: LIFTS_ID,
    room: "shop",
    kind: "meeting",
    name: "Saturday lifts",
    place: "The shop",
    time: "7 a.m.",
    host: "Maria",
  });
  const other = newCard({
    room: "shop",
    kind: "meeting",
    name: "Tuesday study",
    place: "The shop",
    time: "7 p.m.",
    host: "Maria",
  });
  return { card, other };
}

async function flushRemoval() {
  for (let step = 0; step < 4; step += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("remove, then undo, sends no DELETE", async () => {
  reset();
  mock.timers.enable({ apis: ["setTimeout"] });
  const { card, other } = removalCards();
  useBoard.setState({ remote: true, cards: [other, card], boardError: "stale", section: "find" });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    const result = await useBoard.getState().removeCard(card.id);
    assert.equal(result.ok, true);
    assert.equal(calls, 0);
    assert.equal(useBoard.getState().cards.some((item) => item.id === card.id), false);
    assert.equal(useBoard.getState().undoRemoveCard(card.id), true);
    mock.timers.tick(REMOVAL_UNDO_MS);
    await flushRemoval();
    assert.equal(calls, 0);
    assert.deepEqual(
      useBoard.getState().cards.map((item) => item.id),
      [other.id, card.id],
    );
  } finally {
    useBoard.getState().commitPendingRemovals("keepalive");
    mock.timers.reset();
    globalThis.fetch = original;
  }
});

test("remove, then the undo window, sends DELETE and keeps a 200", async () => {
  reset();
  mock.timers.enable({ apis: ["setTimeout"] });
  const { card, other } = removalCards();
  useBoard.setState({ remote: true, cards: [other, card], boardError: "", section: "find" });
  const original = globalThis.fetch;
  let method = "";
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    method = init?.method ?? "GET";
    assert.match(String(input), new RegExp(`/api/gatherings/${LIFTS_ID}$`));
    assert.equal(init?.credentials, "include");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await useBoard.getState().removeCard(card.id);
    assert.equal(calls, 0);
    mock.timers.tick(REMOVAL_UNDO_MS);
    await flushRemoval();
    assert.equal(calls, 1);
    assert.equal(method, "DELETE");
    assert.deepEqual(
      useBoard.getState().cards.map((item) => item.id),
      [other.id],
    );
    assert.equal(useBoard.getState().boardError, "");
  } finally {
    mock.timers.reset();
    globalThis.fetch = original;
  }
});

test("remove, then a failed DELETE, restores the card and shows the error", async () => {
  reset();
  mock.timers.enable({ apis: ["setTimeout"] });
  const { card, other } = removalCards();
  useBoard.setState({ remote: true, cards: [other, card], boardError: "stale", section: "find" });
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "api-unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  try {
    await useBoard.getState().removeCard(card.id);
    mock.timers.tick(REMOVAL_UNDO_MS);
    await flushRemoval();
    assert.equal(useBoard.getState().boardError, removalFailedCopy("Saturday lifts"));
    assert.equal(userFacingError("api-unavailable", removalFailedCopy("Saturday lifts")), removalFailedCopy("Saturday lifts"));
    assert.equal(useBoard.getState().boardError.includes("api-unavailable"), false);
    assert.deepEqual(
      useBoard.getState().cards.map((item) => item.id),
      [other.id, card.id],
    );
    assert.equal(useBoard.getState().scrollCardId, card.id);
  } finally {
    mock.timers.reset();
    globalThis.fetch = original;
  }
});

test("a network failure or timeout while removing restores the card", async () => {
  reset();
  mock.timers.enable({ apis: ["setTimeout"] });
  const { card } = removalCards();
  useBoard.setState({ remote: true, cards: [card], boardError: "", section: "find" });
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  try {
    await useBoard.getState().removeCard(card.id);
    mock.timers.tick(REMOVAL_UNDO_MS);
    await flushRemoval();
    assert.equal(useBoard.getState().cards[0]?.id, card.id);
    assert.equal(useBoard.getState().boardError, removalFailedCopy(card.name));
  } finally {
    mock.timers.reset();
    globalThis.fetch = original;
  }
});

test("leaving the page during the undo window sends the DELETE", async () => {
  reset();
  mock.timers.enable({ apis: ["setTimeout"] });
  const { card } = removalCards();
  useBoard.setState({ remote: true, cards: [card], section: "find" });
  const original = globalThis.fetch;
  let keepalive = false;
  let method = "";
  globalThis.fetch = async (_input, init) => {
    method = init?.method ?? "GET";
    keepalive = init?.keepalive === true;
    return new Response(null, { status: 200 });
  };
  try {
    await useBoard.getState().removeCard(card.id);
    useBoard.getState().commitPendingRemovals("keepalive");
    mock.timers.tick(REMOVAL_UNDO_MS);
    await flushRemoval();
    assert.equal(method, "DELETE");
    assert.equal(keepalive, true);
  } finally {
    mock.timers.reset();
    globalThis.fetch = original;
  }
});

test("undo restores the latest removal, and each removal keeps its own timer", async () => {
  reset();
  mock.timers.enable({ apis: ["setTimeout"] });
  const other = newCard({
    room: "shop",
    kind: "meeting",
    name: "Tuesday study",
    place: "The shop",
    time: "7 p.m.",
    host: "Maria",
  });
  const first = newCard({
    id: LIFTS_ID,
    room: "shop",
    kind: "meeting",
    name: "Saturday lifts",
    place: "The shop",
    time: "7 a.m.",
    host: "Maria",
  });
  const second = newCard({
    id: "8c1d0e2a-1111-4b2c-9d00-1111abcd1234",
    room: "shop",
    kind: "meeting",
    name: "Wednesday meal",
    place: "The shop",
    time: "6 p.m.",
    host: "Maria",
  });
  useBoard.setState({ remote: true, cards: [other, first, second], section: "find", undoQueue: [] });
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await useBoard.getState().removeCard(first.id);
    mock.timers.tick(1000);
    await useBoard.getState().removeCard(second.id);
    assert.equal(calls.length, 0);
    assert.deepEqual(
      useBoard.getState().undoQueue.map((item) => item.id),
      [first.id, second.id],
    );
    assert.equal(useBoard.getState().undoRemoveCard(second.id), true);
    assert.equal(calls.length, 0);
    assert.deepEqual(
      useBoard.getState().cards.map((item) => item.id),
      [other.id, second.id],
    );
    mock.timers.tick(4000);
    await flushRemoval();
    assert.deepEqual(calls.map((url) => url.endsWith(`/api/gatherings/${first.id}`)), [true]);
    assert.equal(useBoard.getState().cards.some((item) => item.id === second.id), true);
    assert.equal(useBoard.getState().cards.some((item) => item.id === first.id), false);
    mock.timers.tick(1000);
    await flushRemoval();
    assert.equal(calls.length, 1);
  } finally {
    useBoard.getState().commitPendingRemovals("keepalive");
    mock.timers.reset();
    globalThis.fetch = original;
  }
});

test("two failed removals restore both cards and share one message", async () => {
  reset();
  mock.timers.enable({ apis: ["setTimeout"] });
  const other = newCard({
    room: "shop",
    kind: "meeting",
    name: "Tuesday study",
    place: "The shop",
    time: "7 p.m.",
    host: "Maria",
  });
  const first = newCard({
    id: LIFTS_ID,
    room: "shop",
    kind: "meeting",
    name: "Saturday lifts",
    place: "The shop",
    time: "7 a.m.",
    host: "Maria",
  });
  const second = newCard({
    id: "8c1d0e2a-1111-4b2c-9d00-1111abcd1234",
    room: "shop",
    kind: "meeting",
    name: "Wednesday meal",
    place: "The shop",
    time: "6 p.m.",
    host: "Maria",
  });
  useBoard.setState({ remote: true, cards: [other, first, second], section: "find" });
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "api-unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  try {
    await useBoard.getState().removeCard(first.id);
    await useBoard.getState().removeCard(second.id);
    mock.timers.tick(REMOVAL_UNDO_MS);
    await flushRemoval();
    assert.equal(
      useBoard.getState().boardError,
      removalFailedCopy(["Saturday lifts", "Wednesday meal"]),
    );
    assert.equal(useBoard.getState().boardError.includes("api-unavailable"), false);
    assert.deepEqual(
      useBoard.getState().cards.map((item) => item.id),
      [other.id, first.id, second.id],
    );
  } finally {
    mock.timers.reset();
    globalThis.fetch = original;
  }
});

test("the removal error is one alert with a dismiss control, and the card can be scrolled back", () => {
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  const find = readFileSync(new URL("../../components/board/find-view.tsx", import.meta.url), "utf8");
  const room = readFileSync(new URL("../../components/board/room-view.tsx", import.meta.url), "utf8");
  assert.match(app, /role="alert"/);
  assert.match(app, /min-h-\[44px\]/);
  assert.match(app, />\s*Dismiss\s*</);
  assert.match(app, /boardError: ""/);
  assert.match(app, /userFacingError/);
  assert.match(app, /shown !== "find"/);
  assert.equal(find.includes("{boardError ? ("), false);
  assert.match(find, /lg:bottom-6/);
  assert.match(find, /env\(safe-area-inset-bottom\)/);
  assert.match(find, /border-danger text-danger/);
  assert.match(find, /role="status"/);
  assert.equal(room.includes("boardError"), false);
  assert.match(find, /scrollRestoredCard/);
  assert.match(find, /id=\{`card-\$\{card\.id\}`\}/);
  assert.match(find, /undoRemoveCard/);
  const seen: ScrollIntoViewOptions[] = [];
  const scrolled = scrollRestoredCard(LIFTS_ID, {
    getElementById(elementId) {
      assert.equal(elementId, `card-${LIFTS_ID}`);
      return {
        scrollIntoView(options) {
          seen.push(options);
        },
      };
    },
  });
  assert.equal(scrolled, true);
  assert.deepEqual(seen, [{ block: "center" }]);
  const sheet = readFileSync(new URL("../../../public/backgrounds.css", import.meta.url), "utf8");
  assert.match(
    sheet,
    /\.card\{scroll-margin-bottom:calc\(var\(--tabbar-h,64px\) \+ env\(safe-area-inset-bottom\) \+ 9rem\)\}/,
  );
  const bits = readFileSync(new URL("../../components/quorum/bits.tsx", import.meta.url), "utf8");
  assert.match(bits, /focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-\[var\(--color-fg\)\]/);
});

test("a banned member still sees the status of their own appeal", async () => {
  reset();
  setBoardClient(
    client({
      load: async () => ({ ok: false, error: "banned" }),
      listAppeals: async () => ({
        ok: true,
        appeals: [
          {
            id: "appeal-1",
            room: "shop",
            postId: "post-1",
            author: "Maria",
            kind: "removal",
            reason: "The post did not threaten anyone.",
            decision: "uphold",
            decisionNote: "The removal stays.",
            decidedBy: "Tom",
            at: Date.now(),
            decidedAt: Date.now(),
            rule: "threat",
          },
        ],
      }),
    }),
  );
  delete process.env.VITE_DEMO;
  await useBoard.getState().connectRemote();
  assert.equal(useBoard.getState().boardError, "This account is barred from the board.");
  assert.equal(useBoard.getState().posts.length, 0);
  assert.equal(useBoard.getState().appeals.length, 1);
  assert.equal(useBoard.getState().appeals[0]?.decision, "uphold");
});

test("the desk stays off until the member turns it on", () => {
  reset();
  useBoard.setState({ deskOn: false, section: "rooms" });
  assert.equal(useBoard.getState().deskOn, false);
  useBoard.getState().setSection("civic");
  assert.equal(useBoard.getState().section, "rooms");
  useBoard.getState().setDeskOn(true);
  useBoard.getState().setSection("civic");
  assert.equal(useBoard.getState().section, "civic");
  useBoard.getState().setDeskOn(false);
  assert.equal(useBoard.getState().deskOn, false);
  assert.equal(useBoard.getState().section, "week");
});

test("a revision keeps a steward mark", async () => {
  reset();
  await useBoard.getState().file(draft());
  const id = useBoard.getState().posts[0]?.id ?? "";
  await useBoard.getState().mark(id, "sloppy", "The notice does not say where that came from.");
  await useBoard.getState().revise(id, {
    claim: "Sharpened the chisels and put them back.",
    reason: "Tom checked them on Thursday.",
  });
  assert.equal(useBoard.getState().posts[0]?.mark, "sloppy");
  assert.equal(useBoard.getState().markLog.length, 1);
});

function meetingCard(): MeetingCard {
  return {
    id: "card-1",
    room: "shop",
    kind: "meeting",
    name: "Saturday lifts",
    place: "The shop",
    time: "7 a.m.",
    host: "Ada",
    next: "2026-10-24",
    lastFour: [],
    wentBy: [],
    going: [],
    pinned: false,
    unverified: false,
    firstTimer: false,
    slots: [],
    book: "",
    pages: "",
  };
}

test("a remote RSVP checks the room and does not toggle when it is closed", async () => {
  reset();
  useBoard.setState({
    remote: true,
    me: "Maria",
    member: true,
    section: "week",
    room: "county",
    cards: [meetingCard()],
  });
  setBoardClient(
    client({
      load: async () => ({ ok: false, error: "That room is not here." }),
    }),
  );
  useBoard.getState().rsvp("card-1");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(useBoard.getState().cards[0]?.going, []);
  assert.equal(useBoard.getState().roomHold, null);

  setBoardClient(
    client({
      load: async () => ({
        ok: false,
        error: "Say whether you are a man or a woman before opening this room.",
        code: "gender-unstated",
        audience: "women",
      }),
    }),
  );
  useBoard.getState().rsvp("card-1");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(useBoard.getState().cards[0]?.going, []);
  assert.equal(useBoard.getState().roomHold?.code, "gender-unstated");
  assert.equal(useBoard.getState().section, "rooms");
  useBoard.getState().dismissRoomHold();
  assert.equal(useBoard.getState().roomHold, null);
  assert.equal(useBoard.getState().section, "week");
  assert.equal(useBoard.getState().room, "county");

  setBoardClient(
    client({
      load: async () => ({ ok: true, board: {} as BoardSnapshot }),
    }),
  );
  useBoard.getState().rsvp("card-1");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(useBoard.getState().cards[0]?.going, ["Maria"]);
});
