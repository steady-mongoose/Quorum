import { useEffect, useMemo, useState } from "react";
import { pill } from "@/components/quorum/bits";
import { authorName, type Post, type Room } from "@/lib/board/model";
import {
  loadRoomMembers,
  localRoomMembers,
  rollChoices,
  type MemberList,
} from "@/lib/board/room-members";
import { useBoard } from "@/lib/board/store";

/** The line on a host's write-up. A room that does not take roll shows nobody. */
export function WhoCame({ post, rollCall }: { post: Post; rollCall: boolean }) {
  if (!rollCall) return null;
  return (
    <>
      {post.came.length > 0 ? `There: ${post.came.join(", ")}. ` : ""}
      {post.named ? <span className="text-signal">Mentioned: {post.named}. </span> : null}
    </>
  );
}

/**
 * Who came, picked from the room's members by whoever files the write-up. RSVPs
 * live on one device, so they cannot feed this. Upcoming RSVPs stay private:
 * only an admin gets the going list merged in. A room can take roll with its
 * member list off, and then this says so and the write-up files without names.
 */
export function RollCallPicker({
  room,
  going,
  came,
  onToggle,
}: {
  room: Room;
  going: string[];
  came: string[];
  onToggle: (name: string) => void;
}) {
  const remote = useBoard((state) => state.remote);
  const posts = useBoard((state) => state.posts);
  const admin = useBoard((state) => state.admin);
  const me = useBoard((state) => authorName(state.me));
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

  const list = useMemo(
    () => (remote ? live : localRoomMembers(room, posts, me)),
    [remote, live, room, posts, me],
  );
  const members = useMemo(() => list?.members.map((row) => row.name) ?? [], [list]);
  const names = useMemo(
    () => rollChoices({ members, going, admin, me }),
    [members, going, admin, me],
  );

  return (
    <fieldset className="flex flex-col gap-2 text-sm text-muted">
      <legend>Roll call. Who came, from the room's members.</legend>
      {names.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {names.map((name) => (
            <label key={name} className={pill(came.includes(name), "cursor-pointer")}>
              <input
                type="checkbox"
                className="sr-only"
                checked={came.includes(name)}
                onChange={() => onToggle(name)}
              />
              {name}
            </label>
          ))}
        </div>
      ) : null}
      {error ? <span>{error}</span> : null}
      {!error && list && names.length === 0 ? (
        <span>Say how it went, and set the next date.</span>
      ) : null}
    </fieldset>
  );
}
