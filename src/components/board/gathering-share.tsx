import { useEffect, useState } from "react";
import { loadGathering, saveGathering, setGatheringShare } from "@/lib/board/gathering-public";
import { gatheringPublicUrl, PUBLIC_TIME_NOTE, publicClock } from "@/lib/board/public-gathering";
import { authorName } from "@/lib/board/model";
import type { MeetingCard } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { btnGhost } from "@/components/quorum/bits";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

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
  const [wanted, setWanted] = useState<boolean | null>(null);
  const [copied, setCopied] = useState("");
  const host = card.host === me;
  const moderator = admin || stewardRooms.includes(card.room);
  const shared = card.sharePublic === true;
  const plainClock = publicClock(card.time) !== "";
  const mayRead = host || moderator;
  const allowed = host || (moderator && shared);

  useEffect(() => {
    if (!remote || !mayRead) return;
    let live = true;
    void loadGathering(card.id).then((row) => {
      if (!live || !row) return;
      updateCard(card.id, { sharePublic: row.shared });
    });
    return () => {
      live = false;
    };
  }, [card.id, mayRead, remote, updateCard]);

  if (!allowed) return null;
  const link = gatheringPublicUrl(card.id);

  const change = (next: boolean) => {
    if (!remote) {
      setError("Sharing is saved on the server.");
      return;
    }
    if (next && !host) {
      setError("Only the organizer can share this gathering.");
      return;
    }
    setPending(true);
    setWanted(next);
    setCopied("");
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
        setWanted(null);
        setError(saved.error);
        return;
      }
      return setGatheringShare({ id: card.id, shared: next }).then((result) => {
        setPending(false);
        setWanted(null);
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
          checked={wanted ?? shared}
          aria-disabled={pending ? true : undefined}
          aria-describedby={shared ? `share-link-${card.id}` : undefined}
          onChange={(event) => {
            if (pending) return;
            change(event.target.checked);
          }}
        />
        Share this gathering
      </label>
      <p className="max-w-prose text-sm text-muted">
        {host
          ? "Off until you turn it on. The public page shows the title, the date, the time, and the town."
          : "A steward can turn sharing off."}
      </p>
      {shared && !pending ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            id={`share-link-${card.id}`}
            className="font-mono text-sm break-all text-signal underline"
            href={link}
          >
            {link}
          </a>
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              void copyText(link).then((ok) =>
                setCopied(
                  ok ? "The link is copied." : "Copy did not work. Select the link and copy it.",
                ),
              );
            }}
          >
            Copy link
          </button>
          <span className="text-sm text-muted" role="status" aria-live="polite">
            {copied}
          </span>
        </div>
      ) : null}
      {host && card.time.trim() !== "" && !plainClock ? (
        <p className="max-w-prose text-sm text-muted">{PUBLIC_TIME_NOTE}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-signal" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
