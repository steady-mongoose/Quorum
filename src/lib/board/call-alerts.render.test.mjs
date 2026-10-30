// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
// Incoming-call alert (ring), Decline, and "the call ended" on both sides.
import assert from "node:assert/strict";
import { register } from "node:module";
import nodeTest, { after, afterEach } from "node:test";
import { readFileSync } from "node:fs";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

// Load undici before happy-dom replaces Event, or Response.json() breaks.
await new Response("{}").json();

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/" });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "navigator",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  const value = key === "window" ? window : browser[key];
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: typeof value === "function" ? value.bind(window) : value,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// happy-dom has no MediaStream; let the self-view take the fake stream.
Object.defineProperty(window.HTMLMediaElement.prototype, "srcObject", {
  configurable: true,
  get() {
    return this._src ?? null;
  },
  set(v) {
    this._src = v;
  },
});

const thread = "11111111-2222-3333-4444-555555555555";

/** Each test sets these. */
let ringsReply = [];
/** What became of rings that went away (the server's `settled`). */
let settledReply = [];
let joinReply = null;
let pollReplies = [];
/** url suffix -> [status, body] for a one-off reply (say, a refused Join). */
let overrides = {};
const posts = [];
/** Every GET url, so a test can count reloads. */
const gets = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (init?.method === "POST") posts.push({ url, body: init.body });
  else gets.push(url);
  let body;
  const hit = Object.keys(overrides).find((end) => url.endsWith(end));
  if (hit) {
    // A function gives a different reply each time.
    const pick = typeof overrides[hit] === "function" ? overrides[hit]() : overrides[hit];
    if (pick === "network") throw new TypeError("Failed to fetch");
    const [status, reply] = pick;
    return new Response(JSON.stringify(reply), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.endsWith("/api/calls/status")) body = { enabled: true, record: false };
  else if (url.endsWith("/api/calls/rings"))
    body = { record: false, rings: ringsReply, settled: settledReply };
  else if (url.endsWith("/join")) body = joinReply;
  else if (url.includes("?since="))
    body = pollReplies.length > 1 ? pollReplies.shift() : (pollReplies[0] ?? null);
  else body = { ok: true, record: false };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

/** Every .focus() call, so a test can check preventScroll. */
const focusCalls = [];
const realFocus = window.HTMLElement.prototype.focus;
window.HTMLElement.prototype.focus = function (options) {
  focusCalls.push({ el: this, options });
  return realFocus.call(this, options);
};

class FakePc {
  signalingState = "stable";
  connectionState = "new";
  remoteDescription = null;
  onicecandidate = null;
  ontrack = null;
  addTrack() {}
  async createOffer() {
    return { type: "offer", sdp: "v=0\r\n" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "v=0\r\n" };
  }
  async setLocalDescription() {}
  async setRemoteDescription(d) {
    this.remoteDescription = d;
  }
  async addIceCandidate() {}
  close() {
    this.connectionState = "closed";
  }
}
globalThis.RTCPeerConnection = FakePc;

const track = (kind) => ({
  kind,
  enabled: true,
  stopped: false,
  stop() {
    this.stopped = true;
  },
});
let lastTracks = [];
Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  value: {
    async getUserMedia(c) {
      const audio = [track("audio")];
      const video = c.video ? [track("video")] : [];
      lastTracks = [...audio, ...video];
      return {
        getTracks: () => lastTracks,
        getVideoTracks: () => video,
        getAudioTracks: () => audio,
      };
    },
  },
});

const { createElement, act } = await import("react");
const { createRoot: makeRoot } = await import("react-dom/client");

// Focus checks compare with === inside assert.ok: a failing assert.equal on two DOM nodes
// makes node print the whole happy-dom graph, and the run is killed for memory.
/** Each test gets a deadline, so a regression fails the run instead of hanging CI. */
const test = (name, fn) => nodeTest(name, { timeout: 30_000 }, fn);
/** Roots still mounted. afterEach unmounts them even when a test fails part way. */
const mounted = [];
const createRoot = (host) => {
  const root = makeRoot(host);
  mounted.push({ root, host });
  return root;
};
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    try {
      await act(async () => root.unmount());
    } catch {
      // Already unmounted.
    }
    host.remove();
  }
});
afterEach(() => {
  overrides = {};
  ringsReply = [];
  settledReply = [];
});
// Stop happy-dom's timers so the file's process can exit.
after(async () => {
  try {
    await window.happyDOM.abort();
  } catch {
    // Nothing left to stop.
  }
});
const { SessionContext, EMPTY_SERVER_SESSION } = await import("../server-session-state.ts");
const { CallRings, focusRoomCall, keepFieldClear } =
  await import("../../components/board/call-rings.tsx");
const { CallPanel, RoomCall } = await import("../../components/board/room-call.tsx");

const flush = async (n = 20) => {
  for (let i = 0; i < n; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
};
async function waitFor(ok, ms = 4000) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await act(async () => new Promise((r) => setTimeout(r, 20)));
}

const live = {
  ...EMPTY_SERVER_SESSION,
  configured: true,
  mode: "live",
  user: { id: "ada", name: "Ada" },
};

function ringtoneSpy() {
  const spy = { started: 0, stopped: 0 };
  spy.fn = () => {
    spy.started += 1;
    return () => {
      spy.stopped += 1;
    };
  };
  return spy;
}

async function mountRings(ringtone, onGo = () => {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        SessionContext.Provider,
        { value: live },
        createElement(CallRings, { onGo, ringtone }),
      ),
    );
  });
  await flush();
  const button = (text) =>
    [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  return { host, root, button };
}

test("a DM call rings: caller's name, Join and Decline, and the ringtone runs until Decline", async () => {
  posts.length = 0;
  ringsReply = [{ id: "r7", kind: "dm", threadId: thread, fromName: "Ann" }];
  const spy = ringtoneSpy();
  const { host, root, button } = await mountRings(spy.fn);
  const prompt = host.querySelector('section[role="region"]');
  assert.ok(prompt, "the incoming-call prompt shows");
  assert.equal(prompt.querySelector("p").textContent, "Ann is calling you.");
  assert.equal(host.querySelector('p[role="status"]').textContent, "Ann is calling you.");
  assert.ok(button("Join") && button("Decline"));
  assert.equal(spy.started, 1, "sound and buzz start with the ring");
  assert.equal(spy.stopped, 0);

  ringsReply = [];
  await act(async () => button("Decline").click());
  await flush();
  assert.equal(host.querySelector('section[role="region"]'), null);
  assert.ok(posts.some((p) => p.url.endsWith("/api/calls/rings/r7/decline")));
  assert.equal(spy.stopped, 1, "the ringtone stops on Decline");
  assert.doesNotMatch(host.textContent, /Missed call/, "a decline is not a missed call");
  await act(async () => root.unmount());
});

