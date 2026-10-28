/**
 * Test-only wrappers: posting needs the member to be in the room, so these put
 * the author in the room first (a room_member row, as an earlier post would),
 * then post. Tests about the membership rule itself call ./store.ts directly.
 */
import type { Db } from "../db.ts";
import { createPost as storeCreatePost, replyToPost as storeReplyToPost } from "./store.ts";

export async function standForTest(db: Db, userId: string, roomId: string): Promise<void> {
  await db.query(
    `insert into room_member (room_id, user_id)
     select r.id, u.id from "user" u, room r where u.id = $1 and r.id = $2
     on conflict do nothing`,
    [userId, roomId],
  );
}

export async function createPost(
  db: Db,
  input: Parameters<typeof storeCreatePost>[1],
): ReturnType<typeof storeCreatePost> {
  await standForTest(db, input.userId, input.roomId);
  return storeCreatePost(db, input);
}

export async function replyToPost(
  db: Db,
  input: Parameters<typeof storeReplyToPost>[1],
): ReturnType<typeof storeReplyToPost> {
  const parent = await db.query<{ room_id: string }>(
    `select room_id from board_post where id = $1`,
    [input.postId],
  );
  if (parent[0]) await standForTest(db, input.userId, parent[0].room_id);
  return storeReplyToPost(db, input);
}
