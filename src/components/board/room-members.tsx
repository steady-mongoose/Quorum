import { useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { authorName, formatDate, messageableNames, type Room } from "@/lib/board/model";
import {
  loadRoomMembers,
  localRoomMembers,
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
 * Message shows only for someone you may already write to; the server checks again.
 */
export function RoomMembers({ room }: { room: Room }) {
  const remote = useBoard((state) => state.remote);
  const posts = useBoard((state) => state.posts);
  const me = useBoard((state) => authorName(state.me));
  const cards = useBoard((state) => state.cards);
  const rooms = useBoard((state) => state.rooms);
  const openDm = useBoard((state) => state.openDm);
  const peers = useMemo(
    () => messageableNames(me, cards, posts, rooms),
    [me, cards, posts, rooms],
  );
  const [live, setLive] = useState<MemberList | null>(null);
  const [error, setError] = useState("");

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
    () => (remote ? null : localRoomMembers(room, posts, me)),
    [remote, room, posts, me],
  );
  const list = remote ? live : local;

  return (
    <details className="rounded-md border border-line bg-surface px-3 py-2">
      <summary className="min-h-[44px] cursor-pointer py-2 text-base text-fg">
        Members{list ? ` (${list.members.length})` : ""}
      </summary>
      {error ? <p className="text-sm text-muted">{error}</p> : null}
      {list && list.members.length === 0 ? (
        <p className="text-sm text-muted">Nobody is listed in this room yet.</p>
      ) : null}
      {list ? (
        <ul className="flex flex-col gap-3 py-2">
          {list.members.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 border-t border-line pt-3">
              <span className="text-base text-fg">
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
              {row.name !== me && peers.has(row.name) ? (
                <button
                  type="button"
                  className={cn(btnQuiet, "self-start px-0")}
                  onClick={() => openDm(row.name)}
                >
                  <MessageSquare className="size-4" aria-hidden="true" />
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