test("a ring that goes away unanswered shows as a missed call, and Close clears it", async () => {
  ringsReply = [{ id: "r8", kind: "dm", threadId: thread, fromName: "Ann" }];
  const spy = ringtoneSpy();
  const { host, root, button } = await mountRings(spy.fn);
  assert.ok(host.querySelector('section[role="region"]'));
  ringsReply = [];
  settledReply = [{ id: "r8", how: "missed" }];
  // The next poll (5 s) finds the ring gone: the caller hung up or it ran out.
  await waitFor(() => /Missed call from Ann\./.test(host.textContent), 7000);
  assert.match(host.textContent, /Missed call from Ann\./);
  assert.equal(spy.stopped, 1);
  assert.equal(host.querySelector('p[role="status"]').textContent, "Missed call from Ann.");
  await act(async () => button("Close").click());
  assert.equal(host.querySelector("section"), null);
  await act(async () => root.unmount());
});

test("Join on a DM ring opens the call over the page; the caller hanging up ends it here", async () => {
  posts.length = 0;
  ringsReply = [{ id: "r9", kind: "dm", threadId: thread, fromName: "Ann" }];
  joinReply = {
    record: false,
    selfId: "ada",
    cursor: 0,
    ringing: false,
    peers: [{ id: "ann", name: "Ann", generation: 1 }],
    iceServers: [],
  };
  pollReplies = [{ record: false, peers: [], signals: [], cursor: 0 }];
  const spy = ringtoneSpy();
  const { host, root, button } = await mountRings(spy.fn);
  ringsReply = [];
  await act(async () => button("Join").click());
  await flush();
  assert.equal(spy.stopped, 1, "ringing stops on Join");
  assert.ok(
    posts.some((p) => p.url.endsWith(`/api/calls/dm/${thread}/join`)),
    "joins right away",
  );
  assert.ok(host.querySelector('section[aria-label="Call with Ann"]'), "the call opens");
  assert.ok(button("Leave call"));
  assert.notEqual(document.activeElement, document.body, "focus stays in the call");
  assert.ok(document.activeElement === button("Mute", "focus"), "Mute has focus once live");
  // Ann hangs up: the next poll has nobody else in the call.
  await waitFor(() => /Ann left\. The call ended\./.test(host.textContent));
  assert.match(host.textContent, /Ann left\. The call ended\./);
  assert.equal(host.querySelector('section[aria-label="Call with Ann"]'), null, "call UI closed");
  assert.ok(posts.some((p) => p.url.endsWith(`/api/calls/dm/${thread}/leave`)));
  assert.ok(
    lastTracks.every((t) => t.stopped),
    "camera and mic are off",
  );
  assert.doesNotMatch(host.textContent, /Missed call/);
  await act(async () => root.unmount());
});

test("Join on a room ring goes to the room and presses its Join button", async () => {
  ringsReply = [{ id: "r10", kind: "room", roomId: "shop", fromName: "Josh" }];
  let pressed = 0;
  const spy = ringtoneSpy();
  const { host, root, button } = await mountRings(spy.fn, () => {
    setTimeout(() => {
      const join = document.createElement("button");
      join.id = "room-call-join";
      join.addEventListener("click", () => pressed++);
      document.body.append(join);
    }, 20);
    requestAnimationFrame(() => focusRoomCall(1000, Date.now(), document.activeElement, true));
  });
  assert.equal(host.querySelector("p").textContent, "Josh is calling you into a room call.");
  await act(async () => button("Join").click());
  await waitFor(() => pressed > 0);
  assert.equal(pressed, 1);
  assert.equal(document.activeElement?.id, "room-call-join");
  document.getElementById("room-call-join")?.remove();
  await act(async () => root.unmount());
});

function mountPanel(extra = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(CallPanel, {
        callKey: `dm:${thread}`,
        basePath: `/api/calls/dm/${thread}`,
        selfId: "ada",
        label: "Call with Ben",
        note: "Not recorded.",
        joinLabel: "Join the call",
        calleeName: "Ben",
        ...extra,
      }),
    );
  });
  const button = (text) =>
    [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  return { host, root, button };
}

test("the caller sees Calling…, then a Decline ends the call with plain words", async () => {
  posts.length = 0;
  joinReply = {
    record: false,
    selfId: "ada",
    cursor: 0,
    ringing: true,
    peers: [],
    iceServers: [],
  };
  pollReplies = [
    { record: false, peers: [], signals: [], cursor: 0 },
    {
      record: false,
      peers: [],
      signals: [],
      cursor: 0,
      rings: [{ kind: "declined", name: "Ben" }],
    },
    { record: false, peers: [], signals: [], cursor: 0 },
  ];
  const ended = [];
  const { host, root, button } = mountPanel({ onEnded: (m) => ended.push(m) });
  await act(async () => button("Join the call").click());
  await flush();
  const join = posts.find((p) => p.url.endsWith("/join"));
  assert.equal(join?.body, JSON.stringify({ ring: true }), "starting the call rings Ben");
  assert.match(host.textContent, /Calling Ben\. It rings for up to a minute\./);
  await waitFor(() => ended.length > 0);
  assert.deepEqual(ended, ["Ben isn't available right now."]);
  assert.ok(button("Join the call"), "back to Join; the live call is closed");
  assert.equal(button("Leave call"), undefined);
  const status = host.querySelector('[aria-live="polite"]');
  assert.equal(status.textContent, "Ben isn't available right now.");
  assert.equal(host.querySelector('[role="alert"]'), null, "not shown as an error");
  assert.ok(
    posts.some((p) => p.url.endsWith("/leave")),
    "the caller's side leaves cleanly",
  );
  await act(async () => root.unmount());
});

test("choosing Leave call says so and tells the parent", async () => {
  joinReply = { record: false, selfId: "ada", cursor: 0, peers: [], iceServers: [] };
  pollReplies = [{ record: false, peers: [], signals: [], cursor: 0 }];
  let left = 0;
  const { host, root, button } = mountPanel({ calleeName: undefined, onLeave: () => left++ });
  await act(async () => button("Join the call").click());
  await flush();
  await act(async () => button("Leave call").click());
  assert.equal(left, 1);
  assert.equal(host.querySelector('[aria-live="polite"]').textContent, "You left the call.");
  await act(async () => root.unmount());
});

