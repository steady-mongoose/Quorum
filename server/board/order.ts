/** Fixed tier, then newest. Marks sink a post. They do not hide it. Nothing here reads a score. */

export type OrderedPost = {
  mark: string | null;
  type: string;
  closed: boolean;
  cardId?: string;
  at: number;
};

function tier(post: OrderedPost): number {
  if (post.mark === "sloppy") return 5;
  // out_of_scope stays in the type's tier. It is not hidden and it is not a score.
  if (post.mark === "unsupported") return 4;
  if (post.type === "noted" || (post.type === "asked" && post.closed)) return 3;
  if (post.type === "hosted" || (post.type === "did" && post.cardId)) return 1;
  return 2;
}

export function orderPosts<T extends OrderedPost>(posts: readonly T[]): T[] {
  return [...posts].sort((a, b) => tier(a) - tier(b) || b.at - a.at);
}
