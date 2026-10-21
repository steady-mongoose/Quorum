import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNCIL_APPROVED_LABEL,
  REVIEW_CHECKLIST,
  planCouncilApproval,
  planCouncilRevoke,
} from "./council.ts";

test("a council approval needs the checklist and one reason, once", () => {
  assert.equal(COUNCIL_APPROVED_LABEL, "Council-approved");
  const ok = planCouncilApproval({
    council: true,
    subject: "candidate",
    removed: false,
    reply: false,
    live: false,
    reason: "The post names the office.",
    checklist: [...REVIEW_CHECKLIST.candidate],
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.deepEqual(ok.checklist, [...REVIEW_CHECKLIST.candidate]);
  assert.equal(planCouncilApproval({
    council: false,
    subject: "candidate",
    removed: false,
    reply: false,
    live: false,
    reason: "The post names the office.",
    checklist: [...REVIEW_CHECKLIST.candidate],
  }).ok, false);
  assert.equal(planCouncilApproval({
    council: true,
    subject: "candidate",
    removed: false,
    reply: false,
    live: false,
    reason: "   ",
    checklist: [...REVIEW_CHECKLIST.candidate],
  }).ok, false);
  assert.equal(planCouncilApproval({
    council: true,
    subject: null,
    removed: false,
    reply: false,
    live: false,
    reason: "The post names the office.",
    checklist: [...REVIEW_CHECKLIST.candidate],
  }).ok, false);
  assert.equal(planCouncilApproval({
    council: true,
    subject: "business",
    removed: false,
    reply: false,
    live: false,
    reason: "The post names the business.",
    checklist: ["A score of ten."],
  }).ok, false);
  assert.equal(planCouncilApproval({
    council: true,
    subject: "candidate",
    removed: false,
    reply: false,
    live: true,
    reason: "The post names the office.",
    checklist: [...REVIEW_CHECKLIST.candidate],
  }).ok, false);
});

test("only an admin revokes a live approval", () => {
  assert.equal(planCouncilRevoke({ admin: false, live: true }).ok, false);
  assert.equal(planCouncilRevoke({ admin: true, live: false }).ok, false);
  assert.equal(planCouncilRevoke({ admin: true, live: true }).ok, true);
});
