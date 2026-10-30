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
  site_code: "Add a code to your website",
  domain_email: "Get a code by email",
  steward_review: "Ask for a review by hand",
};

/**
 * One line under each option: what the member does and what happens after.
 * site_code: the server fetches the page when a steward asks it to check.
 * domain_email: the address must be on the listing's website domain, not a shared mail host.
 * steward_review: with no code, only an admin can approve, so it is the slowest.
 */
export const CLAIM_METHOD_HINT: Record<ClaimMethod, string> = {
  site_code:
    "We give you a short code to put on your homepage or About page. A steward then checks your site for it. Usually the fastest.",
  domain_email:
    "We email a code to an address on your organization's own website domain. Free mail services like Gmail don't count. You type the code here.",
  steward_review:
    "No code. An admin looks into your request by hand and decides. This takes the longest.",
};

export const CLAIM_PENDING_MS = 14 * 24 * 60 * 60 * 1000;
export const CLAIM_CODE_MS = 24 * 60 * 60 * 1000;

/** Wrong email codes after this many tries expire the claim. */
export const CLAIM_CODE_ATTEMPTS = 5;

/**
 * Hosts that are not one organization's site or mailbox.
 * A claim cannot use site_code or domain_email on these names.
 * Steward review is the remaining method.
 */
export const CLAIM_SHARED_HOSTS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "facebookmail.com",
  "gmail.com",
  "googlemail.com",
  "google.com",
  "sites.google.com",
  "youtube.com",
  "youtu.be",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "gmx.com",
  "linktr.ee",
  "linktree.com",
  "wix.com",
  "wixsite.com",
  "squarespace.com",
  "weebly.com",
  "wordpress.com",
  "blogspot.com",
  "blogger.com",
  "medium.com",
  "substack.com",
  "carrd.co",
  "beacons.ai",
  "bio.link",
  "notion.so",
  "notion.site",
  "github.io",
  "netlify.app",
  "vercel.app",
  "pages.dev",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "linkedin.com",
  "reddit.com",
  "pinterest.com",
  "snapchat.com",
  "discord.com",
  "discord.gg",
  "t.me",
  "telegram.org",
  "whatsapp.com",
] as const;

/** True when the host is a shared site or a public mailbox, including a subdomain. */
export function sharedClaimHost(host: string): boolean {
  const name = host
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  if (!name || name.includes(" ")) return false;
  return CLAIM_SHARED_HOSTS.some((entry) => name === entry || name.endsWith(`.${entry}`));
}

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
