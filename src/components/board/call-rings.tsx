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

  const dismiss = (id: string) => {
    const target = returnTo.current;
    returnTo.current = null;
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
      className="fixed inset-x-4 bottom-[calc(var(--tabbar-h,64px)+env(safe-area-inset-bottom)+0.75rem)] z-50 mx-auto flex max-w-md flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-lg md:bottom-6"
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
            dismiss(ring.id);
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
