import assert from "node:assert/strict";
import test from "node:test";
import { planRoomDecision, planRoomRequest, planZipCorrection } from "./room-requests.ts";

const taken = {
  takenRoomIds: ["rv-town", "town-riverview-fl"],
  takenTownIds: ["riverview-fl"],
  takenCongregationIds: ["grace"],
  takenRegionIds: ["hillsborough"],
  openTownIds: [] as string[],
  openCongregationIds: [] as string[],
  openRegionIds: [] as string[],
};

test("a town room waits for an admin, and a ZIP is not a room", () => {
  const asked = planRoomRequest({ ...taken, kind: "town", name: "Seffner", state: "fl" });
  assert.equal(asked.ok, true);
  if (!asked.ok) return;
  assert.equal(asked.draft.townId, "seffner-fl");
  assert.equal(asked.draft.roomId, "town-seffner-fl");
  assert.equal(planRoomRequest({ ...taken, kind: "town", name: "Riverview", state: "FL" }).ok, false);
  assert.equal(planRoomRequest({ ...taken, kind: "town", name: "Сеффнер", state: "FL" }).ok, false);
  const open = planRoomRequest({
    ...taken,
    openTownIds: ["dover-fl"],
    kind: "town",
    name: "Dover",
    state: "FL",
  });
  assert.equal(open.ok, false);

  const own = planRoomDecision({
    admin: true,
    actorId: "maria",
    requesterId: "maria",
    open: true,
    decision: "approved",
    note: "Seffner has people asking.",
  });
  assert.equal(own.ok, false);
  const steward = planRoomDecision({
    admin: false,
    actorId: "tom",
    requesterId: "maria",
    open: true,
    decision: "approved",
    note: "Seffner has people asking.",
  });
  assert.equal(steward.ok, false);
  const approved = planRoomDecision({
    admin: true,
    actorId: "josh",
    requesterId: "maria",
    open: true,
    decision: "approved",
    note: "Seffner has people asking.",
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approved.note, "Seffner has people asking.");
});

test("only an admin corrects a ZIP", () => {
  const set = planZipCorrection({
    admin: true,
    zip: "33578-0001",
    name: "Riverview",
    state: "fl",
    clear: false,
  });
  assert.equal(set.ok, true);
  if (!set.ok) return;
  assert.equal(set.townId, "riverview-fl");
  assert.equal(planZipCorrection({ admin: false, zip: "33578", name: "Riverview", state: "FL", clear: false }).ok, false);
  const cleared = planZipCorrection({ admin: true, zip: "33578", name: "", state: "", clear: true });
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  assert.equal(cleared.townId, "");
});
