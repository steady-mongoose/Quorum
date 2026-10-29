import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { btnQuiet } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { useBoard } from "@/lib/board/store";

/**
 * The way out of a conversation. Opened from a room's member list, it goes back
 * to that room and that row's Message button; otherwise to all messages.
 */
export function ConversationBack({ onAllMessages }: { onAllMessages: () => void }) {
  const dmFrom = useBoard((state) => state.dmFrom);
  const rooms = useBoard((state) => state.rooms);
  const backToRoom = useBoard((state) => state.backToRoom);
  return (
    <button
      type="button"
      className={cn(btnQuiet, "max-w-full self-start px-0 text-left [overflow-wrap:anywhere]")}
      onClick={dmFrom ? backToRoom : onAllMessages}
    >
      <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
      {dmFrom
        ? `Back to ${rooms.find((room) => room.id === dmFrom.room)?.name ?? "the room"}`
        : "All messages"}
    </button>
  );
}

/** The conversation's name. It takes focus when the conversation opens. */
export function ConversationHeading({ name, className }: { name: string; className: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [name]);
  return (
    <h1 ref={heading} tabIndex={-1} className={cn(className, "[overflow-wrap:anywhere]")}>
      {name}
    </h1>
  );
}
