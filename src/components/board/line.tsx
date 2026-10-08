import { useEffect, useState } from "react";
import { btnQuiet } from "@/components/quorum/bits";
import { SESSION_LINE_MINUTES } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

/** A line at 20 minutes, one tap to dismiss. It does not lock anyone out. */
export function SessionLine() {
  const dismissedAt = useBoard((state) => state.lineDismissedAt);
  const dismiss = useBoard((state) => state.dismissLine);
  const [startedAt] = useState(() => Date.now());
  const [show, setShow] = useState(false);

  useEffect(() => {
    const check = () => {
      const since = Math.max(startedAt, dismissedAt);
      setShow(Date.now() - since >= SESSION_LINE_MINUTES * 60000);
    };
    check();
    const id = window.setInterval(check, 30000);
    return () => window.clearInterval(id);
  }, [startedAt, dismissedAt]);

  if (!show) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 py-3"
    >
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
        <p className="text-sm text-muted">Twenty minutes. Your room is read. The rest keeps.</p>
        <button type="button" className={btnQuiet} onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