test("Escape anywhere declines a ring, but not while typing or in an open dialog", async () => {
  posts.length = 0;
  ringsReply = [{ id: "r20", kind: "dm", threadId: thread, fromName: "Ann" }];
  const { host, root } = await mountRings(ringtoneSpy().fn);
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.ok(host.querySelector('section[role="region"]'), "typing keeps the ring");
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.ok(host.querySelector('section[role="region"]'), "an open dialog keeps Escape");
  dialog.remove();
  assert.equal(posts.length, 0);
  ringsReply = [];
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await flush();
  assert.equal(host.querySelector('section[role="region"]'), null);
  assert.ok(posts.some((p) => p.url.endsWith("/api/calls/rings/r20/decline")));
  assert.ok(document.activeElement === input, "focus stays where you were");
  input.remove();
  await act(async () => root.unmount());
});

test("a long name is cut on screen, kept in full for screen readers, and wraps at 390", async () => {
  const name = "Alexandria Montgomery-Featherstonehaugh the Third of Avouch";
  ringsReply = [{ id: "r21", kind: "dm", threadId: thread, fromName: name }];
  const { host, root } = await mountRings(ringtoneSpy().fn);
  const line = host.querySelector('section[role="region"] p');
  const seen = line.querySelector('span[aria-hidden="true"]');
  assert.ok(seen.textContent.endsWith("… is calling you."), seen.textContent);
  assert.ok([...seen.textContent.split(" is calling")[0]].length <= 40, "name clamped to 40");
  assert.equal(line.querySelector("span.sr-only").textContent, `${name} is calling you.`);
  assert.equal(line.getAttribute("aria-label"), null, "no aria-label on the line or the card");
  assert.equal(host.querySelector('p[role="status"]').textContent, `${name} is calling you.`);
  assert.match(line.className, /min-w-0/);
  assert.match(line.className, /\[overflow-wrap:anywhere\]/);
  ringsReply = [];
  await act(async () => root.unmount());
});

test("two missed calls read as one line with both names, and no count", async () => {
  ringsReply = [
    { id: "r22", kind: "dm", threadId: thread, fromName: "Ann" },
    { id: "r23", kind: "room", roomId: "shop", fromName: "Ben" },
  ];
  const { host, root } = await mountRings(ringtoneSpy().fn);
  ringsReply = [];
  settledReply = [
    { id: "r22", how: "missed" },
    { id: "r23", how: "missed" },
  ];
  await waitFor(() => /Missed calls/.test(host.textContent), 7000);
  const line = host.querySelector('section[role="region"] p');
  assert.equal(line.textContent, "Missed calls from Ann and Ben.");
  assert.doesNotMatch(host.textContent, /\d/, "no numbers");
  await act(async () => root.unmount());
});

test("the board toast moves up while a call card shows", async () => {
  ringsReply = [{ id: "r24", kind: "dm", threadId: thread, fromName: "Ann" }];
  const { button, root } = await mountRings(ringtoneSpy().fn);
  assert.match(document.documentElement.style.getPropertyValue("--call-card-h"), /^\d+px$/);
  ringsReply = [];
  await act(async () => button("Decline").click());
  await flush();
  assert.equal(document.documentElement.style.getPropertyValue("--call-card-h"), "");
  await act(async () => root.unmount());
  const find = readFileSync(
    new URL("../../components/board/find-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(find, /bottom-\[calc\([^\]]*\+var\(--call-card-h,0px\)\)\][^"]*z-40/);
  assert.match(find, /md:bottom-\[calc\(1\.5rem\+var\(--call-card-h,0px\)\)\]/);
});

test("the call alert comes first in the Tab order, and the DM note names Avouch Social", () => {
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  const shell = app.search(/<div\s+className="shell /);
  assert.ok(shell > -1);
  assert.ok(app.indexOf("<CallRings", shell) > -1);
  assert.ok(app.indexOf("<CallRings", shell) < app.indexOf("Skip to content", shell));
  const dm = readFileSync(new URL("../../components/board/dm-call.tsx", import.meta.url), "utf8");
  assert.match(dm, /if they have Avouch Social open\./);
});

test("answering in one tab stops the ring in the other right away, with no missed call", async () => {
  posts.length = 0;
  settledReply = [];
  ringsReply = [{ id: "r30", kind: "dm", threadId: thread, fromName: "Ann" }];
  const a = ringtoneSpy();
  const b = ringtoneSpy();
  const tabA = await mountRings(a.fn);
  const tabB = await mountRings(b.fn);
  assert.equal(b.started, 1);
  await act(async () => tabA.button("Decline").click());
  await waitFor(() => !tabB.host.querySelector('section[role="region"]'), 1000);
  assert.equal(tabB.host.querySelector('section[role="region"]'), null, "before the next poll");
  assert.equal(b.stopped, 1, "tab B stops ringing");
  // Tab B's next poll: the ring is gone, settled as declined. Not a missed call.
  ringsReply = [];
  settledReply = [{ id: "r30", how: "declined" }];
  await act(async () => new Promise((r) => setTimeout(r, 5300)));
  assert.doesNotMatch(tabB.host.textContent, /Missed call/);
  await act(async () => tabA.root.unmount());
  await act(async () => tabB.root.unmount());
});

test("a ring answered on another device, or dropped after removal, shows no missed call", async () => {
  settledReply = [];
  ringsReply = [
    { id: "r31", kind: "dm", threadId: thread, fromName: "Ann" },
    { id: "r32", kind: "room", roomId: "shop", fromName: "Josh" },
  ];
  const spy = ringtoneSpy();
  const { host, root } = await mountRings(spy.fn);
  ringsReply = [];
  settledReply = [
    { id: "r31", how: "answered" },
    { id: "r32", how: "gone" },
  ];
  await act(async () => new Promise((r) => setTimeout(r, 5300)));
  assert.equal(host.querySelector('section[role="region"]'), null, "the prompt is dismissed");
  assert.doesNotMatch(host.textContent, /Missed call/);
  assert.equal(spy.stopped, spy.started, "ringing stopped");
  await act(async () => root.unmount());
});

test("S2: the prompt stays position: fixed under the shell's position: relative rule", async () => {
  ringsReply = [{ id: "r33", kind: "dm", threadId: thread, fromName: "Ann" }];
  const shell = document.createElement("div");
  shell.className = "shell";
  document.body.append(shell);
  const root = createRoot(shell);
  await act(async () => {
    root.render(
      createElement(
        SessionContext.Provider,
        { value: live },
        createElement(CallRings, { onGo: () => {}, ringtone: ringtoneSpy().fn }),
      ),
    );
  });
  await flush();
  const card = shell.querySelector('section[role="region"]');
  assert.ok(card);
  const wrapper = shell.firstElementChild;
  assert.equal(shell.children.length, 1, "one wrapper is the shell's only child from here");
  assert.match(wrapper.className, /\bcontents\b/, "the wrapper has no box of its own");
  assert.notEqual(card.parentElement, shell, "the card is not a direct child of .shell");
  assert.match(card.className, /(^|\s)fixed(\s|$)/);
  // Every `.shell` position rule in the shipped CSS must only reach direct children.
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../../../public/", import.meta.url);
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".css"))) {
    const css = readFileSync(new URL(name, dir), "utf8");
    for (const m of css.matchAll(
      /([^{}]*\.shell[^{}]*)\{([^}]*position\s*:\s*(?:relative|static)[^}]*)\}/g,
    )) {
      for (const sel of m[1].split(",")) {
        if (!/\.shell\b/.test(sel)) continue;
        // An exclusion such as :not(.call-rings) is fine; a selector that targets it is not.
        assert.doesNotMatch(
          sel.trim().replace(/:not\([^)]*\)/g, ""),
          /\.shell\s+(?!>)|\.shell\s*>\s*\*\s+|\.call-rings/,
          `${name}: "${sel.trim()}" would reach the call card`,
        );
      }
    }
  }
  ringsReply = [];
  await act(async () => root.unmount());
  shell.remove();
});

