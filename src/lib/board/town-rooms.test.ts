import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEMBER_ROOMS } from "./places.ts";
import { decideTownRoom, requestTownRoom, townRoomFromRequest } from "./town-rooms.ts";

describe("town room requests", () => {
  it("does not create a room until an admin or steward approves, and keeps the log", () => {
    const asked = requestTownRoom("Maria", MEMBER_ROOMS, [], { name: "Seffner", state: "fl" }, 5, "tr1");
    assert.equal(asked.ok, true);
    if (!asked.ok) return;
    assert.equal(asked.value.status, "open");
    assert.equal(asked.value.townId, "seffner-fl");
    assert.equal(MEMBER_ROOMS.some((room) => room.scope.kind === "town" && room.scope.townId === "seffner-fl"), false);

    const own = decideTownRoom("Maria", { admin: true, steward: false }, MEMBER_ROOMS, asked.value, "approved", "Fine.", 6);
    assert.equal(own.ok, false);
    const stranger = decideTownRoom("Pete", { admin: false, steward: false }, MEMBER_ROOMS, asked.value, "approved", "Fine.", 6);
    assert.equal(stranger.ok, false);

    const approved = decideTownRoom("Josh", { admin: true, steward: false }, MEMBER_ROOMS, asked.value, "approved", "Seffner has people asking.", 6);
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.equal(approved.value.request.status, "approved");
    assert.equal(approved.value.request.note, "Seffner has people asking.");
    assert.equal(approved.value.room?.id, "town-seffner-fl");
    const room = townRoomFromRequest(asked.value);
    const again = requestTownRoom("Ruth", [...MEMBER_ROOMS, room], [approved.value.request], { name: "Seffner", state: "FL" }, 7, "tr2");
    assert.equal(again.ok, false);

    const refused = decideTownRoom("Josh", { admin: false, steward: true }, MEMBER_ROOMS, { ...asked.value, id: "tr3", townId: "dover-fl", name: "Dover" }, "refused", "Not yet.", 8);
    assert.equal(refused.ok, true);
    if (!refused.ok) return;
    assert.equal(refused.value.room, null);
    assert.equal(refused.value.request.status, "refused");
  });

  it("refuses a second open request and a town that already has a room", () => {
    const riverview = requestTownRoom("Maria", MEMBER_ROOMS, [], { name: "Riverview", state: "FL" }, 1, "tr");
    assert.equal(riverview.ok, false);
    const open = requestTownRoom("Maria", MEMBER_ROOMS, [], { name: "Dover", state: "FL" }, 1, "tr");
    if (!open.ok) throw new Error("open");
    assert.equal(requestTownRoom("Ruth", MEMBER_ROOMS, [open.value], { name: "Dover", state: "FL" }, 2, "tr2").ok, false);
  });
});
