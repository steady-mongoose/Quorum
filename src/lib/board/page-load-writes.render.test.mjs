// @ts-nocheck  Real components and the real useMessageReach, with fetch routed to createApp on PGlite.
// QA S3 on #135 (after AVO QA's qa135/pageload.render.mjs): mounting Room, Find,
// a profile or the mailbox must send no request but GETs, and must leave the
// caller's dm_attendance rows as they were, on a device that has the meeting
// card and on a fresh one that has none.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));
await new Response("{}").json();
const NativeRequest = Request;
const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/", width: 1280, height: 900 });
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLLabelElement",
  "HTMLDetailsElement",
  "HTMLHeadingElement",
  "HTMLAnchorElement",
  "HTMLSelectElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "navigator",
  "localStorage",
  "sessionStorage",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IntersectionObserver",
  "ResizeObserver",
  "matchMedia",
  "CustomEvent",
  "scrollTo",
]) {
  const value = key === "window" ? window : window[key];
  if (value === undefined) continue;
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value:
      typeof value === "function" && key !== "window" && !/^[A-Z]/.test(key)
        ? value.bind(window)
        : value,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Server files load through Node's type stripping, not the src loader.
const { createApp } = await import(new URL("../../../server/http.ts", import.meta.url).href);
const { openRollCallDb } = await import(
  new URL("../../../server/closed-test/roll-call-db.ts", import.meta.url).href
);
const { rememberNamedAccounts, recordAttendance } = await import(
  new URL("../../../server/dm/store.ts", import.meta.url).href
);
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const router = await import("@tanstack/react-router");
const { useBoard } = await import("./store.ts");
const { ROOMS } = await import("./model.ts");
const { SessionContext, EMPTY_SERVER_SESSION } = await import("../server-session-state.ts");
const { forgetMessageReach } = await import("../../components/board/use-message-reach.ts");
const views = {
  room: (await import("../../components/board/room-view.tsx")).RoomView,
  find: (await import("../../components/board/find-view.tsx")).FindView,
  profile: (await import("../../components/board/profile-view.tsx")).ProfileView,
  mailbox: (await import("../../components/board/encrypted-mailbox.tsx")).EncryptedMailbox,
};

test("mounting Room, Find, a profile or the mailbox sends only GETs and leaves attendance as it was", async () => {
  const { db, close } = await openRollCallDb();
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const errors = [];
  try {
    const handler = createApp({
      db,
      origins: ["http://localhost"],
      now: () => new Date(),
      createAccount: async () => {
        throw new Error("unused");
      },
      signIn: async () => {
        throw new Error("unused");
      },
      readSession: async (headers) => {
        const found = await db.query(`select id, name, email from "user" where id = $1`, [
          headers.get("x-user-id"),
        ]);
        return found[0] ?? null;
      },
      forwardAuth: async () => new Response(null, { status: 404 }),
    });
    const member = async (name) => {
      const id = randomUUID();
      await db.query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, $2, $3, true, now(), now())`,
        [id, name, `${name.toLowerCase()}-${id.slice(0, 6)}@example.test`],
      );
      await db.query(
        `insert into access_log (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
         values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'For the test.', $4)`,
        [randomUUID(), id, name, new Date("2026-09-01T00:00:00Z")],
      );
      return id;
    };
    const host = await member("TestHost");
    const guest = await member("TestGuest");
    await db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', $2)`, [
      host,
      new Date("2026-09-01T00:00:00Z"),
    ]);
    await db.query(
      `update room set options = array_append(array_remove(options, 'members'), 'members') where id = 'shop'`,
    );
    for (const cardId of ["s-one", "s-two"]) {
      const postId = randomUUID();
      await db.query(
        `insert into board_post (id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at)
         values ($1, 'shop', $2, 'TestHost', 'hosted', 'Test write-up.', $3, $4, now())`,
        [postId, host, ["TestHost", "TestGuest"], cardId],
      );
      await rememberNamedAccounts(db, postId);
    }
    // The guest confirmed both meetings earlier, from another device.
    assert.equal((await recordAttendance(db, guest, new Date(), ["s-one", "s-two"])).ok, true);
    const rows = async () =>
      (
        await db.query(
          `select meeting_id, recorded_at from dm_attendance where user_id = $1 order by meeting_id`,
          [guest],
        )
      ).map((row) => `${row.meeting_id}@${new Date(row.recorded_at).toISOString()}`);
    const before = await rows();
    assert.equal(before.length, 2);

    let seen = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(
        String(input instanceof NativeRequest ? input.url : input),
        "http://localhost/",
      );
      const method = (
        init?.method ?? (input instanceof NativeRequest ? input.method : "GET")
      ).toUpperCase();
      seen.push(`${method} ${url.pathname}`);
      return handler(
        new NativeRequest(`http://127.0.0.1:8787${url.pathname}${url.search}`, {
          method,
          headers: {
            origin: "http://localhost",
            "x-user-id": guest,
            ...(init?.body ? { "content-type": "application/json" } : {}),
          },
          body: init?.body,
        }),
      );
    };
    console.error = (...parts) => {
      const text = parts.map(String).join(" ");
      if (!/act\(|not wrapped/.test(text)) errors.push(text.slice(0, 200));
    };

    // Device "seeded" shows only one of the two meetings; "fresh" shows none.
    const card = (id) => ({
      id,
      room: "shop",
      kind: "meeting",
      name: "Test meeting",
      place: "Hall",
      time: "Tue 7pm",
      host: "TestHost",
      next: "",
      lastFour: [true, false, false, false],
      wentBy: ["TestHost", "TestGuest"],
      going: [],
      pinned: false,
      unverified: false,
      firstTimer: false,
      slots: [],
      book: "",
      readBy: "",
    });
    const devices = { seeded: [card("s-one")], fresh: [] };
    const rooms = ROOMS.map((room) => ({
      ...room,
      joined: room.id === "shop",
      member: room.id === "shop",
    }));
    const session = {
      ...EMPTY_SERVER_SESSION,
      configured: true,
      mode: "live",
      user: { id: guest, name: "TestGuest", email: "g@example.test" },
    };
    const flush = async () => {
      for (let i = 0; i < 25; i += 1)
        await act(async () => new Promise((resolve) => setTimeout(resolve, 3)));
    };
    let reads = 0;
    for (const [device, cards] of Object.entries(devices)) {
      for (const view of Object.keys(views)) {
        useBoard.setState({
          remote: true,
          me: "TestGuest",
          cards,
          rooms,
          posts: [],
          room: "shop",
          viewing: "TestHost",
          section: view === "mailbox" ? "messages" : view,
          openThread: null,
          dmFrom: null,
        });
        await act(async () => forgetMessageReach());
        seen = [];
        const element = document.createElement("div");
        document.body.append(element);
        const root = createRoot(element);
        const app = router.createRouter({
          routeTree: router.createRootRoute({
            component: () =>
              createElement(
                SessionContext.Provider,
                { value: session },
                createElement(views[view]),
              ),
          }),
          history: router.createMemoryHistory({ initialEntries: ["/"] }),
        });
        // This router build reads _rendered before the first load settles.
        app._rendered ??= [];
        await app.load();
        await act(async () => root.render(createElement(router.RouterProvider, { router: app })));
        await flush();
        await act(async () => root.unmount());
        element.remove();
        assert.deepEqual(
          seen.filter((request) => !request.startsWith("GET ")),
          [],
          `${view} on the ${device} device sent only GETs`,
        );
        reads += seen.length;
        assert.deepEqual(
          await rows(),
          before,
          `${view} on the ${device} device left attendance as it was`,
        );
      }
    }
    assert.ok(reads > 0, "the views did read the server");
    assert.deepEqual(errors, []);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    await close();
  }
});