test("a ring focuses the card, not Join, so a stray Enter or Space does not join", async () => {
  posts.length = 0;
  focusCalls.length = 0;
  document.body.focus();
  ringsReply = [{ id: "r40", kind: "dm", threadId: thread, fromName: "Ann" }];
  let went = 0;
  const { host, root } = await mountRings(ringtoneSpy().fn, () => went++);
  const card = host.querySelector('section[role="region"]');
  assert.ok(card);
  assert.ok(document.activeElement === card, "the card region has focus");
  assert.equal(card.getAttribute("tabindex"), "-1", "focusable by script, not a Tab stop");
  assert.match(card.className, /(^|\s)focus-target(\s|$)/, "the team's focus ring");
  assert.deepEqual(focusCalls.at(-1), { el: card, options: { preventScroll: true } });
  const join = [...card.querySelectorAll("button")].find((b) => b.textContent === "Join");
  assert.notEqual(document.activeElement, join, "Join is not focused");
  assert.equal(document.activeElement.tagName, "SECTION");
  for (const key of ["Enter", " "]) {
    await act(async () => {
      const target = document.activeElement;
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      target.dispatchEvent(new KeyboardEvent("keypress", { key, bubbles: true, cancelable: true }));
      target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
    });
    await flush();
  }
  assert.ok(host.querySelector('section[role="region"]'), "the ring still shows");
  assert.equal(went, 0);
  assert.equal(posts.length, 0, "no answer, dismiss or join was sent");
  assert.equal(
    [...host.querySelectorAll("button")].some((b) => /Leave call|Mute/.test(b.textContent)),
    false,
    "no call opened, so no mic",
  );
  ringsReply = [];
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await flush();
  assert.equal(host.querySelector('section[role="region"]'), null, "Escape still declines");
  await act(async () => root.unmount());
});

test("a ring does not take focus from someone typing; the live line still announces it", async () => {
  for (const make of [
    () => document.createElement("input"),
    () => document.createElement("textarea"),
    () => {
      const el = document.createElement("div");
      el.setAttribute("contenteditable", "true");
      el.tabIndex = 0;
      return el;
    },
  ]) {
    const field = make();
    document.body.append(field);
    field.focus();
    assert.ok(document.activeElement === field, "focus");
    ringsReply = [{ id: "r41", kind: "room", roomId: "shop", fromName: "Josh" }];
    const { host, root } = await mountRings(ringtoneSpy().fn);
    assert.ok(host.querySelector('section[role="region"]'));
    assert.ok(document.activeElement === field, `${field.tagName} keeps focus`);
    assert.equal(
      host.querySelector('p[role="status"]').textContent,
      "Josh is calling you into a room call.",
    );
    ringsReply = [];
    await act(async () => root.unmount());
    field.remove();
  }
});

test("a ring does not take focus while a dialog is open", async () => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const inside = document.createElement("button");
  inside.textContent = "Keep";
  dialog.append(inside);
  document.body.append(dialog);
  inside.focus();
  ringsReply = [{ id: "r42", kind: "dm", threadId: thread, fromName: "Ann" }];
  const { host, root } = await mountRings(ringtoneSpy().fn);
  assert.ok(host.querySelector('section[role="region"]'));
  assert.ok(document.activeElement === inside, "focus stays in the dialog");
  assert.equal(host.querySelector('p[role="status"]').textContent, "Ann is calling you.");
  ringsReply = [];
  await act(async () => root.unmount());
  dialog.remove();
});

