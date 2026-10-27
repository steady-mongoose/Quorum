/**
 * Who may record a gender, and whether a restricted room waits for confirmation.
 * Change this object to change the rule. Do not copy the rule anywhere else.
 *
 * Default: the member sets it once. After that it changes only through a
 * correction request that an admin reviews (server/profile/corrections.ts).
 * No one edits it directly, including an admin.
 * Confirmation is off, so a stated gender counts at once.
 */
export const GENDER_POLICY = {
  GENDER_SET_BY: "self",
  GENDER_REQUIRES_CONFIRMATION: false,
  GENDER_CHANGE_BY: "admin",
  GENDER_CHANGE_ALLOWS_SELF: false,
} as const;

/** The refusal for a direct edit. It points to the correction request. */
export const GENDER_CORRECTION_ERROR =
  "This is already set. To correct it, send a correction request. An admin reviews it.";

export type GenderSetBy = "self" | "inviter" | "steward";
export type GenderChangeBy = "admin" | "steward";

export type GenderPolicy = {
  GENDER_SET_BY: GenderSetBy;
  GENDER_REQUIRES_CONFIRMATION: boolean;
  GENDER_CHANGE_BY: GenderChangeBy;
  /** When false, the subject cannot change a gender that is already set. */
  GENDER_CHANGE_ALLOWS_SELF: boolean;
};

export type Gender = "man" | "woman";
export type Audience = "all" | "men" | "women";
export type AudienceCode = "gender-unstated" | "gender-unconfirmed" | "audience";

export function parseGender(value: unknown): Gender | null {
  if (value === "man" || value === "woman") return value;
  return null;
}

export function parseAudience(value: unknown): Audience | null {
  if (value === "all" || value === "men" || value === "women") return value;
  return null;
}

/** The signed-in host, or an admin when the room was seeded with no host. */
export function isRoomHost(input: {
  createdBy: string | null;
  userId: string;
  admin: boolean;
}): boolean {
  const createdBy = input.createdBy?.trim() ?? "";
  if (createdBy) return createdBy === input.userId;
  return input.admin;
}

/**
 * True when this actor may name another member on POST /api/gender.
 * Checked before the email lookup, so a refused caller learns nothing about the address.
 */
export function mayNameAnotherGender(
  input: { actorIsAdmin: boolean; actorIsSteward: boolean },
  policy: GenderPolicy = GENDER_POLICY,
): boolean {
  if (policy.GENDER_SET_BY === "self") return false;
  if (policy.GENDER_SET_BY === "inviter") return true;
  if (policy.GENDER_SET_BY === "steward") return input.actorIsAdmin || input.actorIsSteward;
  if (policy.GENDER_CHANGE_BY === "admin") return input.actorIsAdmin;
  return input.actorIsAdmin || input.actorIsSteward;
}

export function audienceDecision(
  input: {
    audience: Audience;
    stated: Gender | null;
    confirmed: boolean;
    canModerate: boolean;
  },
  policy: GenderPolicy = GENDER_POLICY,
):
  | { allow: true; override: boolean }
  | { allow: false; code: AudienceCode; error: string } {
  if (input.audience === "all") return { allow: true, override: false };
  const effective =
    input.stated && (!policy.GENDER_REQUIRES_CONFIRMATION || input.confirmed) ? input.stated : null;
  const wanted = input.audience === "men" ? "man" : "woman";
  if (effective === wanted) return { allow: true, override: false };
  if (input.canModerate) return { allow: true, override: true };
  if (!input.stated) {
    return {
      allow: false,
      code: "gender-unstated",
      error: "Say whether you are a man or a woman before opening this room.",
    };
  }
  if (policy.GENDER_REQUIRES_CONFIRMATION && !input.confirmed) {
    return {
      allow: false,
      code: "gender-unconfirmed",
      error: "A steward will confirm this soon. Until then, men's and women's rooms stay closed to you.",
    };
  }
  return {
    allow: false,
    code: "audience",
    error: input.audience === "men" ? "This room is for men." : "This room is for women.",
  };
}

export function genderWriteDecision(
  input: {
    current: Gender | null;
    next: Gender;
    actorIsSubject: boolean;
    actorIsInviter: boolean;
    actorHasNoInviter: boolean;
    actorIsSteward: boolean;
    actorIsAdmin: boolean;
  },
  policy: GenderPolicy = GENDER_POLICY,
): { ok: true; kind: "same" | "set" } | { ok: false; status: number; error: string } {
  if (input.current === input.next) return { ok: true, kind: "same" };
  if (input.current === null) {
    if (policy.GENDER_SET_BY === "self") {
      if (!input.actorIsSubject) {
        return { ok: false, status: 403, error: "You set this once, yourself." };
      }
      return { ok: true, kind: "set" };
    }
    if (policy.GENDER_SET_BY === "inviter") {
      if (input.actorIsInviter || (input.actorIsSubject && input.actorHasNoInviter)) {
        return { ok: true, kind: "set" };
      }
      return { ok: false, status: 403, error: "The person who invited you sets this." };
    }
    if (!input.actorIsSteward) return { ok: false, status: 403, error: "A steward sets this." };
    return { ok: true, kind: "set" };
  }
  // No one edits a stated gender directly, including an admin. A change goes
  // through an admin-reviewed correction request instead.
  void policy;
  return { ok: false, status: 403, error: GENDER_CORRECTION_ERROR };
}

export function genderPolicyPayload(policy: GenderPolicy = GENDER_POLICY) {
  return {
    setBy: policy.GENDER_SET_BY,
    requiresConfirmation: policy.GENDER_REQUIRES_CONFIRMATION,
    changeBy: policy.GENDER_CHANGE_BY,
  };
}
