// Claim policy lives here. The views and the routes read this file.
// Nothing in here is a score, a rank, or a feed weight. Role order is the
// order the charter already uses: the owner outranks an admin, an admin
// outranks a steward, and a steward outranks a member.
//
// Council and council chair are duties on member_role, not a step in that
// order. The chair seats the first steward of a room only together with an
// admin grant. A chair who is not an admin stays at steward or member.

export const ROLE_ORDER = ["member", "steward", "admin", "owner"] as const;

export type RoleLevel = (typeof ROLE_ORDER)[number];

/**
 * Steward review with no site code and no domain email is enough only for
 * an approver at or above this role. The proposed line is admin: a room
 * steward may confirm a site code or a domain email and then approve, and
 * an admin or the owner may approve a review alone.
 */
export const CLAIM_STEWARD_TRUST_MIN: RoleLevel = "admin";

export const CLAIM_METHODS = ["site_code", "domain_email", "steward_review"] as const;

export type ClaimMethod = (typeof CLAIM_METHODS)[number];

/**
 * The order members see, and the methods they may start.
 * site_code is first. domain_email is second. steward_review is last.
 */
export const CLAIM_ALLOWED_METHODS: readonly ClaimMethod[] = [
  "site_code",
  "domain_email",
  "steward_review",
];

export const CLAIM_METHOD_LABEL: Record<ClaimMethod, string> = {
  site_code: "A code on the organization's site",
  domain_email: "An email on the organization's domain",
  steward_review: "A steward's review",
};

export const CLAIM_PENDING_MS = 14 * 24 * 60 * 60 * 1000;
export const CLAIM_CODE_MS = 24 * 60 * 60 * 1000;

export function roleLevel(input: { owner: boolean; admin: boolean; steward: boolean }): RoleLevel {
  if (input.owner) return "owner";
  if (input.admin) return "admin";
  if (input.steward) return "steward";
  return "member";
}

/** True when `level` is the same role as `min` or above it in ROLE_ORDER. */
export function roleAtLeast(level: RoleLevel, min: RoleLevel): boolean {
  return ROLE_ORDER.indexOf(level) >= ROLE_ORDER.indexOf(min);
}

/**
 * Whether steward_review alone can approve this claim.
 * This is CLAIM_STEWARD_TRUST_MIN, not a separate on/off switch.
 */
export function stewardReviewSufficient(
  level: RoleLevel,
  min: RoleLevel = CLAIM_STEWARD_TRUST_MIN,
): boolean {
  return roleAtLeast(level, min);
}

export function methodAllowed(method: string): method is ClaimMethod {
  return (CLAIM_ALLOWED_METHODS as readonly string[]).includes(method);
}

export function proofRequired(method: ClaimMethod, level: RoleLevel): boolean {
  if (method === "steward_review") return !stewardReviewSufficient(level);
  return true;
}
