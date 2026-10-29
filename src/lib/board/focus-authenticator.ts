/** How long to watch for You to put the Authenticator heading on the page. */
export const AUTHENTICATOR_WAIT_MS = 10_000;

function focusNow(): boolean {
  if (typeof document === "undefined") return false;
  const heading = document.getElementById("authenticator");
  if (!heading) return false;
  heading.focus();
  heading.scrollIntoView?.({ block: "start" });
  return true;
}

/**
 * Focus the Authenticator heading under You (#authenticator, tabIndex -1).
 * You may still be loading, so watch the page for the heading for up to
 * `waitMs`, then stop quietly: focus stays where it is and nothing is said.
 * Returns a function that stops watching early.
 */
export function focusAuthenticator(waitMs = AUTHENTICATOR_WAIT_MS): () => void {
  if (focusNow()) return () => {};
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
  };
  const observer = new MutationObserver(() => {
    if (focusNow()) stop();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = window.setTimeout(stop, waitMs);
  return stop;
}
