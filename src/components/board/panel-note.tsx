import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { PANEL_SET_UP, type PanelFailure } from "@/lib/board/load-failure";
import { focusWithRing } from "@/lib/board/focus-ring";
import { useFocusAuthenticator } from "@/lib/board/focus-authenticator";

/**
 * The team focus ring for a heading that takes focus from code (a panel
 * heading after Try again, the Authenticator heading under You). Same class
 * and rule as PR #114 (src/styles.css): 2px currentColor outline, 2px offset.
 */
export const HEADING_FOCUS_RING = "focus-target";

/**
 * A panel's load failure, its reload, and focus once a Try again settles.
 * `retry` keeps the note and Try again on the page, marks the panel busy and
 * bumps `tick` (the load effect's dependency); the panel then calls `loaded()`
 * or `failed(failure)`. As on Groups (PR #114): a retry that fails again
 * leaves focus on Try again, which never left the page; any other answer
 * (loaded, the gate, a wait) takes Try again away, so focus moves to the
 * heading with the ring. `retriedOnce` turns on the polite region, so a
 * first-load note is plain text and opening About announces nothing.
 */
export function usePanelRetry(heading: RefObject<HTMLElement | null>) {
  const [tick, setTick] = useState(0);
  const [failure, setFailure] = useState<PanelFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [retriedOnce, setRetriedOnce] = useState(false);
  const [settled, setSettled] = useState(0);
  const retried = useRef(false);
  const settle = useCallback(() => {
    setBusy(false);
    setSettled((value) => value + 1);
  }, []);
  const retry = useCallback(() => {
    retried.current = true;
    setRetriedOnce(true);
    setBusy(true);
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
    if (!retried.current) return;
    retried.current = false;
    // Failed again with Try again still there: focus stays on it.
    if (failure && !failure.mfa) return;
    focusWithRing(heading.current);
  }, [settled, failure, heading]);
  return { tick, failure, busy, retry, loaded, failed, retriedOnce };
}

/**
 * Why a panel could not load, said inside that panel and never as a page alert.
 * No authenticator yet: the panel's own sentence and a way to turn it on.
 * A code is needed or attempts are locked: the server's own sentence.
 * Anything else: plain danger-colour text and Try again.
 *
 * Shaped like Groups' SectionNote (PR #114): the polite region holds only the
 * sentence, and the buttons sit outside it. Two differences, both from Design
 * r133: before any Try again the sentence is plain text outside the region, so
 * opening About does not announce every panel; and while a retry is in flight
 * the region is emptied and the sentence stays on screen aria-hidden, with Try
 * again still mounted, dimmed and aria-busy, so focus is not lost and a repeat
 * failure is announced again.
 */
export function PanelNote({
  failure,
  gateText,
  onRetry,
  onSetUp,
  busy = false,
  live = false,
}: {
  failure: PanelFailure | null;
  gateText: string;
  onRetry: () => void;
  onSetUp?: () => void;
  /** A Try again is in flight (usePanelRetry's `busy`). */
  busy?: boolean;
  /** Set once Try again has been pressed (usePanelRetry's `retriedOnce`). */
  live?: boolean;
}) {
  // The wait must outlive the button: You replaces About. It still ends on the
  // next click or key, or when another wait starts.
  const focusAuthenticator = useFocusAuthenticator();
  const kind = !failure ? null : failure.mfa === "enroll" ? "gate" : failure.mfa ? "wait" : "error";
  const text = !failure ? "" : kind === "gate" ? gateText : failure.error;
  const announced = live && !busy ? text : "";
  return (
    <div
      data-panel-note=""
      className={
        kind
          ? cn("flex flex-wrap items-center gap-x-3 text-sm", kind === "error" ? "text-danger" : "text-muted")
          : "contents"
      }
    >
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-panel-status=""
        className={announced ? undefined : "sr-only"}
      >
        {announced}
      </p>
      {text && !announced ? <span aria-hidden={busy || undefined}>{text}</span> : null}
      {kind === "error" ? (
        <button
          type="button"
          className="min-h-[44px] underline underline-offset-4 aria-disabled:cursor-wait aria-disabled:opacity-60"
          aria-busy={busy || undefined}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onRetry();
          }}
        >
          Try again
        </button>
      ) : null}
      {kind === "gate" ? (
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
      ) : null}
    </div>
  );
}
