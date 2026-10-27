import { useEffect, useRef, useState } from "react";
import { PhoneCall } from "lucide-react";
import { apiFetch } from "@/lib/api-base";
import { btnQuiet, btnSignal } from "@/components/quorum/bits";
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
  const goRef = useRef<HTMLButtonElement | null>(null);
  const firstId = rings[0]?.id;

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

  useEffect(() => {
    if (firstId) goRef.current?.focus();
  }, [firstId]);

  const ring = rings[0];
  if (!ring) return null;

  const dismiss = (id: string) => {
    setRings((list) => list.filter((item) => item.id !== id));
    void apiFetch(`/api/calls/rings/${id}/dismiss`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
  };

  return (
    <div
      role="alertdialog"
      aria-labelledby="call-ring-title"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-lg"
    >
      <p id="call-ring-title" className="flex items-center gap-2 font-semibold text-fg">
        <PhoneCall className="size-4" aria-hidden="true" />
        {ring.fromName} is calling you to a room call.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          ref={goRef}
          type="button"
          className={cn(btnSignal, "min-h-[44px]")}
          onClick={() => {
            dismiss(ring.id);
            onGo(ring.roomId);
          }}
        >
          Go to the call
        </button>
        <button
          type="button"
          className={cn(btnQuiet, "min-h-[44px]")}
          onClick={() => dismiss(ring.id)}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
