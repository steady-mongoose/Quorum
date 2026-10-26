import { useState } from "react";
import { Laurel } from "@/components/board/laurel";
import { btn } from "@/components/quorum/bits";
import { gatheringShare } from "@/lib/board/gathering";
import { cn } from "@/lib/cn";
import type { MeetingCard } from "@/lib/board/model";

/**
 * "I'll be there" becomes "You're going". The check is not part of the
 * name, and the button does not also set aria-pressed. The laurel runs
 * once, as the next sibling of the filled button. The share control stays
 * off until the organizer turns sharing on for this gathering.
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
  return (
    <div className="mt-3 flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={cn(btn, "btn-rsvp", going ? "btn-primary" : "border border-line bg-transparent text-fg")}
          onClick={onToggle}
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
      {going && card.sharePublic ? <ShareGathering card={card} /> : null}
    </div>
  );
}

function ShareGathering({ card }: { card: MeetingCard }) {
  const [copied, setCopied] = useState(false);
  const payload = gatheringShare(card);

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
