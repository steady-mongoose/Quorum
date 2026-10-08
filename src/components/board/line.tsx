import { useState } from "react";
import { btnQuiet, useNow } from "@/components/quorum/bits";
import { MINUTE, SESSION_LINE_MINUTES } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

/** A line at 20 minutes, one tap to dismiss. It does not lock anyone out. */
export function SessionLine() {
  const dismissedAt = useBoard((state) => state.lineDismissedAt);
  const dismiss = useBoard((state) => state.dismissLine);
  const [startedAt] = useState(() => Date.now());
  const now = useNow();
  const show = now !== null && now.getTime() - Math.max(startedAt, dismissedAt) >= SESSION_LINE_MINUTES * MINUTE;

  if (!show) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 py-3">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
        <p className="text-sm text-muted">You have been here twenty minutes.</p>
        <button type="button" className={btnQuiet} onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
