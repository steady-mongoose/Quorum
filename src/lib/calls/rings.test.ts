import assert from "node:assert/strict";
import test from "node:test";
import { missedLine, parseRings, ringLine } from "./rings.ts";
import { parseRingOutcomes } from "./status.ts";
import { RING_EVERY_MS, RING_FOR_MS, VIBRATE_PATTERN, startRinging } from "./ringtone.ts";

const thread = "11111111-2222-3333-4444-555555555555";

test("parseRings keeps well-formed rings only", () => {
  assert.deepEqual(
    parseRings({
      record: false,
      rings: [
        { id: "r1", roomId: "shop", fromName: "Josh" },
        { id: "x", roomId: "shop", fromName: "Bad" },
        { id: "r2", roomId: "../admin", fromName: "Bad" },
        { id: "r3", roomId: "shop", fromName: "" },
        { id: "r4", kind: "dm", threadId: thread, fromName: "Ann" },
        { id: "r5", kind: "dm", threadId: "../x", fromName: "Bad" },
        { id: "r6", kind: "other", roomId: "shop", fromName: "Bad" },
      ],
    }),
    [
      { id: "r1", kind: "room", roomId: "shop", fromName: "Josh" },
      { id: "r4", kind: "dm", threadId: thread, fromName: "Ann" },
    ],
  );
  assert.deepEqual(parseRings({ rings: [{ id: "r1", roomId: "a", fromName: "b" }] }), []);
  assert.deepEqual(parseRings(null), []);
});

test("the prompt and missed-call lines are plain words with the caller's name", () => {
  assert.equal(
    ringLine({ id: "r1", kind: "dm", threadId: thread, fromName: "Ann" }),
    "Ann is calling you.",
  );
  assert.equal(
    ringLine({ id: "r1", kind: "room", roomId: "shop", fromName: "Josh" }),
    "Josh is calling you to a room call.",
  );
  assert.equal(missedLine("Ann"), "Missed call from Ann.");
});

test("parseRingOutcomes keeps declined and missed only", () => {
  assert.deepEqual(
    parseRingOutcomes([
      { kind: "declined", name: "Ben" },
      { kind: "missed", name: "Ann" },
      { kind: "accepted", name: "X" },
      { kind: "declined", name: "" },
      null,
    ]),
    [
      { kind: "declined", name: "Ben" },
      { kind: "missed", name: "Ann" },
    ],
  );
  assert.deepEqual(parseRingOutcomes(undefined), []);
});

test("the ringtone beeps and buzzes now and every few seconds, then stops cleanly", () => {
  const calls: string[] = [];
  const timers = new Map<number, { fn: () => void; ms: number; every: boolean }>();
  let next = 1;
  const stop = startRinging({
    beep: () => calls.push("beep"),
    vibrate: (p) => calls.push(`vibrate:${JSON.stringify(p)}`),
    setInterval: (fn, ms) => (timers.set(next, { fn, ms, every: true }), next++),
    clearInterval: (id) => timers.delete(id as number),
    setTimeout: (fn, ms) => (timers.set(next, { fn, ms, every: false }), next++),
    clearTimeout: (id) => timers.delete(id as number),
    release: () => calls.push("release"),
  });
  assert.deepEqual(calls, ["beep", `vibrate:${JSON.stringify(VIBRATE_PATTERN)}`]);
  const every = [...timers.values()].find((t) => t.every);
  assert.equal(every?.ms, RING_EVERY_MS);
  assert.equal([...timers.values()].find((t) => !t.every)?.ms, RING_FOR_MS);
  every?.fn();
  assert.equal(calls.filter((c) => c === "beep").length, 2);
  stop();
  stop();
  assert.equal(timers.size, 0, "no timers left");
  assert.deepEqual(calls.slice(-2), ["vibrate:0", "release"], "buzz cancelled once");
  every?.fn();
  assert.equal(calls.filter((c) => c === "beep").length, 2, "silent after stop");
});

test("the ringtone works with no sound or buzz at all", () => {
  const stop = startRinging({
    setInterval: () => 1,
    clearInterval: () => undefined,
    setTimeout: () => 2,
    clearTimeout: () => undefined,
  });
  stop();
});
