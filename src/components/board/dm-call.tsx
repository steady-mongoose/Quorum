import { useState } from "react";
import { Video } from "lucide-react";
import { btnGhost } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { CallPanel, useCallsEnabled } from "@/components/board/room-call";

/**
 * Video call inside one message thread. Hidden until calls are on. The API
 * allows it only between the two people in the thread who still share a
 * meeting, the same rule as messages.
 */
export function DmCall({ threadId, otherName }: { threadId: string; otherName: string }) {
  const { enabled, selfId } = useCallsEnabled();
  const [open, setOpen] = useState(false);
  if (!enabled || !selfId) return null;
  if (!open) {
    return (
      <button
        type="button"
        className={cn(btnGhost, "min-h-[44px] self-start")}
        onClick={() => setOpen(true)}
        aria-label={`Video call ${otherName}`}
      >
        <Video className="size-4" aria-hidden="true" />
        Video call
      </button>
    );
  }
  return (
    <CallPanel
      key={threadId}
      callKey={`dm:${threadId}`}
      basePath={`/api/calls/dm/${threadId}`}
      selfId={selfId}
      label={`Call with ${otherName}`}
      note={`Only you and ${otherName} can be in this call. It is not recorded. ${otherName} joins by opening this conversation and choosing Join the call.`}
      joinLabel="Join the call"
    />
  );
}
