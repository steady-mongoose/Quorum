import { btnGhost, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { APP_NAME, POST_TYPES, ROOMS, RULE_LABEL, type HardRule } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

const RULES = Object.keys(RULE_LABEL) as HardRule[];

export function AboutView() {
  const me = useBoard((state) => state.me);
  const setMe = useBoard((state) => state.setMe);
  const steward = useBoard((state) => state.steward);
  const removals = useBoard((state) => state.removals);
  const loadSample = useBoard((state) => state.loadSample);
  const clearBoard = useBoard((state) => state.clearBoard);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Kicker>What this is</Kicker>
        <h1 className="max-w-xl font-display text-4xl text-balance text-fg lg:text-5xl">Your church, your shop, your county.</h1>
        <p className="max-w-prose text-base text-muted">
          {APP_NAME} holds where a small set of people meet, what they did, and what the parish needs this week. It is not a feed. You open it, see where to be, and go.
        </p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">Our stance</h2>
        <p className="mt-2 text-sm text-muted">[OWNER TO WRITE]</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">How it works</h2>
        <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2 lg:grid-cols-3">
          <li>The week comes first: the next seven days with something on them, and this week's call.</li>
          <li>You get in by a host's code to one card. Say you'll be there. Go.</li>
          <li>The host closes the date: how it went, who came, one person named if someone earned it, the next date. No headcount.</li>
          <li>People who have been to the same meeting can message each other and see each other's profile. Nobody else can.</li>
          <li>No feed algorithm, no reshare, no like counts, no scores. The list ends.</li>
          <li>A trade is listed by two members it worked for, never by itself.</li>
          <li>A parish need is a list of days. Put your name on one.</li>
          <li>Messages: two names, plain text, deleted after 30 days. No groups.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">Post types</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {POST_TYPES.map((type) => (
            <div key={type.id} className="contents">
              <dt className="font-semibold text-fg">{type.label}</dt>
              <dd className="max-w-prose text-muted">{type.what}</dd>
            </div>
          ))}
        </dl>
        <h2 className="mt-4 text-2xl text-fg">Rooms</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {ROOMS.map((room) => (
            <div key={room.id} className="contents">
              <dt className="font-semibold text-fg">{room.name}</dt>
              <dd className="max-w-prose text-muted">{room.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">The rule</h2>
        <p className="text-sm text-muted">
          Hard remove, 30-day filing ban, account closed on the second: {RULES.map((rule) => RULE_LABEL[rule].toLowerCase()).join(", ")}. Everything else stays up. A sloppy post files at the bottom; a post with no reason is marked unsupported and sorts under posts that named one. Every mark is logged in the room for everyone to read.
        </p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">You</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-muted">
            Name on your posts
            <input className={fieldClass} value={me} placeholder="Your name" onChange={(event) => setMe(event.target.value)} />
          </label>
          <p className="self-end text-sm text-muted">{steward ? "You hold steward tools." : "Stewards are named by the founder, not self-appointed."}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={btnSignal} onClick={loadSample}>
            Load the sample week
          </button>
          <button type="button" className={btnGhost} onClick={clearBoard}>
            Clear the board
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">The sample is six invented members and a week. You become Josh. It replaces what is here.</p>
      </section>

      {removals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-fg">Removal log</h2>
          <ul className="flex flex-col gap-2">
            {removals.map((row) => (
              <li key={row.id} className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
                {new Date(row.at).toLocaleString()} · {row.author} · {RULE_LABEL[row.reason]}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
