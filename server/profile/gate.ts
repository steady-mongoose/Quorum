import { actorRole } from "../board/access.ts";
import type { Db } from "../db.ts";

export const PROFILE_REQUIRED = "profile-required";

export type OnboardingBlock = {
  ok: false;
  status: 403;
  error: string;
  code: typeof PROFILE_REQUIRED;
};

/**
 * A signed-in member cannot write until POST /api/profile/onboard has run.
 * Reads are not checked here. The caller skips this for profile edits, the
 * onboard call itself, and a profile-photo upload.
 */
export async function onboardingBlock(db: Db, userId: string): Promise<OnboardingBlock | null> {
  const role = await actorRole(db, userId);
  if (!role.member) return null;
  const rows = await db.query<{ onboarded_at: Date | string | null }>(
    `select onboarded_at from members where user_id = $1`,
    [userId],
  );
  if (rows[0]?.onboarded_at) return null;
  return {
    ok: false,
    status: 403,
    error: "Finish your profile before doing anything else.",
    code: PROFILE_REQUIRED,
  };
}

export function onboardingResponse(block: OnboardingBlock): Response {
  return new Response(JSON.stringify({ error: block.error, code: block.code }), {
    status: block.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Test fixture. Inserts nothing when the user row is missing, so a session
 * for a stranger does not fail the foreign key. A real member reaches
 * onboarded_at only through POST /api/profile/onboard.
 */
export async function markOnboarded(db: Db, userId: string, name = "Member"): Promise<void> {
  await db.query(
    `insert into members (user_id, display_name, onboarded_at)
     select id, left(coalesce(nullif(trim($2), ''), nullif(trim(name), ''), 'Member'), 80), now()
     from "user" where id = $1
     on conflict (user_id) do update set onboarded_at = coalesce(members.onboarded_at, now())`,
    [userId, name.slice(0, 80) || "Member"],
  );
}
