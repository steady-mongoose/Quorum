import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveApproval, type CouncilApproval } from "./home.ts";
import { addCouncilApproval, proposeZipClear, proposeZipCorrection, revokeCouncilApproval } from "./roles.ts";

const row = (patch: Partial<CouncilApproval> & Pick<CouncilApproval, "id" | "entryId">): CouncilApproval => ({
  reason: "A logged reason.",
  by: "Council",
  at: 1,
  revokedAt: null,
  ...patch,
});

describe("council role", () => {
  it("lets a council member approve a real post only with a reason", () => {
    const ok = addCouncilApproval({ council: true }, "Josh", { entryId: "p4", reason: "  Standing notice. " }, 10, "c1", true);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.row.reason, "Standing notice.");
      assert.equal(ok.row.by, "Josh");
      assert.equal(ok.row.revokedAt, null);
    }
    assert.equal(addCouncilApproval({ council: false }, "Josh", { entryId: "p4", reason: "Standing notice." }, 10, "c1", true).ok, false);
    assert.equal(addCouncilApproval({ council: true }, "Josh", { entryId: "p4", reason: "   " }, 10, "c1", true).ok, false);
    assert.equal(addCouncilApproval({ council: true }, "Josh", { entryId: "p4", reason: "Standing notice." }, 10, "c1", false).ok, false);
  });

  it("lets only an admin revoke, and keeps the earlier log row", () => {
    const approvals = [row({ id: "c1", entryId: "p4", at: 1, reason: "Standing notice." })];
    const denied = revokeCouncilApproval({ admin: false }, "Josh", approvals, "p4", 20, "c2");
    assert.equal(denied.ok, false);
    const revoked = revokeCouncilApproval({ admin: true }, "Ada", approvals, "p4", 20, "c2");
    assert.equal(revoked.ok, true);
    if (!revoked.ok) return;
    const log = [...approvals, revoked.row];
    assert.equal(log.length, 2);
    assert.equal(log[0]?.revokedAt, null);
    assert.equal(liveApproval("p4", log), null);
    assert.equal(revokeCouncilApproval({ admin: true }, "Ada", log, "p4", 30, "c3").ok, false);
  });
});

describe("zip corrections", () => {
  it("lets only an admin set or clear a ZIP", () => {
    const set = proposeZipCorrection(true, "Ada", { zip: "90210-0001", name: "Beverly Hills", state: "ca" }, 5, "z1");
    assert.equal(set.ok, true);
    if (set.ok) {
      assert.equal(set.row.zip, "90210");
      assert.equal(set.row.townId, "beverly-hills-ca");
      assert.equal(set.row.state, "CA");
    }
    assert.equal(proposeZipCorrection(false, "Josh", { zip: "90210", name: "Beverly Hills", state: "CA" }, 5, "z1").ok, false);
    assert.equal(proposeZipCorrection(true, "Ada", { zip: "9021", name: "Beverly Hills", state: "CA" }, 5, "z1").ok, false);
    assert.equal(proposeZipCorrection(true, "Ada", { zip: "90210", name: "Beverly Hills", state: "California" }, 5, "z1").ok, false);
    const cleared = proposeZipClear(true, "Ada", "33578", 6, "z2");
    assert.equal(cleared.ok, true);
    if (cleared.ok) assert.equal(cleared.row.townId, "");
    assert.equal(proposeZipClear(false, "Josh", "33578", 6, "z2").ok, false);
  });
});
