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
  requestAnimationFrame?: (cb: () => void) => number;
};

type InviteHeading = { focus: () => void; scrollIntoView: (arg?: ScrollIntoViewOptions) => void };

/**
 * Wait (frame by frame, up to `maxFrames`) until the invite heading is mounted,
 * focus and scroll to it, and only then clear #invite from the URL so a later
 * back/forward without the hash does not move focus again. Clearing the hash
 * first lets the browser/router settle focus on the body instead.
 */
export function landOnInvite(
  win: LandWindow,
  getHeading: (() => InviteHeading | null) | InviteHeading | null,
  maxFrames = 30,
): void {
  const resolve = () => (typeof getHeading === "function" ? getHeading() : getHeading);
  const raf =
    win.requestAnimationFrame?.bind(win) ??
    ((cb: () => void) => setTimeout(cb, 16) as unknown as number);
  let frames = 0;
  const attempt = () => {
    const heading = resolve();
    if (!heading) {
      if (frames++ < maxFrames) raf(attempt);
      return;
    }
    heading.focus();
    heading.scrollIntoView({ block: "start" });
    if (win.location.hash === `#${INVITE_HASH}`) {
      const { pathname, search } = win.location;
      win.history.replaceState(win.history.state, "", pathname + search);
    }
  };
  // Run after the current frame so the router's own scroll/focus handling has finished.
  raf(attempt);
}
