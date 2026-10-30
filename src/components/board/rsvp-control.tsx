import { useState } from "react";
import { Laurel } from "@/components/board/laurel";
import { btn } from "@/components/quorum/bits";
import { gatheringShare } from "@/lib/board/gathering";
import { cn } from "@/lib/cn";
import { roomById, type MeetingCard } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

/**
 * "I'll be there" becomes "You're going". The check is not part of the
 * name, and the button does not also set aria-pressed. The laurel draws in
 * only after the member taps (data-tapped); a state that arrives from the
 * server shows it already drawn. While the save is out the button is
 * aria-disabled and aria-busy, not disabled, so focus stays on it. A failed
 * save leaves the button as it was and says so underneath. The share control
 * stays off until the organizer turns sharing on for this gathering.
 */
export function RsvpControl({
  card,
  going,
  onToggle,
}: {
  card: MeetingCard;
  going: boolean;
  onToggle: () => void;
}) {
  const pending = useBoard((state) => state.rsvpPending.includes(card.id));
  const failed = useBoard((state) => state.rsvpFailed.includes(card.id));
  const [tapped, setTapped] = useState(false);
  return (
    <div className="mt-3 flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={cn(btn, "btn-rsvp", going ? "btn-primary" : "border border-line bg-transparent text-fg")}
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          data-tapped={tapped ? "" : undefined}
          onClick={() => {
            if (pending) return;
            setTapped(true);
            onToggle();
          }}
        >
          {going ? (
            <>
              You’re going <span aria-hidden="true">✓</span>
            </>
          ) : (
            "I'll be there"
          )}
        </button>
        <div className="rsvp-mark" aria-hidden="true">
          <div className="rule" />
          <Laurel />
        </div>
      </div>
      <p className={cn("text-sm text-danger", !(failed && !pending) && "sr-only")} role="status">
        {failed && !pending ? "Not saved. Try again." : ""}
      </p>
      {going && card.sharePublic ? <ShareGathering card={card} /> : null}
    </div>
  );
}

function ShareGathering({ card }: { card: MeetingCard }) {
  const [copied, setCopied] = useState(false);
  const payload = gatheringShare({ ...card, town: roomById(card.room).town });

  const share = () => {
    const send = navigator.share?.bind(navigator);
    if (send) {
      void send({ title: payload.title, text: payload.text, url: payload.url }).catch(() => {
        void copyLink();
      });
      return;
    }
    void copyLink();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(payload.url);
    } catch {
      return;
    }
    setCopied(true);
  };

  return (
    <p className="text-sm">
      <button
        type="button"
        className="text-fg underline decoration-[var(--gold)] underline-offset-[3px]"
        onClick={share}
      >
        Share this gathering
      </button>
      {copied ? (
        <span className="ml-2 text-muted" role="status">
          Link copied
        </span>
      ) : null}
    </p>
  );
}
