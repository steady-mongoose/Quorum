/** Newest first. A mark does not move a post. Nothing here reads a score. */

export type OrderedPost = {
  id?: string;
  at: number;
};

export function orderPosts<T extends OrderedPost>(posts: readonly T[]): T[] {
  return [...posts].sort((a, b) => b.at - a.at || (a.id ?? "").localeCompare(b.id ?? ""));
}
