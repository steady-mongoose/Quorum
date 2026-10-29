import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { PANEL_SET_UP, type PanelFailure } from "@/lib/board/load-failure";

/**
 * The team focus ring for a heading that takes focus from code (a panel
 * heading after Try again, the Authenticator heading under You). Defined once
 * in src/styles.css: #f0e7d3 on dark, #1f1912 on parchment, 2px offset.
 */
export const HEADING_FOCUS_RING = "heading-focus-ring";

/**
 * A panel's load failure, its reload, and focus once a Try again settles.
 * `retry` clears the note and bumps `tick` (the load effect's dependency), so
 * a second identical failure is set again and announced. The panel calls
 * `loaded()` or `failed(failure)`; after a Try again either one moves focus
 * to the heading once the panel has rendered, so focus never drops to <body>.
 */
export function usePanelRetry(heading: RefObject<HTMLElement | null>) {
  const [tick, setTick] = useState(0);
  const [failure, setFailure] = useState<PanelFailure | null>(null);
  const [focusAt, setFocusAt] = useState(0);
  const retried = useRef(false);
  const settle = useCallback(() => {
    if (!retried.current) return;
    retried.current = false;
    setFocusAt((value) => value + 1);
  }, []);
  const retry = useCallback(() => {
    retried.current = true;
    setFailure(null);
    setTick((value) => value + 1);
  }, []);
  const loaded = useCallback(() => {
    setFailure(null);
    settle();
  }, [settle]);
  const failed = useCallback(
    (next: PanelFailure) => {
      setFailure({ error: next.error, ...(next.mfa ? { mfa: next.mfa } : {}) });
      settle();
    },
    [settle],
  );
  useEffect(() => {
    if (focusAt) heading.current?.focus();
  }, [focusAt, heading]);
  return { tick, failure, retry, loaded, failed };
}

/**
 * Focus the Authenticator heading under You once it is on the page.
 * Watches for up to 10s (200 tries, 50ms apart), as in groups-view.tsx (PR #114).
 */
export function focusAuthenticator(triesLeft = 200) {
  const heading = document.getElementById("authenticator");
  if (heading) {
    heading.focus();
    heading.scrollIntoView?.({ block: "start" });
    return;
  }
  if (triesLeft > 0) window.setTimeout(() => focusAuthenticator(triesLeft - 1), 50);
}

/**
 * Why a panel could not load, said inside that panel and never as a page alert.
 * No authenticator yet: the panel's own sentence and a way to turn it on.
 * A code is needed or attempts are locked: the server's own sentence.
 * Anything else: plain danger-colour text and Try again.
 */
export function PanelNote({
  failure,
  gateText,
  onRetry,
  onSetUp,
}: {
  failure: PanelFailure | null;
  gateText: string;
  onRetry: () => void;
  onSetUp?: () => void;
}) {
  // Always mounted and polite, so a note that appears (or appears again after
  // Try again) is announced. Empty, it takes no space.
  return (
    <div role="status" aria-live="polite" data-panel-status="" className="empty:sr-only">
      {failure ? <PanelNoteBody failure={failure} gateText={gateText} onRetry={onRetry} onSetUp={onSetUp} /> : null}
    </div>
  );
}

function PanelNoteBody({
  failure,
  gateText,
  onRetry,
  onSetUp,
}: {
  failure: PanelFailure;
  gateText: string;
  onRetry: () => void;
  onSetUp?: () => void;
}) {
  if (failure.mfa === "enroll") {
    return (
      <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
        <span>{gateText}</span>
        <button
          type="button"
          className="min-h-[44px] text-fg underline underline-offset-4"
          onClick={() => {
            onSetUp?.();
            focusAuthenticator();
          }}
        >
          {PANEL_SET_UP}
        </button>
      </p>
    );
  }
  if (failure.mfa === "verify") {
    return <p className="text-sm text-muted">{failure.error}</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-3 text-sm text-danger">
      <span>{failure.error}</span>
      <button type="button" className="min-h-[44px] underline underline-offset-4" onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}
