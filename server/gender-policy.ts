/**
 * Who may record a gender, and whether a restricted room waits for confirmation.
 * Change this object to change the rule. Do not copy the rule anywhere else.
 *
 * Default: the member sets it once. A steward changes it after that.
 * Confirmation is off, so a stated gender counts at once.
 */
export const GENDER_POLICY = {
  GENDER_SET_BY: "self",
  GENDER_REQUIRES_CONFIRMATION: false,
  GENDER_CHANGE_BY: "steward",
} as const;

export type GenderSetBy = "self" | "inviter" | "steward";

export type GenderPolicy = {
  GENDER_SET_BY: GenderSetBy;
  GENDER_REQUIRES_CONFIRMATION: boolean;
  GENDER_CHANGE_BY: "steward";
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
      error: "A steward has not confirmed that yet.",
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
  },
  policy: GenderPolicy = GENDER_POLICY,
): { ok: true; kind: "same" | "set" | "change" } | { ok: false; status: number; error: string } {
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
  if (policy.GENDER_CHANGE_BY === "steward" && !input.actorIsSteward) {
    return { ok: false, status: 403, error: "A steward changes this after it is set." };
  }
  return { ok: true, kind: "change" };
}

export function genderPolicyPayload(policy: GenderPolicy = GENDER_POLICY) {
  return {
    setBy: policy.GENDER_SET_BY,
    requiresConfirmation: policy.GENDER_REQUIRES_CONFIRMATION,
    changeBy: policy.GENDER_CHANGE_BY,
  };
}
