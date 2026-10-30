import { useEffect, useRef } from "react";

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

/** The one wait in flight, so a new wait ends the last one first. */
let current: (() => void) | null = null;

/**
 * Focus the Authenticator heading under You (#authenticator, tabIndex -1).
 * You may still be loading, so watch the page for the heading for up to
 * `waitMs`, then stop quietly: focus stays where it is and nothing is said.
 * Only one wait runs at a time: a new call stops the last one. The wait also
 * stops as soon as the person clicks, taps or presses a key, so a heading that
 * renders after they have moved on does not pull focus back.
 * Returns a function that stops watching early; calling it twice is harmless.
 */
export function focusAuthenticator(waitMs = AUTHENTICATOR_WAIT_MS): () => void {
  current?.();
  if (focusNow()) return () => {};
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
    document.removeEventListener("pointerdown", stop, true);
    document.removeEventListener("keydown", stop, true);
    if (current === stop) current = null;
  };
  const observer = new MutationObserver(() => {
    if (focusNow()) stop();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = window.setTimeout(stop, waitMs);
  // The click or Enter that started this wait has already been dispatched.
  document.addEventListener("pointerdown", stop, true);
  document.addEventListener("keydown", stop, true);
  current = stop;
  return stop;
}

/**
 * For a button that starts the wait: keeps the stop() it gets back, calls it before
 * starting a new wait, and, with `stopOnUnmount`, when the button goes away. A button
 * whose own click takes it off the page (Groups switching to You) leaves
 * `stopOnUnmount` off, or the wait would end before You renders the heading.
 */
export function useFocusAuthenticator({ stopOnUnmount = false } = {}): () => void {
  const stop = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      if (stopOnUnmount) stop.current?.();
    },
    [stopOnUnmount],
  );
  return () => {
    stop.current?.();
    stop.current = focusAuthenticator();
  };
}
