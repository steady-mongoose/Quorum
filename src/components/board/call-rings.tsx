import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { PhoneCall, PhoneOff } from "lucide-react";
import { apiFetch } from "@/lib/api-base";
import { btnGhost, btnSignal } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { CallPanel, WRAP, useCallsEnabled } from "@/components/board/room-call";
import {
  addMissed,
  missedLine,
  parseRings,
  parseSettled,
  RING_CHANNEL,
  ringLine,
  type IncomingRing,
} from "@/lib/calls/rings";
import { startRinging } from "@/lib/calls/ringtone";

const CARD =
  "fixed inset-x-4 bottom-[calc(var(--tabbar-h,64px)+env(safe-area-inset-bottom)+0.75rem)] z-50 mx-auto flex max-w-md flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-lg md:bottom-6";

/**
 * The incoming-call prompt: "Ann is calling you." with Join and Decline,
 * plus a beep and a buzz where the browser allows. A host or steward ringing
 * you into a room call, or someone starting a call in your conversation,
 * both land here. Polls every 5 s only while calls are on. Rings vanish
 * after a minute; one that vanishes unanswered shows as a missed call.
 * Joining a DM call opens the call right here, over the page.
 */
export function CallRings({
  onGo,
  ringtone = startRinging,
}: {
  onGo: (roomId: string) => void;
  /** Tests pass a stub. Returns the function that stops the sound. */
  ringtone?: () => () => void;
}) {
  const { enabled, selfId } = useCallsEnabled();
  const [rings, setRings] = useState<IncomingRing[]>([]);
  const [inCall, setInCall] = useState<{ threadId: string; fromName: string } | null>(null);
  /** The call-ended line, or the missed callers (names only, no counts). */
  const [notice, setNotice] = useState<{ text: string; missed: string[] }>(NO_NOTICE);
  const handled = useRef(new Set<string>());
  const seen = useRef(new Map<string, IncomingRing>());
  const returnTo = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const lineId = useId();

  useEffect(() => {
    if (!enabled) {
      setRings([]);
      seen.current.clear();
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const response = await apiFetch("/api/calls/rings", {
          credentials: "include",
          cache: "no-store",
        });
        if (!cancelled && response.ok) {
          const body = (await response.json()) as unknown;
          const next = parseRings(body).filter((ring) => !handled.current.has(ring.id));
          const settled = parseSettled(body);
          const ids = new Set(next.map((ring) => ring.id));
          for (const [id, old] of seen.current) {
            // Only a real miss: not answered or declined in another tab or
            // device, and not dropped because they left the room.
            if (!ids.has(id) && !handled.current.has(id) && settled.get(id) === "missed") {
              setNotice((now) => {
                const missed = addMissed(now.missed, old.fromName);
                return { text: missedLine(missed, Infinity), missed };
              });
            }
          }
          seen.current = new Map(next.map((ring) => [ring.id, ring]));
          setRings(next);
        }
      } catch {
        // Try again on the next poll.
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  const ring = inCall ? undefined : rings.find((item) => !handled.current.has(item.id));
  const ringId = ring?.id;
  const showing = Boolean(inCall || ring || notice.text);

  useEffect(() => {
    if (!ringId) return;
    return ringtone();
    // One ringtone per ring; a new ring starts it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringId]);

  // Lift the board toast (same bottom slot) above whatever card shows here.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const node = cardRef.current;
    if (!showing || !node) {
      root.style.removeProperty(CARD_HEIGHT_VAR);
      return;
    }
    const measure = () =>
      root.style.setProperty(CARD_HEIGHT_VAR, `${Math.ceil(node.offsetHeight) + 12}px`);
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(CARD_HEIGHT_VAR);
    };
  }, [showing, ringId, inCall, notice.text]);

  const restoreFocus = () => {
    const target = returnTo.current;
    returnTo.current = null;
    requestAnimationFrame(() =>
      (target?.isConnected ? target : document.getElementById("main"))?.focus(),
    );
  };

  // Answer or decline in one tab, and the other tabs stop ringing right away.
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (!enabled || typeof BroadcastChannel !== "function") return;
    const ch = new BroadcastChannel(RING_CHANNEL);
    ch.onmessage = (event: MessageEvent) => {
      const id = (event.data as { handled?: unknown } | null)?.handled;
      if (typeof id !== "string") return;
      handled.current.add(id);
      setRings((list) => list.filter((row) => row.id !== id));
    };
    channel.current = ch;
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [enabled]);

  const settle = (item: IncomingRing, how: "decline" | "dismiss", restore: boolean) => {
    handled.current.add(item.id);
    try {
      channel.current?.postMessage({ handled: item.id });
    } catch {
      // The other tabs catch up on their next poll.
    }
    if (restore) restoreFocus();
    else returnTo.current = null;
    setRings((list) => list.filter((row) => row.id !== item.id));
    return apiFetch(`/api/calls/rings/${item.id}/${how}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => null);
  };

  // Join: the server checks the ring still stands (no block since, still in
  // the room) before anything opens. A refusal shows in plain words instead.
  const join = async (item: IncomingRing) => {
    setNotice(NO_NOTICE);
    const back = returnTo.current;
    const res = await settle(item, "dismiss", false);
    if (!res || !res.ok) {
      returnTo.current = back;
      restoreFocus();
      const body = res ? await res.json().catch(() => null) : null;
      const said = (body as { error?: unknown } | null)?.error;
      setNotice({
        text:
          typeof said === "string" && said.length > 0 && said.length <= 200 ? said : JOIN_FAILED,
        missed: [],
      });
      return;
    }
    if (item.kind === "dm") setInCall({ threadId: item.threadId, fromName: item.fromName });
    else onGo(item.roomId);
  };

  // A new ring moves focus to the card itself, never to Join or Decline: a
  // stray Enter or Space must not join the call and open the mic. While the
  // person is typing or a dialog is open, focus stays put and only the live
  // line announces the ring.
  useEffect(() => {
    if (!ringId) return;
    const active = document.activeElement;
    if (escapeBelongsElsewhere(active)) return;
    const card = cardRef.current;
    if (!card) return;
    if (active instanceof HTMLElement && active !== document.body) returnTo.current = active;
    card.focus({ preventScroll: true });
  }, [ringId]);

  // Escape declines from anywhere while a ring shows, except while typing or
  // inside an open dialog (Escape belongs to those).
  const settleRef = useRef(settle);
  settleRef.current = settle;
  useEffect(() => {
    if (!ring) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (escapeBelongsElsewhere(event.target)) return;
      event.preventDefault();
      const inside = cardRef.current?.contains(document.activeElement) ?? false;
      void settleRef.current(ring, "decline", inside);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ring]);

  // Always mounted, so screen readers hear text that changes in it.
  const spoken = ring ? ringLine(ring, Infinity) : inCall ? "" : notice.text;
  const live = (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {spoken}
    </p>
  );

  if (inCall && selfId) {
    const close = () => {
      setInCall(null);
      restoreFocus();
    };
    return (
      <div className={WRAPPER}>
        {live}
        <div
          ref={(node) => {
            cardRef.current = node;
          }}
          className={cn(CARD, "max-h-[75dvh] overflow-y-auto p-0")}
        >
          <CallPanel
            key={inCall.threadId}
            callKey={`dm:${inCall.threadId}`}
            basePath={`/api/calls/dm/${inCall.threadId}`}
            selfId={selfId}
            label={`Call with ${inCall.fromName}`}
            note={`Only you and ${inCall.fromName} are in this call. It is not recorded.`}
            joinLabel="Join the call"
            autoJoin
            onEnded={(message) => {
              setNotice({ text: message, missed: [] });
              close();
            }}
            onLeave={close}
            onClose={close}
          />
        </div>
      </div>
    );
  }

  if (!ring) {
    if (!notice.text) return <div className={WRAPPER}>{live}</div>;
    const shown = notice.missed.length ? missedLine(notice.missed) : notice.text;
    return (
      <div className={WRAPPER}>
        {live}
        <section
          ref={(node) => {
            cardRef.current = node;
          }}
          role="region"
          aria-labelledby={lineId}
          className={CARD}
        >
          <p
            id={lineId}
            aria-label={shown === notice.text ? undefined : notice.text}
            className={cn("flex items-center gap-2 font-semibold text-fg", WRAP)}
          >
            <PhoneOff className="size-4 shrink-0" aria-hidden="true" />
            {shown}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(btnGhost, "min-h-[44px]")}
              onClick={() => setNotice(NO_NOTICE)}
            >
              Close
            </button>
          </div>
        </section>
      </div>
    );
  }

  const shown = ringLine(ring);
  const full = ringLine(ring, Infinity);
  return (
    <div className={WRAPPER}>
      {live}
      <section
        ref={(node) => {
          cardRef.current = node;
        }}
        role="region"
        aria-labelledby={lineId}
        tabIndex={-1}
        onFocus={(event) => {
          const from = event.relatedTarget;
          if (from instanceof HTMLElement && !event.currentTarget.contains(from)) {
            returnTo.current = from;
          }
        }}
        className={cn(CARD, FOCUS_RING)}
      >
        <p
          id={lineId}
          aria-label={shown === full ? undefined : full}
          className={cn("flex items-center gap-2 font-semibold text-fg", WRAP)}
        >
          <PhoneCall className="size-4 shrink-0" aria-hidden="true" />
          {shown}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(btnSignal, "min-h-[44px]")}
            onClick={() => void join(ring)}
          >
            <PhoneCall className="size-4" aria-hidden="true" />
            Join
          </button>
          <button
            type="button"
            className={cn(btnGhost, "min-h-[44px]")}
            onClick={() => void settle(ring, "decline", true)}
          >
            <PhoneOff className="size-4" aria-hidden="true" />
            Decline
          </button>
        </div>
        <p className="text-sm text-fg">{ESCAPE_HINT}</p>
      </section>
    </div>
  );
}

/**
 * A box-less wrapper (display: contents). public/backgrounds.css sets
 * `.shell>*{position:relative}` on the shell's direct children; the card sits
 * one level down, so it stays position: fixed and on screen when scrolled.
 */
export const WRAPPER = "call-rings contents";

/** The team's script-focus ring (styles.css `.focus-target:focus`), as on the call panel. */
export const FOCUS_RING = "focus-target";

export const JOIN_FAILED = "That call isn't available any more.";

export const ESCAPE_HINT = "Press Escape to decline.";
const NO_NOTICE = { text: "", missed: [] as string[] };
/** Height of the call card plus a gap; the board toast adds it to its bottom offset. */
export const CARD_HEIGHT_VAR = "--call-card-h";

/** Escape inside a text field, an editable area or an open dialog is theirs, not the ring's. */
export function escapeBelongsElsewhere(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement) {
    if (target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"))
      return true;
    if (target.isContentEditable) return true;
  }
  return dialogIsOpen();
}

/**
 * True only for a dialog that is actually showing: an open <dialog>, or an
 * aria-modal element that is not hidden or display: none. Closed dialogs
 * that stay mounted (Sign out, say) do not count.
 */
export function dialogIsOpen(): boolean {
  const found = document.querySelectorAll<HTMLElement>("dialog[open], [aria-modal='true']");
  for (const el of found) {
    if (el.tagName === "DIALOG" && !(el as HTMLDialogElement).open) continue;
    if (el.closest("[hidden], [inert]")) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    return true;
  }
  return false;
}

export const ROOM_CALL_STATUS_ID = "room-call-status";
export const CALL_STARTING_TEXT = "The call is starting. Join will appear here.";

/**
 * After Join on a room ring lands on /rooms: focus the call's Join button,
 * and press it when `press` is set (the person already chose Join).
 * The button appears once /api/calls/status answers, so check every 50 ms
 * (setTimeout, so the deadline holds in a background tab) for up to about a
 * second, then fall back to the room heading and say why. If the user has
 * moved focus in the meantime, leave them where they are.
 */
export function focusRoomCall(
  waitMs = 1000,
  startedAt = Date.now(),
  from: Element | null = document.activeElement,
  press = false,
): void {
  const now = document.activeElement;
  if (now !== from && now !== document.body) return;
  const join = document.getElementById("room-call-join");
  if (join) {
    join.focus();
    if (press && join instanceof HTMLButtonElement && !join.disabled) join.click();
    return;
  }
  if (Date.now() - startedAt >= waitMs) {
    const status = document.getElementById(ROOM_CALL_STATUS_ID);
    if (status) status.textContent = CALL_STARTING_TEXT;
    document.getElementById("room-heading")?.focus();
    return;
  }
  setTimeout(() => focusRoomCall(waitMs, startedAt, from, press), 50);
}
