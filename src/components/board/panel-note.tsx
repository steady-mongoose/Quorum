import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { PANEL_SET_UP, type PanelFailure } from "@/lib/board/load-failure";

/**
 * A panel's reload, and focus on its heading once a Try again has loaded.
 * `retry` bumps `tick` (the load effect's dependency). The panel calls
 * `loaded()` when a load succeeds; after a Try again that moves focus to the
 * heading once the panel has rendered.
 */
export function usePanelRetry(heading: RefObject<HTMLElement | null>) {
  const [tick, setTick] = useState(0);
  const [focusAt, setFocusAt] = useState(0);
  const retried = useRef(false);
  const retry = useCallback(() => {
    retried.current = true;
    setTick((value) => value + 1);
  }, []);
  const loaded = useCallback(() => {
    if (!retried.current) return;
    retried.current = false;
    setFocusAt((value) => value + 1);
  }, []);
  const failed = useCallback(() => {
    retried.current = false;
  }, []);
  useEffect(() => {
    if (focusAt) heading.current?.focus();
  }, [focusAt, heading]);
  return { tick, retry, loaded, failed };
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
  if (!failure) return null;
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
