import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOUNDING_ADMIN,
  founderNameFromEnv,
  grantAdmin,
  grantMember,
  grantSteward,
  isLiveAdmin,
  isLiveMember,
  isRoomSteward,
  revokeAccess,
  seatFounder,
  type AccessRow,
} from "./access.ts";

function seat(bootstrapped = false, currentMember = "") {
  return seatFounder({
    bootstrapped,
    currentMember,
    envName: "",
    command: true,
    now: 10,
    memberId: "m-josh",
    adminId: "a-josh",
  });
}

describe("bootstrap", () => {
  it("seats Josh once, as admin and council chair, and refuses the second run", () => {
    assert.equal(founderNameFromEnv("1"), FOUNDING_ADMIN);
    assert.equal(founderNameFromEnv("true"), FOUNDING_ADMIN);
    assert.equal(founderNameFromEnv("josh"), FOUNDING_ADMIN);
    assert.equal(founderNameFromEnv(""), "");
    assert.equal(founderNameFromEnv("Dale"), "Dale");

    const first = seat();
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.row.name, "Josh");
    assert.equal(first.row.admin, true);
    assert.equal(first.row.councilChair, true);
    assert.equal(first.row.rows[1]?.note, "Founding admin and council chair.");
    assert.equal(isLiveAdmin(first.row.rows, "Josh"), true);
    assert.equal(isLiveMember(first.row.rows, "Josh"), true);

    const again = seat(true);
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.match(again.error, /once/);

    const named = seatFounder({ bootstrapped: false, currentMember: "", envName: "Dale", command: false, now: 1, memberId: "m", adminId: "a" });
    assert.equal(named.ok, false);
    const taken = seatFounder({ bootstrapped: false, currentMember: "Dale", envName: "Josh", command: false, now: 1, memberId: "m", adminId: "a" });
    assert.equal(taken.ok, false);
  });
});

describe("rule 9", () => {
  const seated = seat();
  if (!seated.ok) throw new Error("seat");
  const base: AccessRow[] = [...seated.row.rows];

  it("adds a member with one voucher and logs it", () => {
    const maria = grantMember(base, "Josh", { name: "Maria", roomId: "rv-shop" }, 20, "m-maria");
    assert.equal(maria.ok, true);
    if (!maria.ok) return;
    assert.equal(maria.row.vouchedBy, "Josh");
    assert.equal(maria.row.approvedBy, "");
    assert.equal(grantMember(base, "Josh", { name: "Josh", roomId: "rv-shop" }, 20, "x").ok, false);
    assert.equal(grantMember(base, "Maria", { name: "Tom", roomId: "rv-shop" }, 20, "x").ok, false);
    const log = [...base, maria.row];
    assert.equal(grantMember(log, "Josh", { name: "Maria", roomId: "rv-town" }, 21, "x").ok, false);
  });

  it("makes the first steward by inviter plus the council chair, then the next by a room steward", () => {
    const maria = grantMember(base, "Josh", { name: "Maria", roomId: "rv-shop" }, 20, "m-maria");
    const tom = grantMember(base, "Josh", { name: "Tom", roomId: "rv-shop" }, 21, "m-tom");
    if (!maria.ok || !tom.ok) throw new Error("members");
    const members = [...base, maria.row, tom.row];
    const first = grantSteward(members, "Josh", true, { name: "Tom", roomId: "rv-shop", inviter: "Maria" }, 30, "s-tom");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.row.approvedBy, "Josh");
    assert.equal(first.row.vouchedBy, "Maria");
    const withTom = [...members, first.row];
    assert.equal(grantSteward(withTom, "Josh", true, { name: "Maria", roomId: "rv-shop", inviter: "Tom" }, 31, "s-maria").ok, false);
    const second = grantSteward(withTom, "Tom", false, { name: "Maria", roomId: "rv-shop", inviter: "Josh" }, 32, "s-maria");
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(isRoomSteward([...withTom, second.row], "Maria", "rv-shop"), true);
    assert.equal(grantSteward(members, "Josh", true, { name: "Tom", roomId: "rv-shop", inviter: "Josh" }, 30, "x").ok, false);
  });

  it("adds an admin only with a steward and the role owner, and logs a revocation", () => {
    const maria = grantMember(base, "Josh", { name: "Maria", roomId: "rv-shop" }, 20, "m-maria");
    const tom = grantMember(base, "Josh", { name: "Tom", roomId: "rv-shop" }, 21, "m-tom");
    if (!maria.ok || !tom.ok) throw new Error("members");
    const first = grantSteward([...base, maria.row, tom.row], "Josh", true, { name: "Tom", roomId: "rv-shop", inviter: "Maria" }, 30, "s-tom");
    if (!first.ok) throw new Error("steward");
    const log = [...base, maria.row, tom.row, first.row];
    assert.equal(grantAdmin(log, "Tom", { name: "Maria", stewardApprover: "Tom" }, 40, "x").ok, false);
    const admin = grantAdmin(log, "Josh", { name: "Tom", stewardApprover: "Tom" }, 40, "x");
    assert.equal(admin.ok, false);
    const granted = grantAdmin(log, "Josh", { name: "Tom", stewardApprover: "Maria" }, 40, "ad-tom");
    assert.equal(granted.ok, false);
    const mariaSteward = grantSteward(log, "Tom", false, { name: "Maria", roomId: "rv-shop", inviter: "Josh" }, 33, "s-maria");
    if (!mariaSteward.ok) throw new Error("maria steward");
    const ready = [...log, mariaSteward.row];
    const tomAdmin = grantAdmin(ready, "Josh", { name: "Tom", stewardApprover: "Maria" }, 40, "ad-tom");
    assert.equal(tomAdmin.ok, true);
    if (!tomAdmin.ok) return;
    assert.equal(tomAdmin.row.vouchedBy, "Maria");
    assert.equal(tomAdmin.row.approvedBy, "Josh");
    const revoked = revokeAccess([...ready, tomAdmin.row], "Josh", { name: "Tom", role: "admin" }, 50, "rv-tom");
    assert.equal(revoked.ok, true);
    if (!revoked.ok) return;
    assert.equal(isLiveAdmin([...ready, tomAdmin.row, revoked.row], "Tom"), false);
    assert.equal([...ready, tomAdmin.row].length + 1, [...ready, tomAdmin.row, revoked.row].length);
    assert.equal(revokeAccess(ready, "Josh", { name: "Josh", role: "admin" }, 60, "no").ok, false);
  });
});
