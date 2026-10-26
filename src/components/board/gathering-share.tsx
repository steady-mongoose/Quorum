import { useEffect, useState } from "react";
import { loadGathering, saveGathering, setGatheringShare } from "@/lib/board/gathering-public";
import { authorName } from "@/lib/board/model";
import type { MeetingCard } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

/**
 * The organizer's switch. Off until they turn it on. The flag is read from
 * the server, and the public page then reads the stored gathering.
 */
export function GatheringShareControl({ card }: { card: MeetingCard }) {
  const updateCard = useBoard((state) => state.updateCard);
  const remote = useBoard((state) => state.remote);
  const me = useBoard((state) => authorName(state.me));
  const admin = useBoard((state) => state.admin);
  const stewardRooms = useBoard((state) => state.stewardRooms);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const allowed = card.host === me || admin || stewardRooms.includes(card.room);
  const shared = card.sharePublic === true;

  useEffect(() => {
    if (!remote || !allowed) return;
    let live = true;
    void loadGathering(card.id).then((row) => {
      if (!live || !row) return;
      updateCard(card.id, { sharePublic: row.shared });
    });
    return () => {
      live = false;
    };
  }, [allowed, card.id, remote, updateCard]);

  if (!allowed) return null;

  const change = (next: boolean) => {
    if (!remote) {
      setError("Sharing is saved on the server.");
      return;
    }
    setPending(true);
    void saveGathering({
      id: card.id,
      roomId: card.room,
      title: card.name,
      date: card.next,
      time: card.time,
      place: card.place,
    }).then((saved) => {
      if (!saved.ok) {
        setPending(false);
        setError(saved.error);
        return;
      }
      return setGatheringShare({ id: card.id, shared: next }).then((result) => {
        setPending(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError("");
        updateCard(card.id, { sharePublic: next });
      });
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="inline-flex min-h-[44px] items-center gap-3 text-sm text-fg">
        <input
          type="checkbox"
          className="size-5"
          checked={shared}
          disabled={pending}
          onChange={(event) => change(event.target.checked)}
        />
        Share this gathering
      </label>
      <p className="max-w-prose text-sm text-muted">
        Off until you turn it on. The public page shows the title, the date, the time, and the town.
      </p>
      {error ? (
        <p className="text-sm text-signal" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
