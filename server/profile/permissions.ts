/**
 * Permissions 0025 owns two profile switches. This file is the only place
 * that answers them. Profile reads and writes call these functions. They do
 * not grow a second copy of the rule.
 *
 * Admins-only visibility and the anonymous flag stay off until 0025 lands.
 * `profileView` still honors a stored `admins` level so the rule can be tested
 * and so a later migration does not need a second filter.
 */

/** True when a member may set a field to admins-only. Off until permissions 0025. */
export function adminsOnlyVisibilityEnabled(): boolean {
  return false;
}

/**
 * True when `members.profile_anonymous` hides a profile from other members.
 * Off until permissions 0025. The column is stored and ignored while this is false.
 */
export function profileAnonymousEnabled(): boolean {
  return false;
}

export const ADMINS_ONLY_LATER = "Admins-only visibility arrives with permissions 0025.";
export const ANONYMOUS_LATER = "The anonymous flag arrives with permissions 0025.";