test("S3: Join on a ring that went away (a block, say) opens nothing and says so", async () => {
  posts.length = 0;
  settledReply = [];
  ringsReply = [{ id: "r50", kind: "dm", threadId: thread, fromName: "Ann" }];
  overrides = {
    "/api/calls/rings/r50/dismiss": [
      409,
      { error: "That call isn't available anymore.", record: false },
    ],
  };
  let went = 0;
  const { host, root, button } = await mountRings(ringtoneSpy().fn, () => went++);
  ringsReply = [];
  await act(async () => button("Join").click());
  await flush();
  assert.ok(posts.some((p) => p.url.endsWith("/api/calls/rings/r50/dismiss")));
  assert.equal(
    posts.some((p) => p.url.endsWith("/join")),
    false,
    "no join was sent, so no mic",
  );
  assert.equal(went, 0);
  assert.match(host.textContent, /That call isn't available anymore\./);
  assert.equal(
    [...host.querySelectorAll("button")].some((b) => /Leave call|Mute/.test(b.textContent)),
    false,
  );
  overrides = {};
  await act(async () => root.unmount());
});

test("S3: a Join refused with a missing error says calls aren't working, in our words", async () => {
  ringsReply = [{ id: "r51", kind: "room", roomId: "shop", fromName: "Josh" }];
  overrides = { "/api/calls/rings/r51/dismiss": [503, null] };
  let went = 0;
  const { host, root, button } = await mountRings(ringtoneSpy().fn, () => went++);
  ringsReply = [];
  await act(async () => button("Join").click());
  await flush();
  assert.equal(went, 0, "the room is not opened");
  assert.match(host.textContent, /Calls aren't working right now\. Try again in a moment\./);
  overrides = {};
  await act(async () => root.unmount());
});

test("S4: a 503 on Join does not use the ring up; it shows again on the next good poll", async () => {
  ringsReply = [{ id: "r58", kind: "dm", threadId: thread, fromName: "Ann" }];
  overrides = { "/api/calls/rings/r58/dismiss": [503, { error: "x", record: false }] };
  const spy = ringtoneSpy();
  const { host, root, button } = await mountRings(spy.fn);
  await act(async () => button("Join").click());
  await flush();
  assert.match(host.textContent, /Calls aren't working right now\. Try again in a moment\./);
  assert.equal(button("Join"), undefined, "hidden while the check is down");
  // The check recovers: the server still has the ring, and so does this tab.
  overrides = {};
  await waitFor(() => Boolean(button("Join")), 7000);
  assert.ok(button("Join"), "the ring is back");
  assert.match(host.querySelector('section[role="region"]').textContent, /Ann is calling you\./);
  assert.equal(spy.started, 2, "it rings again");
  ringsReply = [];
  await act(async () => root.unmount());
});

test("S4: a 409 on Join uses the ring up, so a stale poll does not bring it back", async () => {
  ringsReply = [{ id: "r59", kind: "dm", threadId: thread, fromName: "Ann" }];
  overrides = { "/api/calls/rings/r59/dismiss": [409, { error: "x", record: false }] };
  const { host, root, button } = await mountRings(ringtoneSpy().fn);
  await act(async () => button("Join").click());
  await flush();
  assert.match(host.textContent, /That call isn't available anymore\./);
  // Even if a poll still lists it, it stays gone.
  await waitFor(() => false, 5600);
  assert.equal(button("Join"), undefined);
  overrides = {};
  ringsReply = [];
  await act(async () => root.unmount());
});

test("S3: a refused Join never shows the server's own text, only known sentences", async () => {
  const raw = 'relation "dm_block" does not exist';
  for (const [id, status, expected] of [
    ["r53", 409, "That call isn't available anymore."],
    ["r54", 503, "Calls aren't working right now. Try again in a moment."],
    ["r55", 500, "Calls aren't working right now. Try again in a moment."],
    ["r56", 403, "Calls aren't working right now. Try again in a moment."],
  ]) {
    ringsReply = [{ id, kind: "dm", threadId: thread, fromName: "Ann" }];
    overrides = { [`/api/calls/rings/${id}/dismiss`]: [status, { error: raw, record: false }] };
    const { host, root, button } = await mountRings(ringtoneSpy().fn);
    ringsReply = [];
    await act(async () => button("Join").click());
    await flush();
    assert.equal(host.textContent.includes("dm_block"), false, `${status}: raw text hidden`);
    assert.ok(host.textContent.includes(expected), `${status}: ${host.textContent}`);
    overrides = {};
    await act(async () => root.unmount());
  }
});

test("M1: the live line is assertive for a ring, polite for missed and ended notices", async () => {
  ringsReply = [{ id: "r52", kind: "dm", threadId: thread, fromName: "Ann" }];
  settledReply = [{ id: "r52", how: "missed" }];
  const { host, root } = await mountRings(ringtoneSpy().fn);
  const spoken = host.querySelector('p[role="status"]');
  assert.equal(spoken.getAttribute("aria-live"), "assertive", "an incoming ring");
  assert.equal(spoken.getAttribute("aria-atomic"), "true");
  assert.equal(spoken.textContent, "Ann is calling you.");
  assert.equal(host.querySelectorAll("[aria-live]").length, 1, "one live region only");
  // The focused card does not say the sentence again: no live region, no
  // aria-label or labelledby pointing at the same words.
  const card = host.querySelector('section[role="region"]');
  assert.equal(card.contains(spoken), false);
  assert.equal(card.getAttribute("aria-live"), null);
  assert.equal(card.getAttribute("aria-labelledby"), null);
  assert.equal(card.getAttribute("aria-label"), "Incoming call");
  assert.equal(
    card.querySelectorAll("[aria-live], [role=status], [role=alert], [aria-label]").length,
    0,
  );
  // The ring goes away unanswered: the missed-call notice is polite.
  ringsReply = [];
  await waitFor(() => /Missed call from Ann\./.test(spoken.textContent), 7000);
  assert.match(spoken.textContent, /Ann/);
  assert.equal(spoken.getAttribute("aria-live"), "polite", "a missed-call notice");
  assert.equal(host.querySelectorAll("[aria-live]").length, 1);
  settledReply = [];
  await act(async () => root.unmount());
});

test("M1: a call-ended notice is polite", async () => {
  ringsReply = [{ id: "r57", kind: "dm", threadId: thread, fromName: "Ann" }];
  joinReply = {
    record: false,
    selfId: "ada",
    cursor: 0,
    ringing: false,
    peers: [{ id: "ann", name: "Ann", generation: 1 }],
    iceServers: [],
  };
  pollReplies = [{ record: false, peers: [], signals: [], cursor: 0 }];
  const { host, root, button } = await mountRings(ringtoneSpy().fn);
  const spoken = host.querySelector('p[role="status"]');
  assert.equal(spoken.getAttribute("aria-live"), "assertive");
  ringsReply = [];
  await act(async () => button("Join").click());
  await waitFor(() => spoken.textContent === "Ann left. The call ended.");
  assert.equal(spoken.isConnected, true, "the same live line, always mounted");
  assert.equal(spoken.textContent, "Ann left. The call ended.");
  assert.equal(spoken.getAttribute("aria-live"), "polite");
  await act(async () => root.unmount());
});

test("low 4: the call card drops into the tab bar's space while typing hides the tab bar", () => {
  const css = readFileSync(new URL("../../../public/fluid.css", import.meta.url), "utf8");
  assert.match(css, /html\[data-keyboard="open"\] \.call-rings\{--tabbar-h:0px\}/);
  assert.match(css, /:focus\) \.call-rings\{--tabbar-h:0px\}/);
});

/** The member picker shows once you are in the room call. */
async function joinRoomCall(host) {
  joinReply = { record: false, selfId: "ada", cursor: 0, peers: [], iceServers: [] };
  pollReplies = [{ record: false, peers: [], signals: [], cursor: 0 }];
  await flush();
  const join = [...host.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === "Join the call",
  );
  assert.ok(join, "the room call's Join shows");
  await act(async () => join.click());
  await waitFor(() =>
    [...host.querySelectorAll("button")].some((b) => b.textContent.trim() === "Leave call"),
  );
  await flush();
}

test("low 3: a picker that fails to load says so with Try again, and Try again reloads it", async () => {
  const picker = "/api/calls/rooms/shop/ring";
  const failed = "We couldn't load the members you can call.";
  overrides = { [picker]: [503, { canRing: false, members: [], error: failed, record: false }] };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        SessionContext.Provider,
        { value: live },
        createElement(RoomCall, { roomId: "shop" }),
      ),
    );
  });
  await joinRoomCall(host);
  const button = (text) =>
    [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const line = [...host.querySelectorAll('p[role="status"]')].find((p) => p.textContent === failed);
  assert.ok(line, "the failure is a status line");
  const retry = button("Try again");
  assert.ok(retry, "Try again shows");
  assert.match(retry.className, /min-h-\[44px\]/);
  // Still failing: the picker stays, and the line is set again.
  await act(async () => retry.click());
  await flush();
  assert.ok(button("Try again"), "still there after a second failure");
  assert.ok(host.textContent.includes(failed));
  // Now it loads: the list replaces the note and takes focus.
  overrides = {
    [picker]: [200, { canRing: true, members: [{ id: "ben", name: "Ben" }], record: false }],
  };
  await act(async () => button("Try again").click());
  await flush();
  assert.equal(button("Try again"), undefined);
  assert.equal(host.textContent.includes(failed), false);
  const select = host.querySelector("select");
  assert.ok(select, "the member list shows");
  assert.ok([...select.options].some((o) => o.textContent === "Ben"));
  assert.ok(document.activeElement === select, "focus lands on the list");
  overrides = {};
  await act(async () => root.unmount());
  host.remove();
});

