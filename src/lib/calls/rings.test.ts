import assert from "node:assert/strict";
import test from "node:test";
import { parseRings } from "./rings.ts";

test("parseRings keeps well-formed rings only", () => {
  assert.deepEqual(
    parseRings({
      record: false,
      rings: [
        { id: "r1", roomId: "shop", fromName: "Josh" },
        { id: "x", roomId: "shop", fromName: "Bad" },
        { id: "r2", roomId: "../admin", fromName: "Bad" },
        { id: "r3", roomId: "shop", fromName: "" },
      ],
    }),
    [{ id: "r1", roomId: "shop", fromName: "Josh" }],
  );
  assert.deepEqual(parseRings({ rings: [{ id: "r1", roomId: "a", fromName: "b" }] }), []);
  assert.deepEqual(parseRings(null), []);
});
