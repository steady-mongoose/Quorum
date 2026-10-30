// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
// Incoming-call alert (ring), Decline, and "the call ended" on both sides.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
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
const posts = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (init?.method === "POST") posts.push({ url, body: init.body });
  let body;
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
const { createRoot } = await import("react-dom/client");
const { SessionContext, EMPTY_SERVER_SESSION } = await import("../server-session-state.ts");
const { CallRings, focusRoomCall } = await import("../../components/board/call-rings.tsx");
const { CallPanel } = await import("../../components/board/room-call.tsx");

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
  assert.equal(document.activeElement, button("Mute"), "Mute has focus once live");
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
  assert.equal(document.activeElement, input, "focus stays where you were");
  input.remove();
  await act(async () => root.unmount());
});

test("a long name is cut on screen, kept in full for screen readers, and wraps at 390", async () => {
  const name = "Alexandria Montgomery-Featherstonehaugh the Third of Avouch";
  ringsReply = [{ id: "r21", kind: "dm", threadId: thread, fromName: name }];
  const { host, root } = await mountRings(ringtoneSpy().fn);
  const line = host.querySelector('section[role="region"] p');
  assert.ok(line.textContent.endsWith("… is calling you."), line.textContent);
  assert.ok([...line.textContent.split(" is calling")[0]].length <= 40, "name clamped to 40");
  assert.equal(line.getAttribute("aria-label"), `${name} is calling you.`);
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
  const shell = app.indexOf('<div className="shell ');
  assert.ok(shell > -1);
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
        assert.doesNotMatch(
          sel.trim(),
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
  document.body.focus();
  ringsReply = [{ id: "r40", kind: "dm", threadId: thread, fromName: "Ann" }];
  let went = 0;
  const { host, root } = await mountRings(ringtoneSpy().fn, () => went++);
  const card = host.querySelector('section[role="region"]');
  assert.ok(card);
  assert.equal(document.activeElement, card, "the card region has focus");
  assert.equal(card.getAttribute("tabindex"), "-1", "focusable by script, not a Tab stop");
  assert.match(
    card.className,
    /focus:outline-2 focus:outline-offset-2 focus:outline-\[var\(--color-fg\)\]/,
  );
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
    assert.equal(document.activeElement, field);
    ringsReply = [{ id: "r41", kind: "room", roomId: "shop", fromName: "Josh" }];
    const { host, root } = await mountRings(ringtoneSpy().fn);
    assert.ok(host.querySelector('section[role="region"]'));
    assert.equal(document.activeElement, field, `${field.tagName} keeps focus`);
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
  assert.equal(document.activeElement, inside, "focus stays in the dialog");
  assert.equal(host.querySelector('p[role="status"]').textContent, "Ann is calling you.");
  ringsReply = [];
  await act(async () => root.unmount());
  dialog.remove();
});
