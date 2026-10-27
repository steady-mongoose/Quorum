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

type LandWindow = {
  location: { pathname: string; search: string; hash: string };
  history: Pick<History, "state" | "replaceState">;
};

/**
 * Focus and scroll to the invite heading, then clear #invite from the URL so
 * a later back/forward without the hash does not move focus again.
 */
export function landOnInvite(
  win: LandWindow,
  heading: { focus: () => void; scrollIntoView: (arg?: ScrollIntoViewOptions) => void } | null,
): void {
  heading?.focus();
  heading?.scrollIntoView({ block: "start" });
  const { pathname, search } = win.location;
  win.history.replaceState(win.history.state, "", pathname + search);
}
