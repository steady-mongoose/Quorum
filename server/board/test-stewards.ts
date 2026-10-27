import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";

/**
 * Test helper. A room is made with its first steward, under the two-person
 * rule: the creating admin approves as council chair, another member vouches.
 * Seats the creator as chair and adds a fresh steward and inviter.
 */
export async function firstSteward(
  db: Db,
  creatorId: string,
  now: Date,
): Promise<{ stewardEmail: string; inviterEmail: string; stewardId: string; inviterId: string }> {
  await db.query(
    `insert into member_role (user_id, is_council, is_council_chair) values ($1, true, true)
     on conflict (user_id) do update set is_council = true, is_council_chair = true`,
    [creatorId],
  );
  const make = async (label: string) => {
    const id = randomUUID();
    const email = `${label}-${id.slice(0, 8)}@example.com`;
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $3, true, $4, $4)`,
      [id, label, email, now],
    );
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
      [randomUUID(), id, label, now],
    );
    return { id, email };
  };
  const steward = await make("Steward");
  const inviter = await make("Inviter");
  return {
    stewardEmail: steward.email,
    inviterEmail: inviter.email,
    stewardId: steward.id,
    inviterId: inviter.id,
  };
}
