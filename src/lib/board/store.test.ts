import "./test-storage.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { setBoardClient, type BoardClient, type BoardSnapshot } from "./client.ts";
import type { HomePayload } from "./home.ts";
import { blankDraft, todayIso, weekFor, type Post } from "./model.ts";
import { UNDO_TTL_MS, useBoard } from "./store.ts";

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

function reset() {
  setBoardClient(null);
  useBoard.setState({
    remote: false,
    admin: false,
    steward: true,
    member: true,
    me: "Maria",
    sample: false,
    posts: [],
    removals: [],
    markLog: [],
    bans: [],
    appeals: [],
    csamReports: [],
    boardError: "",
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
  useBoard.getState().loadSample();
  const before = useBoard.getState();
  const posts = before.posts.length;
  const name = before.me;
  assert.ok(posts > 0);
  useBoard.getState().clearLocalBoard();
  const cleared = useBoard.getState();
  assert.equal(cleared.sample, false);
  assert.equal(cleared.localEntry, true);
  assert.equal(cleared.section, "week");
  assert.equal(cleared.posts.length, 0);
  assert.equal(weekFor(cleared.cards, new Map(), todayIso()).length, 0);
  assert.equal(cleared.undoClear?.me, name);
  assert.equal(cleared.undoClear?.posts.length, posts);
  useBoard.getState().undoClearBoard();
  const restored = useBoard.getState();
  assert.equal(restored.sample, true);
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
  useBoard.setState({ posts: [], undoClear: null, me: "", sample: false, member: false });
  localStorage.setItem("the-board-v1", raw);
  await useBoard.persist.rehydrate();
}

test("a reload during the undo window still has the board", async () => {
  reset();
  useBoard.getState().loadSample();
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
  assert.equal(reloaded.sample, false);
  assert.equal(reloaded.member, true);
  assert.equal(reloaded.undoClear?.posts.length, posts);
  assert.equal(reloaded.undoClear?.me, name);
  useBoard.getState().undoClearBoard();
  assert.equal(useBoard.getState().posts.length, posts);
  assert.equal(useBoard.getState().sample, true);
  assert.equal(useBoard.getState().me, name);
  assert.equal(useBoard.getState().undoClear, null);
});

test("an expired undo snapshot is dropped on reload", async () => {
  reset();
  useBoard.getState().loadSample();
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
  useBoard.getState().loadSample();
  useBoard.getState().clearBoard();
  assert.equal(useBoard.getState().undoClear, null);
  assert.equal(useBoard.getState().sample, false);
  useBoard.getState().loadSample();
  const posts = useBoard.getState().posts.length;
  useBoard.setState({ remote: true });
  useBoard.getState().clearLocalBoard();
  assert.equal(useBoard.getState().remote, true);
  assert.equal(useBoard.getState().posts.length, posts);
  assert.equal(useBoard.getState().undoClear, null);
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
    genderPolicy: { setBy: "self", requiresConfirmation: false, changeBy: "steward" },
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
