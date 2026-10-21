// A council approval is one labeled lift. The checklist is the review.
// The reason is what the log keeps. Neither one is a score.

import { oneSentence, SENTENCE_ERROR } from "./text.ts";

export const COUNCIL_APPROVED_LABEL = "Council-approved";

export const REVIEW_CHECKLIST = {
  candidate: [
    "The post names the candidate and the office.",
    "The post is in English and a member can check the fact.",
    "The post does not ask for a like, a score, or a rank.",
  ],
  business: [
    "The post names the business and the town.",
    "The post is in English and a member can check the fact.",
    "The post does not ask for a like, a score, or a rank.",
  ],
} as const;

export type PostSubject = "candidate" | "business";

export function checklistFor(subject: PostSubject): readonly string[] {
  return REVIEW_CHECKLIST[subject];
}

/** The stored checklist is the canonical list, in that order. */
export function acceptedChecklist(subject: PostSubject, given: readonly string[]): string[] | null {
  const required = checklistFor(subject);
  const got = new Set(given.map((item) => item.trim()).filter(Boolean));
  if (got.size !== required.length) return null;
  if (!required.every((item) => got.has(item))) return null;
  return [...required];
}

export function planCouncilApproval(input: {
  council: boolean;
  subject: PostSubject | null;
  removed: boolean;
  reply: boolean;
  live: boolean;
  reason: string;
  checklist: readonly string[];
}): { ok: true; reason: string; checklist: string[] } | { ok: false; error: string } {
  if (!input.council) return { ok: false, error: "Only a council member can approve a post." };
  if (input.removed || input.reply || !input.subject) {
    return { ok: false, error: "The council approves a candidate post or a business post." };
  }
  if (input.live) return { ok: false, error: "That post already has a council approval." };
  const checklist = acceptedChecklist(input.subject, input.checklist);
  if (!checklist) return { ok: false, error: "Check each item on the review list." };
  const reason = oneSentence(input.reason);
  if (!reason) return { ok: false, error: SENTENCE_ERROR };
  return { ok: true, reason, checklist };
}

export function planCouncilRevoke(input: {
  admin: boolean;
  live: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!input.admin) return { ok: false, error: "Only an admin can revoke a council approval." };
  if (!input.live) return { ok: false, error: "There is no live approval to revoke." };
  return { ok: true };
}
