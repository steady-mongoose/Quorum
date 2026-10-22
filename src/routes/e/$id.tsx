import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { btnSignal, Kicker } from "@/components/quorum/bits";
import { townOf } from "@/lib/board/gathering";
import { formatDate } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

export const Route = createFileRoute("/e/$id")({
  component: GatheringPage,
});

/**
 * The public card a share link opens. Title, date, time, and town.
 * No street, host, attendee, or invite code.
 */
function GatheringPage() {
  const { id } = Route.useParams();
  const cards = useBoard((state) => state.cards);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.resolve(useBoard.persist.rehydrate()).finally(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const card = cards.find((item) => item.id === id) ?? null;

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-base text-muted">Opening the gathering.</p>
      </main>
    );
  }

  if (!card) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 px-6 py-16">
        <Kicker>Gathering</Kicker>
        <h1 className="illum font-display text-4xl text-fg">This gathering is not on this board.</h1>
        <p className="max-w-prose text-base text-muted">
          The link is for one meeting. It is not on the board open in this browser.
        </p>
        <Link to="/" className={btnSignal + " self-start"}>
          Open Avouch Social
        </Link>
      </main>
    );
  }

  const when = [card.next ? formatDate(card.next) : "", card.time, townOf(card.place)].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 px-6 py-16">
      <Kicker>Gathering</Kicker>
      <h1 className="illum font-display text-4xl text-balance text-fg">{card.name}</h1>
      {when ? <p className="text-base text-muted">{when}</p> : null}
      <Link to="/" className={btnSignal + " self-start"}>
        Open Avouch Social
      </Link>
    </main>
  );
}
