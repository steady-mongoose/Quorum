import { fieldClass, Kicker } from "@/components/quorum/bits";
import { HARD_RULES, POST_TYPES, ROOMS } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

export function AboutView() {
  const me = useBoard((state) => state.me);
  const setMe = useBoard((state) => state.setMe);
  const steward = useBoard((state) => state.steward);
  const setSteward = useBoard((state) => state.setSteward);
  const replyNotify = useBoard((state) => state.replyNotify);
  const setReplyNotify = useBoard((state) => state.setReplyNotify);
  const removals = useBoard((state) => state.removals);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Kicker>What this is</Kicker>
        <h1 className="max-w-xl font-display text-4xl text-fg">A town board with a lock on the feed.</h1>
        <p className="max-w-2xl text-base text-muted">
          It holds what a small set of people did, where they meet, and what they saw in public. It
          is not a Twitter replacement. Success is a person who opens it, reads their room, and
          leaves. Time on site is a failure metric.
        </p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">Our stance</h2>
        <p className="mt-2 text-sm text-muted">
          Owner-written. The brief asks that the stance go here and not be buried. It is not drafted
          yet, and the one rule proposed alongside it has no written definition. Nothing switches on
          until a sentence exists that a steward can apply the same way to every user.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">Built in, not settings</h2>
        <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
          <li>Chronological inside the room. The list ends with "You're caught up."</li>
          <li>No For You, no recommended posts, no reshare, no quote-post.</li>
          <li>No badge counts, no streaks, no autoplay, no public like counts.</li>
          <li>Notifications off unless you ask for replies.</li>
          <li>A line at 20 minutes, one tap to dismiss. It does not lock you out.</li>
          <li>No pull-to-refresh jackpot.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">Post types</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {POST_TYPES.map((type) => (
            <article key={type.id} className="rounded-lg border border-line bg-surface p-4">
              <h3 className="text-xl text-fg">{type.label}</h3>
              <p className="mt-1 text-sm text-muted">{type.what}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">Rooms do not mix</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {ROOMS.map((room) => (
            <article key={room.id} className="rounded-lg border border-line bg-surface p-4">
              <h3 className="text-xl text-fg">{room.name}</h3>
              <p className="mt-1 text-sm text-muted">{room.what}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">The rule</h2>
        <p className="text-sm text-muted">
          Hard remove, 30-day filing ban, second offense the account closes:
        </p>
        <ul className="flex flex-col gap-2">
          {HARD_RULES.map((rule) => (
            <li key={rule.id} className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
              <span className="font-semibold text-fg">{rule.label}.</span>{" "}
              <span className="text-muted">{rule.why}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          Everything else stays up, including claims the stewards think are false. A sloppy post
          (no claim, no reason, or a repost the author did not open) files at the bottom and cannot
          be pinned. Three in a row locks Saw until one is revised. A poorly argued post (claim with
          no reason, or an answer to a different question) is marked unsupported, stays visible, and
          sorts under posts that named a reason. The mark is about the missing reason, not the side.
          If stewards use it to bury a view, the room is over.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">Cards, trades, and the Hosted post</h2>
        <p className="max-w-2xl text-sm text-muted">
          A room opens on what is coming up inside two weeks, at most two cards, then its feed. The
          host closes a date with a Hosted: it happened, here is the next one, no headcount. A Did that
          names a card sorts above one that does not. A business cannot list itself; two members who it
          worked for name it in a Did and it is listed. Every steward mark is logged in the room for
          every member to read.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">Messages</h2>
        <p className="max-w-2xl text-sm text-muted">
          Two names, no groups. You can message someone you have been on an "I went" list with, or
          who replied to your post. Messages are plain text on our box, not end-to-end encrypted,
          and are deleted after 30 days. We say that here so nobody is told otherwise.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">Civic and the Quorum desk</h2>
        <p className="max-w-2xl text-sm text-muted">
          The Civic room is where Quorum lives. A campaign is one demand on one office in one hour.
          While the window is open, it shows in Civic as a labeled card. Every call, letter, or visit
          you log on the desk files as a Did here: an act, a date, one proof. A supported candidate
          gets a labeled card in Civic. It does not outrank a neighbor's Did, and it never changes
          the sort.
        </p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">You</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-muted">
            Name on your posts (login replaces this on the server)
            <input className={fieldClass} value={me} placeholder="Your name" onChange={(event) => setMe(event.target.value)} />
          </label>
          <label className="flex items-center gap-3 self-end text-sm text-muted">
            <input type="checkbox" className="size-5" checked={replyNotify} onChange={(event) => setReplyNotify(event.target.checked)} />
            Tell me about replies
          </label>
          <label className="flex items-center gap-3 text-sm text-muted">
            <input type="checkbox" className="size-5" checked={steward} onChange={(event) => setSteward(event.target.checked)} />
            Steward tools (the Rules owner holds this on the server)
          </label>
        </div>
      </section>

      {removals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-fg">Removal log</h2>
          <p className="text-sm text-muted">Answer any abuse ticket with this.</p>
          <ul className="flex flex-col gap-2">
            {removals.map((row) => (
              <li key={row.id} className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
                {new Date(row.at).toLocaleString()} · {row.author} ·{" "}
                {HARD_RULES.find((rule) => rule.id === row.reason)?.label ?? row.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
