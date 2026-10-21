import "./test-storage.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { setBoardClient, type BoardClient } from "./client.ts";
import { blankDraft, todayIso, weekFor, type Post } from "./model.ts";
import { useBoard } from "./store.ts";

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
  setBoardClient({
    load: async () => ({ ok: false, error: "unused" }),
    createPost: async () => ({ ok: true, post: serverPost }),
    reply: async () => ({ ok: false, error: "unused" }),
    revise: async () => ({ ok: false, error: "unused" }),
    closeAsked: async () => ({ ok: false, error: "unused" }),
    mark: async () => ({ ok: false, error: "unused" }),
    remove: async () => ({ ok: false, error: "unused" }),
    createRoom: async () => ({ ok: false, error: "unused" }),
    appointSteward: async () => ({ ok: false, error: "unused" }),
  });
  useBoard.setState({ remote: true });
  const check = await useBoard.getState().file(draft());
  assert.equal(check.ok, true);
  assert.equal(useBoard.getState().posts[0]?.id, "server-1");
  assert.equal(useBoard.getState().posts[0]?.removed, false);
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
