import { btnGhost, btnSignal, fieldClass, Kicker, pill } from "@/components/quorum/bits";
import { Emblem } from "@/components/board/emblem";
import { POST_TYPES, ROOMS, RULE_LABEL, type HardRule } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { THEMES } from "@/lib/board/themes";

const RULES = Object.keys(RULE_LABEL) as HardRule[];

export function AboutView() {
  const me = useBoard((state) => state.me);
  const setMe = useBoard((state) => state.setMe);
  const steward = useBoard((state) => state.steward);
  const setSteward = useBoard((state) => state.setSteward);
  const removals = useBoard((state) => state.removals);
  const loadSample = useBoard((state) => state.loadSample);
  const clearBoard = useBoard((state) => state.clearBoard);
  const theme = useBoard((state) => state.theme);
  const setTheme = useBoard((state) => state.setTheme);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Kicker>What this is</Kicker>
        <h1 className="max-w-xl font-display text-4xl text-fg">A town board with a lock on the feed.</h1>
        <p className="max-w-2xl text-base text-muted">
          It holds what a small set of people did, where they meet, and what they saw in public. It is not a
          Twitter replacement. Success is a person who opens it, reads their room, and leaves.
        </p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">Our stance</h2>
        <p className="mt-2 text-sm text-muted">[OWNER TO WRITE]</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">Look</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={theme === item.id}
              onClick={() => setTheme(item.id)}
              className={pill(theme === item.id, "px-4")}
            >
              <Emblem theme={item.id} size="pill" />
              {item.name}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">How it works</h2>
        <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
          <li>Chronological inside the room. The list ends with "You're caught up."</li>
          <li>No For You, no reshare, no quote-post, no like counts, no badges, no streaks.</li>
          <li>Notifications off. A line at twenty minutes, one tap to dismiss.</li>
          <li>A room opens on what is coming up inside two weeks, then its feed.</li>
          <li>Every post picks a type or it does not send: one claim, one reason.</li>
          <li>The host closes a date with a Hosted: it happened, next date, no headcount.</li>
          <li>A card lists after two people have been. A business lists after two members name its work.</li>
          <li>Messages: two names, plain text, not encrypted, deleted after 30 days. No groups.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">Post types and rooms</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {POST_TYPES.map((type) => (
            <article key={type.id} className="rounded-lg border border-line bg-surface p-4">
              <h3 className="text-xl text-fg">{type.label}</h3>
              <p className="mt-1 text-sm text-muted">{type.what}</p>
            </article>
          ))}
        </div>
        <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
          {ROOMS.map((room) => (
            <li key={room.id}>
              <span className="font-semibold text-fg">{room.name}.</span> {room.what}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">The rule</h2>
        <p className="text-sm text-muted">
          Hard remove, 30-day filing ban, account closed on the second: {RULES.map((rule) => RULE_LABEL[rule].toLowerCase()).join(", ")}.
          The host would cut the box off for the last one whether the rules mentioned it or not.
        </p>
        <p className="text-sm text-muted">
          Everything else stays up, including claims the stewards think are false. A sloppy post files at the bottom
          and cannot be pinned; three in a row locks Saw until one is revised. A post with no reason is marked
          unsupported, stays visible, and sorts under posts that named one. The mark is about the missing reason,
          not the side, and every mark is logged in the room for everyone to read.
        </p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">You</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-muted">
            Name on your posts
            <input className={fieldClass} value={me} placeholder="Your name" onChange={(event) => setMe(event.target.value)} />
          </label>
          <label className="flex items-center gap-3 self-end text-sm text-muted">
            <input type="checkbox" className="size-5" checked={steward} onChange={(event) => setSteward(event.target.checked)} />
            Steward tools
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={btnSignal} onClick={loadSample}>
            Load the sample week
          </button>
          <button type="button" className={btnGhost} onClick={clearBoard}>
            Clear the board
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">The sample is six invented members and a week of posts. You become Josh. It replaces what is here.</p>
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