test("low 3: someone who can't ring sees no picker, and raw server text never shows", async () => {
  const picker = "/api/calls/rooms/shop/ring";
  for (const reply of [
    [200, { canRing: false, members: [], record: false }],
    [403, { error: 'relation "dm_block" does not exist', record: false }],
  ]) {
    overrides = { [picker]: reply };
    const { host } = await mountPicker();
    assert.equal(host.querySelector("select"), null);
    assert.equal(host.textContent.includes("Try again"), false);
    assert.equal(host.textContent.includes("dm_block"), false);
  }
  // The picker's own 503 (sent only once the permission check passed) shows the plain line.
  overrides = { [picker]: [503, PICKER_FAULT] };
  const { host } = await mountPicker();
  assert.ok(host.textContent.includes(PICKER_LINE));
  assert.equal(host.textContent.includes("dm_block"), false);
});

const PICKER = "/api/calls/rooms/shop/ring";
const PICKER_LINE = "We couldn't load the members you can call.";
/** The server's picker 503: the permission check passed, then the list failed. */
const PICKER_FAULT = {
  canRing: false,
  members: [],
  error: PICKER_LINE,
  checked: true,
  record: false,
};
const pickerLoads = () => gets.filter((url) => url.endsWith(PICKER)).length;

async function mountPicker() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        SessionContext.Provider,
        { value: live },
        createElement(RoomCall, { roomId: "shop" }),
      ),
    );
  });
  await joinRoomCall(host);
  const button = (text) =>
    [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  return { host, root, button };
}

async function pressRetry(button) {
  const retry = button("Try again");
  assert.ok(retry, "Try again shows");
  retry.focus();
  await act(async () => retry.click());
  await flush();
  return retry;
}

test("QA on #128: a first-load fault with no sign they can ring stays hidden, with one quiet retry", async () => {
  for (const reply of [
    [500, { error: 'relation "dm_block" does not exist' }],
    [502, null],
    [503, { error: "Calls aren't working right now. Try again in a moment.", record: false }],
    "network",
  ]) {
    overrides = { [PICKER]: reply };
    const before = pickerLoads();
    const { host, root } = await mountPicker();
    const label = String(reply[0] ?? reply);
    assert.equal(host.querySelector("select"), null, `${label}: no picker`);
    assert.equal(host.textContent.includes(PICKER_LINE), false, `${label}: no failure line`);
    assert.equal(host.textContent.includes("Try again"), false, `${label}: no Try again`);
    assert.equal(host.textContent.includes("dm_block"), false);
    await waitFor(() => pickerLoads() - before === 2, 6000);
    assert.equal(pickerLoads() - before, 2, `${label}: one quiet retry`);
    await new Promise((r) => setTimeout(r, 3500));
    assert.equal(pickerLoads() - before, 2, `${label}: and only one`);
    assert.equal(host.textContent.includes(PICKER_LINE), false, `${label}: still quiet`);
    await act(async () => root.unmount());
    host.remove();
  }
});

test("QA on #128: the quiet retry that works shows the list without moving focus", async () => {
  let n = 0;
  overrides = {
    [PICKER]: () =>
      n++ === 0 ? [502, null] : [200, { canRing: true, members: [{ id: "ben", name: "Ben" }] }],
  };
  const { host } = await mountPicker();
  assert.equal(host.querySelector("select"), null);
  const was = document.activeElement;
  await waitFor(() => host.querySelector("select"), 6000);
  assert.ok([...host.querySelector("select").options].some((o) => o.textContent === "Ben"));
  assert.ok(document.activeElement === was, "a quiet retry doesn't take focus");
  assert.equal(host.textContent.includes(PICKER_LINE), false);
});

test("QA on #128: an earlier 'can ring' in this panel is evidence, so a later fault shows the line", async () => {
  overrides = { [PICKER]: [200, { canRing: true, members: [{ id: "ben", name: "Ben" }] }] };
  const { host, button } = await mountPicker();
  assert.ok(host.querySelector("select"));
  await act(async () => button("Leave call").click());
  await flush();
  overrides = { [PICKER]: "network" };
  await joinRoomCall(host);
  assert.ok(host.textContent.includes(PICKER_LINE), "the line shows: they can ring here");
  assert.ok(button("Try again"));
});

test("QA S4 on #128: a later canRing false ends the evidence, so a plain 503 stays quiet", async () => {
  overrides = { [PICKER]: [200, { canRing: true, members: [{ id: "ben", name: "Ben" }] }] };
  const { host, button } = await mountPicker();
  assert.ok(host.querySelector("select"), "a host: the list shows");
  // Host rights are gone: the next load says so.
  await act(async () => button("Leave call").click());
  await flush();
  overrides = { [PICKER]: [200, { canRing: false, members: [], record: false }] };
  await joinRoomCall(host);
  assert.equal(host.querySelector("select"), null);
  // Then a plain 503 (not the picker's own): no evidence any more, so no line.
  await act(async () => button("Leave call").click());
  await flush();
  overrides = {
    [PICKER]: [
      503,
      { error: "Calls aren't working right now. Try again in a moment.", record: false },
    ],
  };
  await joinRoomCall(host);
  assert.equal(host.textContent.includes(PICKER_LINE), false, "no failure line");
  assert.equal(button("Try again"), undefined);
});

