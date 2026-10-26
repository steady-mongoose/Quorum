import { useState } from "react";
import { setGatheringShare } from "@/lib/board/gathering-public";
import { townOf } from "@/lib/board/gathering";
import type { MeetingCard } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

/**
 * The organizer's switch. Off until they turn it on. The public page then
 * shows the title, the date, and the town.
 */
export function GatheringShareControl({ card }: { card: MeetingCard }) {
  const updateCard = useBoard((state) => state.updateCard);
  const remote = useBoard((state) => state.remote);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const shared = card.sharePublic === true;

  const change = (next: boolean) => {
    if (!remote) {
      setError("Sharing is saved on the server.");
      return;
    }
    setPending(true);
    void setGatheringShare({
      id: card.id,
      shared: next,
      title: card.name,
      date: card.next,
      town: townOf(card.place),
    }).then((result) => {
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError("");
      updateCard(card.id, { sharePublic: next });
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
        Off until you turn it on. The public page shows the title, the date, and the town.
      </p>
      {error ? (
        <p className="text-sm text-signal" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
