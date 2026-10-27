import type { Db } from "../db.ts";
import { actorRole } from "../board/access.ts";

/**
 * Read-only. Never selects code_hash. One row per invite, plus one per redemption.
 * Last sign-in is the newest session.createdAt for the member who redeemed.
 */
export const INVITE_TRACKER_SQL = `select i.id, i.note, i.room_id, i.created_at, i.expires_at, i.uses, i.max_uses,
       creator.name as created_by_name,
       r.redeemed_at, r.invited_name, r.invited_user_id,
       member.email as member_email,
       (select max(s."createdAt") from "session" s where s."userId" = r.invited_user_id) as last_sign_in
  from invite_code i
  left join "user" creator on creator.id = i.created_by
  left join invite_redemption r on r.invite_id = i.id
  left join "user" member on member.id = r.invited_user_id
 order by i.created_at desc, r.redeemed_at desc nulls last
 limit 500`;

export type InviteTrackerRow = {
  id: string;
  note: string;
  room: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  uses: number;
  maxUses: number;
  redeemed: boolean;
  redeemedAt: number | null;
  redeemedBy: string;
  memberEmail: string;
  lastSignIn: number | null;
};

function ms(value: Date | string | null | undefined): number | null {
  return value ? new Date(value).getTime() : null;
}

export async function listInviteTracker(
  db: Db,
  userId: string,
): Promise<{ ok: true; value: InviteTrackerRow[] } | { ok: false; status: number; error: string }> {
  const actor = await actorRole(db, userId);
  if (!actor.admin) return { ok: false, status: 403, error: "Only an admin can see the invite tracker." };
  const rows = await db.query<{
    id: string;
    note: string;
    room_id: string;
    created_at: Date | string;
    expires_at: Date | string;
    uses: number;
    max_uses: number;
    created_by_name: string | null;
    redeemed_at: Date | string | null;
    invited_name: string | null;
    invited_user_id: string | null;
    member_email: string | null;
    last_sign_in: Date | string | null;
  }>(INVITE_TRACKER_SQL);
  return {
    ok: true,
    value: rows.map((row) => ({
      id: row.id,
      note: row.note,
      room: row.room_id,
      createdBy: row.created_by_name ?? "",
      createdAt: ms(row.created_at) ?? 0,
      expiresAt: ms(row.expires_at) ?? 0,
      uses: Number(row.uses),
      maxUses: Number(row.max_uses),
      redeemed: row.redeemed_at !== null,
      redeemedAt: ms(row.redeemed_at),
      redeemedBy: row.invited_name ?? "",
      memberEmail: row.member_email ?? "",
      lastSignIn: ms(row.last_sign_in),
    })),
  };
}
