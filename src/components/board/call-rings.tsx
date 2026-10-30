import { useEffect, useRef, useState } from "react";
import { PhoneCall, PhoneOff } from "lucide-react";
import { apiFetch } from "@/lib/api-base";
import { btnGhost, btnSignal } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { CallPanel, useCallsEnabled } from "@/components/board/room-call";
import { missedLine, parseRings, ringLine, type IncomingRing } from "@/lib/calls/rings";
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
  const [notice, setNotice] = useState("");
  const handled = useRef(new Set<string>());
  const seen = useRef(new Map<string, IncomingRing>());
  const returnTo = useRef<HTMLElement | null>(null);

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
          const next = parseRings(await response.json());
          const ids = new Set(next.map((ring) => ring.id));
          for (const [id, old] of seen.current) {
            if (!ids.has(id) && !handled.current.has(id)) setNotice(missedLine(old.fromName));
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

  useEffect(() => {
    if (!ringId) return;
    return ringtone();
    // One ringtone per ring; a new ring starts it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringId]);

  const settle = (item: IncomingRing, how: "decline" | "dismiss", restore: boolean) => {
    handled.current.add(item.id);
    const target = returnTo.current;
    returnTo.current = null;
    if (restore)
      requestAnimationFrame(() =>
        (target?.isConnected ? target : document.getElementById("main"))?.focus(),
      );
    setRings((list) => list.filter((row) => row.id !== item.id));
    void apiFetch(`/api/calls/rings/${item.id}/${how}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
  };

  if (inCall && selfId) {
    return (
      <div className={cn(CARD, "max-h-[75dvh] overflow-y-auto p-0")}>
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
            setInCall(null);
            setNotice(message);
          }}
          onLeave={() => setInCall(null)}
          onClose={() => setInCall(null)}
        />
      </div>
    );
  }

  if (!ring) {
    if (!notice) return null;
    return (
      <section role="status" aria-live="polite" aria-label="Call" className={CARD}>
        <p className="flex items-center gap-2 font-semibold text-fg">
          <PhoneOff className="size-4" aria-hidden="true" />
          {notice}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(btnGhost, "min-h-[44px]")}
            onClick={() => setNotice("")}
          >
            Close
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      role="status"
      aria-live="assertive"
      aria-label="Incoming call"
      onFocus={(event) => {
        const from = event.relatedTarget;
        if (from instanceof HTMLElement && !event.currentTarget.contains(from)) {
          returnTo.current = from;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          settle(ring, "decline", true);
        }
      }}
      className={CARD}
    >
      <p className="flex items-center gap-2 font-semibold text-fg">
        <PhoneCall className="size-4" aria-hidden="true" />
        {ringLine(ring)}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(btnSignal, "min-h-[44px]")}
          onClick={() => {
            setNotice("");
            settle(ring, "dismiss", false);
            if (ring.kind === "dm") setInCall({ threadId: ring.threadId, fromName: ring.fromName });
            else onGo(ring.roomId);
          }}
        >
          <PhoneCall className="size-4" aria-hidden="true" />
          Join
        </button>
        <button
          type="button"
          className={cn(btnGhost, "min-h-[44px]")}
          onClick={() => settle(ring, "decline", true)}
        >
          <PhoneOff className="size-4" aria-hidden="true" />
          Decline
        </button>
      </div>
    </section>
  );
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
