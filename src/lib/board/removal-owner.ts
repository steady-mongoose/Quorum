/**
 * On the server, "mine" comes from the author's user id, so two members with
 * one display name never see each other's removals. The local demo board has
 * no user ids, so it falls back to the name there.
 */
export function isMyRemoval(
  row: { author: string; mine?: boolean },
  viewer: { remote: boolean; name: string },
): boolean {
  return viewer.remote ? row.mine === true : row.author === viewer.name;
}
