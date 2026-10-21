import "./test-storage.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { setBoardClient, type BoardClient, type BoardSnapshot } from "./client.ts";
import type { HomePayload } from "./home.ts";
import { blankDraft, todayIso, type Post } from "./model.ts";
import { useBoard } from "./store.ts";

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

test("a live board keeps the server home order", async () => {
  reset();
  const home: HomePayload = {
    zip: "33578",
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
      ban: null,
    },
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

test("a revision keeps a steward mark", async () => {
  reset();
  await useBoard.getState().file(draft());
  const id = useBoard.getState().posts[0]?.id ?? "";
  await useBoard
    .getState()
    .mark(id, "sloppy", "The notice does not say where that came from.");
  await useBoard.getState().revise(id, {
    claim: "Sharpened the chisels and put them back.",
    reason: "Tom checked them on Thursday.",
  });
  assert.equal(useBoard.getState().posts[0]?.mark, "sloppy");
  assert.equal(useBoard.getState().markLog.length, 1);
});