test("QA S4: a Try again that fails any other way keeps the line, the button and focus", async () => {
  overrides = { [PICKER]: [503, PICKER_FAULT] };
  const { host, button } = await mountPicker();
  for (const reply of [
    [500, { error: "boom" }],
    [403, { error: "Not allowed." }],
    [503, { error: "Calls aren't working right now. Try again in a moment." }],
    "network",
  ]) {
    overrides = { [PICKER]: reply };
    const retry = await pressRetry(button);
    assert.equal(button("Try again"), retry, `${String(reply[0] ?? reply)}: the same button stays`);
    assert.ok(document.activeElement === retry, "focus stays on Try again, not the page");
    assert.ok(host.textContent.includes(PICKER_LINE));
    assert.equal(host.textContent.includes("boom"), false);
  }
});

test("Design L5: after Try again works, focus moves to the member list with the focus ring", async () => {
  overrides = { [PICKER]: [503, PICKER_FAULT] };
  const { host, button } = await mountPicker();
  overrides = { [PICKER]: [200, { canRing: true, members: [{ id: "ben", name: "Ben" }] }] };
  await pressRetry(button);
  const select = host.querySelector("select");
  assert.ok(select);
  assert.ok(document.activeElement === select, "focus");
  assert.equal(select.hasAttribute("data-focus-ring"), true, "focusWithRing");
});

test("Design L6: a Try again that brings back an empty list focuses the call panel", async () => {
  overrides = { [PICKER]: [503, PICKER_FAULT] };
  const { host, button } = await mountPicker();
  overrides = { [PICKER]: [200, { canRing: true, members: [] }] };
  await pressRetry(button);
  assert.equal(button("Try again"), undefined);
  const panel = host.querySelector("section");
  assert.ok(document.activeElement === panel, "focus lands on the call panel, not the page");
  assert.equal(panel.hasAttribute("data-focus-ring"), true, "focusWithRing");
  assert.equal(panel.getAttribute("tabindex"), "-1");
});

