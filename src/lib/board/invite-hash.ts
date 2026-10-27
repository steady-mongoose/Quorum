/** The About invite section's hash, as in /#invite. */
export const INVITE_HASH = "invite";

type HashWindow = Pick<Window, "addEventListener" | "removeEventListener"> & {
  location: { hash: string };
};

/**
 * Run `onInvite` now and on every hash change or back/forward that lands on
 * #invite. Returns the cleanup.
 */
export function watchInviteHash(win: HashWindow, onInvite: () => void): () => void {
  const check = () => {
    if (win.location.hash === `#${INVITE_HASH}`) onInvite();
  };
  check();
  win.addEventListener("hashchange", check);
  win.addEventListener("popstate", check);
  return () => {
    win.removeEventListener("hashchange", check);
    win.removeEventListener("popstate", check);
  };
}
