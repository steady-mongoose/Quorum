import "./test-storage.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { setBoardClient, type BoardClient } from "./client.ts";
import { blankDraft, todayIso, type Post } from "./model.ts";
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
    appeals: [],
    csamReports: [],
    boardError: "",
  });
}

test("an unset API base keeps posts in the browser", async () => {
  reset();
  let calls = 0;
  setBoardClient({
    load: async () => {
      calls += 1;
      return { ok: false, error: "no" };
    },
  } as BoardClient);
  await useBoard.getState().connectRemote();
  assert.equal(useBoard.getState().remote, false);
  assert.equal(calls, 0);
  const check = await useBoard.getState().file(draft());
  assert.equal(check.ok, true);
  assert.equal(useBoard.getState().posts.length, 1);
  assert.equal(useBoard.getState().posts[0]?.author, "Maria");
  assert.equal(calls, 0);
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
    appeal: async () => ({ ok: false, error: "unused" }),
    decideAppeal: async () => ({ ok: false, error: "unused" }),
  });
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
