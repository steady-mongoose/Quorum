import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { authorName, formatDate, messageableNames, type Room } from "@/lib/board/model";
import {
  loadRoomMembers,
  localRoomMembers,
  MEMBER_WAIT_LINE,
  type MemberList,
  type MemberRow,
} from "@/lib/board/room-members";
import { useBoard } from "@/lib/board/store";
import { btnQuiet } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";

function cameLine(row: MemberRow): string {
  if (row.attended.length === 0) return "No gatherings here yet.";
  return `Came to: ${row.attended
    .map((item) => `${formatDate(item.on)} (${item.hosted ? "hosted" : `hosted by ${item.host}`})`)
    .join(", ")}.`;
}

/**
 * Who is in the room. Every member sees every member, in name order. It shows
 * when each joined and last posted, and, in a room that takes roll, the
 * gatherings each came to. It never ranks anyone and shows no upcoming RSVPs.
 * Message shows where the server says you may write; it checks again on open.
 * While you are new to the room, one line above the list says when you can.
 */
export function RoomMembers({ room }: { room: Room }) {
  const remote = useBoard((state) => state.remote);
  const posts = useBoard((state) => state.posts);
  const me = useBoard((state) => authorName(state.me));
  const cards = useBoard((state) => state.cards);
  const rooms = useBoard((state) => state.rooms);
  const messageMember = useBoard((state) => state.messageMember);
  const focusMember = useBoard((state) => state.focusMember);
  const clearFocusMember = useBoard((state) => state.clearFocusMember);
  const [live, setLive] = useState<MemberList | null>(null);
  const [error, setError] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    setLive(null);
    setError("");
    void loadRoomMembers(room.id).then((result) => {
      if (cancelled) return;
      if (result.ok) setLive(result.list);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [remote, room.id]);

  const local = useMemo(
    () =>
      remote
        ? null
        : localRoomMembers(room, posts, me, messageableNames(me, cards, posts, rooms)),
    [remote, room, posts, me, cards, rooms],
  );
  const list = remote ? live : local;
  // The 3-day wait is about you, not anyone listed: say it once, above the list.
  const waiting = Boolean(list?.members.some((row) => row.name !== me && row.message === "wait"));

  // Back from a conversation opened here: the list opens and that row's button takes focus.
  useEffect(() => {
    if (!focusMember || !list) return;
    const button = buttons.current.get(focusMember);
    if (details.current) details.current.open = true;
    // That row's button can be gone (today's starts used up): the list's summary takes focus.
    (button ?? details.current?.querySelector("summary"))?.focus();
    clearFocusMember();
  }, [focusMember, list, clearFocusMember]);

  return (
    <details ref={details} className="rounded-md border border-line bg-surface px-3 py-2">
      <summary className="min-h-[44px] cursor-pointer py-2 text-base text-fg">
        Members{list ? ` (${list.members.length})` : ""}
      </summary>
      {error ? <p className="text-sm text-muted">{error}</p> : null}
      {list && list.members.length === 0 ? (
        <p className="text-sm text-muted">Nobody is listed in this room yet.</p>
      ) : null}
      {waiting ? <p className="text-sm text-muted">{MEMBER_WAIT_LINE}</p> : null}
      {list ? (
        <ul className="flex flex-col gap-3 py-2">
          {list.members.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 border-t border-line pt-3">
              <span className="text-base text-fg [overflow-wrap:anywhere]">
                {row.name}
                {row.steward ? <span className="text-sm text-muted"> · steward</span> : null}
                {row.name === me ? <span className="text-sm text-muted"> · you</span> : null}
              </span>
              <span className="text-sm text-muted">
                {[
                  row.joinedOn ? `Joined ${formatDate(row.joinedOn)}.` : "",
                  row.lastPostedOn
                    ? `Last posted ${formatDate(row.lastPostedOn)}.`
                    : "Has not posted here yet.",
                ]
                  .filter(Boolean)
                  .join(" ")}
              </span>
              {list.rollCall ? <span className="text-sm text-muted">{cameLine(row)}</span> : null}
              {row.name !== me && row.message === "open" ? (
                <button
                  type="button"
                  ref={(node) => {
                    if (node) buttons.current.set(row.id, node);
                    else buttons.current.delete(row.id);
                  }}
                  className={cn(
                    btnQuiet,
                    "max-w-full self-start px-0 text-left [overflow-wrap:anywhere]",
                  )}
                  onClick={() =>
                    messageMember(room.id, {
                      id: row.id,
                      name: row.name,
                      userId: remote ? row.id : null,
                    })
                  }
                >
                  <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
                  Message {row.name}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