test("QA S4: once Ben answers, 'Calling Ben.' goes and Ben is no longer offered", async () => {
  overrides = {
    [PICKER]: [
      200,
      {
        canRing: true,
        members: [
          { id: "ben", name: "Ben" },
          { id: "cy", name: "Cy" },
        ],
      },
    ],
  };
  const { host, button } = await mountPicker();
  const select = host.querySelector("select");
  await act(async () => {
    select.value = "ben";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => button("Call Ben").click());
  await flush();
  assert.match(host.textContent, /Calling Ben\. It rings for up to a minute\./);
  // Ben joins: the next poll has him in the call.
  pollReplies = [
    { record: false, peers: [{ id: "ben", name: "Ben", generation: 1 }], signals: [], cursor: 1 },
  ];
  await waitFor(() => !/Calling Ben\./.test(host.textContent), 6000);
  assert.doesNotMatch(host.textContent, /Calling Ben\./);
  const names = [...host.querySelector("select").options].map((o) => o.textContent);
  assert.deepEqual(names, ["Choose a member", "Cy"], "Ben is in the call, so not offered");
  const said = [...host.querySelectorAll('p[role="status"]')].map((p) => p.textContent);
  assert.ok(said.includes("Ben joined the call."), "Design L3: the status line says Ben joined");
  pollReplies = [{ record: false, peers: [], signals: [], cursor: 0 }];
});

async function ringFrom(members, who) {
  overrides = { [PICKER]: [200, { canRing: true, members }] };
  const mounted = await mountPicker();
  const select = mounted.host.querySelector("select");
  await act(async () => {
    select.value = who.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const call = mounted.button(`Call ${who.name}`);
  call.focus();
  await act(async () => call.click());
  await flush();
  assert.ok(document.activeElement === call, "focus");
  return { ...mounted, call };
}

test("Design M1: when the member rung joins, the focused Call button stays focusable and does nothing", async () => {
  const { host, call } = await ringFrom(
    [
      { id: "ben", name: "Ben" },
      { id: "cy", name: "Cy" },
    ],
    { id: "ben", name: "Ben" },
  );
  pollReplies = [
    { record: false, peers: [{ id: "ben", name: "Ben", generation: 1 }], signals: [], cursor: 1 },
  ];
  await waitFor(() => !/Calling Ben\./.test(host.textContent), 6000);
  assert.equal(call.isConnected, true, "the same button is still there");
  assert.equal(call.textContent.trim(), "Call");
  assert.equal(call.disabled, false, "no native disabled, so focus is not dropped");
  assert.equal(call.getAttribute("aria-disabled"), "true");
  assert.match(call.className, /aria-disabled:opacity-70/, "4.5:1 in both themes");
  assert.ok(document.activeElement === call, "focus stays on the Call button");
  const before = posts.length;
  await act(async () => call.click());
  await flush();
  assert.equal(posts.length, before, "a click with nobody chosen rings nobody");
  pollReplies = [{ record: false, peers: [], signals: [], cursor: 0 }];
});

test("Design M1: when the last member on the list joins, focus goes to the call panel, not the page", async () => {
  const { host } = await ringFrom([{ id: "ben", name: "Ben" }], { id: "ben", name: "Ben" });
  pollReplies = [
    { record: false, peers: [{ id: "ben", name: "Ben", generation: 1 }], signals: [], cursor: 1 },
  ];
  await waitFor(() => !host.querySelector("select"), 6000);
  await flush();
  const panel = host.querySelector("section");
  assert.ok(document.activeElement === panel, "focus lands on the call panel");
  assert.equal(panel.hasAttribute("data-focus-ring"), true, "focusWithRing");
  pollReplies = [{ record: false, peers: [], signals: [], cursor: 0 }];
});

test("QA S3: a card that shows while typing scrolls the field clear of it", async () => {
  const box = document.createElement("div");
  const field = document.createElement("textarea");
  box.append(field);
  document.body.append(box);
  const scrolled = [];
  field.scrollIntoView = (o) => scrolled.push(o);
  field.getBoundingClientRect = () => ({ top: 760, bottom: 800, left: 0, right: 390 });
  const realRect = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.matches?.('section[role="region"]')
      ? { top: 640, bottom: 780, left: 16, right: 374 }
      : realRect.call(this);
  };
  try {
    field.focus();
    ringsReply = [{ id: "r70", kind: "dm", threadId: thread, fromName: "Ann" }];
    await mountRings(ringtoneSpy().fn);
    assert.ok(document.activeElement === field, "typing keeps focus");
    assert.ok(scrolled.length > 0, "the field was scrolled clear of the card");
    assert.deepEqual(scrolled[0], { block: "nearest" });
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect = realRect;
    box.remove();
  }
});

test("QA S3: keepFieldClear leaves a field alone when the card is not over it, or it is a button", async () => {
  const card = document.createElement("section");
  card.getBoundingClientRect = () => ({ top: 640, bottom: 780 });
  const field = document.createElement("input");
  const press = document.createElement("button");
  document.body.append(card, field, press);
  const scrolled = [];
  field.scrollIntoView = press.scrollIntoView = () => scrolled.push(1);
  field.getBoundingClientRect = () => ({ top: 300, bottom: 340 });
  field.focus();
  keepFieldClear(card);
  press.getBoundingClientRect = () => ({ top: 700, bottom: 740 });
  press.focus();
  keepFieldClear(card);
  assert.equal(scrolled.length, 0);
  field.getBoundingClientRect = () => ({ top: 700, bottom: 740 });
  field.focus();
  keepFieldClear(card);
  assert.equal(scrolled.length, 1);
  card.remove();
  field.remove();
  press.remove();
});

test("Design L2: keepFieldClear leaves a focused field alone once it is scrolled out of view below", async () => {
  // Reading back up the history with the composer focused: the field is below the screen.
  const card = document.createElement("section");
  card.getBoundingClientRect = () => ({ top: 649, bottom: 773 });
  const field = document.createElement("textarea");
  document.body.append(card, field);
  const scrolled = [];
  field.scrollIntoView = (o) => scrolled.push(o);
  try {
    field.focus();
    field.getBoundingClientRect = () => ({
      top: window.innerHeight,
      bottom: window.innerHeight + 56,
    });
    keepFieldClear(card);
    field.getBoundingClientRect = () => ({
      top: window.innerHeight + 900,
      bottom: window.innerHeight + 956,
    });
    keepFieldClear(card);
    assert.equal(scrolled.length, 0, "the page stays where they scrolled it");
    // In view and under the card: still scrolled clear, and only with scrollIntoView.
    field.getBoundingClientRect = () => ({
      top: card.getBoundingClientRect().top + 10,
      bottom: card.getBoundingClientRect().top + 66,
    });
    keepFieldClear(card);
    assert.deepEqual(scrolled, [{ block: "nearest" }]);
  } finally {
    card.remove();
    field.remove();
  }
});

/** restoreFocus moves focus in an animation frame: wait one out, and a little more. */
const nextFrame = () => new Promise((r) => window.requestAnimationFrame(() => setTimeout(r, 20)));

test("Design M2 on #128: Decline, or a Join that fails, leaves focus in the field being typed in", async () => {
  const main = document.createElement("main");
  main.id = "main";
  main.tabIndex = -1;
  const field = document.createElement("textarea");
  main.append(field);
  document.body.append(main);
  const press = async (b) => {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    b.dispatchEvent(down);
    if (!down.defaultPrevented) b.focus();
    await act(async () => b.click());
    await flush();
    await nextFrame();
  };
  try {
    field.focus();
    ringsReply = [{ id: "r72", kind: "dm", threadId: thread, fromName: "Ann" }];
    const first = await mountRings(ringtoneSpy().fn);
    ringsReply = [];
    assert.ok(document.activeElement === field, "focus");
    await press(first.button("Decline"));
    assert.equal(first.button("Decline"), undefined, "the card is gone");
    assert.ok(document.activeElement === field, "Decline: still in the field, not #main");
    await act(async () => first.root.unmount());

    field.focus();
    ringsReply = [{ id: "r73", kind: "dm", threadId: thread, fromName: "Ann" }];
    overrides = { "/api/calls/rings/r73/dismiss": [409, { error: "gone", record: false }] };
    const second = await mountRings(ringtoneSpy().fn);
    ringsReply = [];
    await press(second.button("Join"));
    assert.ok(second.host.textContent.includes("That call isn't available anymore."));
    assert.ok(document.activeElement === field, "a failed Join: still in the field, not #main");
    overrides = {};
    await act(async () => second.root.unmount());

    // Focus in the card (a keyboard user on Decline): it still goes back, here to #main.
    field.blur();
    ringsReply = [{ id: "r74", kind: "dm", threadId: thread, fromName: "Ann" }];
    const third = await mountRings(ringtoneSpy().fn);
    ringsReply = [];
    const decline = third.button("Decline");
    decline.focus();
    await act(async () => decline.click());
    await flush();
    await nextFrame();
    assert.ok(document.activeElement === main, "from inside the card, focus is put back");
    await act(async () => third.root.unmount());
  } finally {
    overrides = {};
    main.remove();
  }
});

test("QA on #128: pressing Decline while a field has focus keeps focus there, so the card doesn't jump", async () => {
  const field = document.createElement("textarea");
  document.body.append(field);
  try {
    field.focus();
    ringsReply = [{ id: "r71", kind: "dm", threadId: thread, fromName: "Ann" }];
    const { host } = await mountRings(ringtoneSpy().fn);
    assert.ok(document.activeElement === field, "focus");
    const decline = [...host.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Decline",
    );
    assert.ok(decline);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    decline.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true, "the field keeps focus, so the tab bar stays away");
    // Not on the card's own text, and not without a text field focused.
    const text = host.querySelector('section[role="region"] p');
    const onText = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    text.dispatchEvent(onText);
    assert.equal(onText.defaultPrevented, false);
    field.blur();
    const plain = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    decline.dispatchEvent(plain);
    assert.equal(plain.defaultPrevented, false);
  } finally {
    field.remove();
  }
});

test("QA S3: html's bottom scroll padding and main's padding reserve the call card's height", () => {
  const css = readFileSync(new URL("../../../public/fluid.css", import.meta.url), "utf8");
  assert.match(
    css,
    /html\{scroll-padding-bottom:calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom\) \+ \.5rem \+ var\(--call-card-h,0px\)\)\}/,
  );
  assert.match(css, /\.shell-body > main\{padding-bottom:calc\([^}]*var\(--call-card-h,0px\)\)\}/);
});
