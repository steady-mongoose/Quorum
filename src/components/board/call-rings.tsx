import { useEffect, useRef, useState } from "react";
import { PhoneCall } from "lucide-react";
import { apiFetch } from "@/lib/api-base";
import { btnGhost } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { useCallsEnabled } from "@/components/board/room-call";
import { parseRings, type IncomingRing } from "@/lib/calls/rings";

/**
 * Shows "X is calling you to a room" when a host or steward rings you.
 * Polls every 5 s only while calls are on. Rings vanish after a minute.
 */
export function CallRings({ onGo }: { onGo: (roomId: string) => void }) {
  const { enabled } = useCallsEnabled();
  const [rings, setRings] = useState<IncomingRing[]>([]);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRings([]);
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
        if (!cancelled && response.ok) setRings(parseRings(await response.json()));
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

  const ring = rings[0];
  if (!ring) return null;

  const dismiss = (id: string, restore = true) => {
    const target = returnTo.current;
    returnTo.current = null;
    if (restore)
      requestAnimationFrame(() =>
        (target?.isConnected ? target : document.getElementById("main"))?.focus(),
      );
    setRings((list) => list.filter((item) => item.id !== id));
    void apiFetch(`/api/calls/rings/${id}/dismiss`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
  };

  return (
    <section
      role="status"
      aria-live="polite"
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
          dismiss(ring.id);
        }
      }}
      className="call-rings fixed inset-x-4 bottom-[calc(var(--tabbar-h,64px)+env(safe-area-inset-bottom)+0.75rem)] z-50 mx-auto flex max-w-md flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-lg md:bottom-6"
    >
      <p className="flex items-center gap-2 font-semibold text-fg">
        <PhoneCall className="size-4" aria-hidden="true" />
        {ring.fromName} is calling you to a room call.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(btnGhost, "min-h-[44px]")}
          onClick={() => {
            dismiss(ring.id, false);
            onGo(ring.roomId);
          }}
        >
          Go to the call
        </button>
        <button
          type="button"
          className={cn(btnGhost, "min-h-[44px]")}
          onClick={() => dismiss(ring.id)}
        >
          Not now
        </button>
      </div>
    </section>
  );
}

export const ROOM_CALL_STATUS_ID = "room-call-status";
export const CALL_STARTING_TEXT = "The call is starting. Join will appear here.";

/**
 * After "Go to the call" lands on /rooms: focus the call's Join button.
 * The button appears once /api/calls/status answers, so check every 50 ms
 * (setTimeout, so the deadline holds in a background tab) for up to about a
 * second, then fall back to the room heading and say why. If the user has
 * moved focus in the meantime, leave them where they are.
 */
export function focusRoomCall(
  waitMs = 1000,
  startedAt = Date.now(),
  from: Element | null = document.activeElement,
): void {
  const now = document.activeElement;
  if (now !== from && now !== document.body) return;
  const join = document.getElementById("room-call-join");
  if (join) {
    join.focus();
    return;
  }
  if (Date.now() - startedAt >= waitMs) {
    const status = document.getElementById(ROOM_CALL_STATUS_ID);
    if (status) status.textContent = CALL_STARTING_TEXT;
    document.getElementById("room-heading")?.focus();
    return;
  }
  setTimeout(() => focusRoomCall(waitMs, startedAt, from), 50);
}
