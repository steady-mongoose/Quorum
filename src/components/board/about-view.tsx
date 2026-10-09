import { useState } from "react";
import { btnGhost, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { APP_NAME, POST_TYPES, ROOMS, RULE_LABEL, formatDate, type HardRule } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

const RULES = Object.keys(RULE_LABEL) as HardRule[];

export function AboutView() {
  const me = useBoard((state) => state.me);
  const setMe = useBoard((state) => state.setMe);
  const steward = useBoard((state) => state.steward);
  const setSteward = useBoard((state) => state.setSteward);
  const removals = useBoard((state) => state.removals);
  const loadSample = useBoard((state) => state.loadSample);
  const clearBoard = useBoard((state) => state.clearBoard);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Kicker>What this is</Kicker>
        <h1 className="max-w-xl font-display text-4xl text-fg">Your church, your shop, your county.</h1>
        <p className="max-w-2xl text-base text-muted">
          {APP_NAME} holds where a small set of people meet, what they did, and what the parish needs this week. It is not a feed. You open it, see where to be, and go.
        </p>
      </section>

      <Redeem />

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-2xl text-fg">Our stance</h2>
        <p className="mt-2 text-sm text-muted">[OWNER TO WRITE]</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl text-fg">How it works</h2>
        <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
          <li>The week comes first: the next seven days with something on them, and this week's call.</li>
          <li>You get in by a host's code to one card. Say you'll be there. Go.</li>
          <li>The host closes the date: how it went, who came, one person named if someone earned it, the next date. No headcount.</li>
          <li>Who came goes on the "been" list. People who have stood in a room together can message each other and see each other's four lines.</li>
          <li>No feed algorithm, no reshare, no like counts, no scores. The list ends.</li>
          <li>A trade is listed by two members it worked for, never by itself.</li>
          <li>A parish need is a list of days. Put your name on one.</li>
          <li>Messages: two names, plain text, deleted after 30 days. No groups.</li>
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

/** Have a code? It opens one card, after a name. */
function Redeem() {
  const redeemInvite = useBoard((state) => state.redeemInvite);
  const setSection = useBoard((state) => state.setSection);
  const me = useBoard((state) => state.me);
  const [code, setCode] = useState("");
  const [name, setName] = useState(me);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section className="rounded-lg border border-signal bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">Have a code?</h2>
      <p className="mt-1 text-sm text-muted">A host gave it to you for one thing. Put your name to it and the card opens.</p>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          const card = redeemInvite(code, name);
          setOutcome(
            card
              ? { ok: true, text: `You're on the list for ${card.name}, ${formatDate(card.next)}.` }
              : { ok: false, text: "That code is spent or stale. Ask the host for another." },
          );
        }}
      >
        <input className={fieldClass} placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} aria-label="Your name" />
        <input className={cn(fieldClass, "font-mono tracking-widest uppercase")} placeholder="CODE" value={code} onChange={(event) => setCode(event.target.value)} aria-label="Invite code" />
        <button type="submit" className={btnSignal}>
          Open it
        </button>
      </form>
      {outcome ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">{outcome.text}</p>
          {outcome.ok ? (
            <button type="button" className={btnGhost} onClick={() => setSection("week")}>
              See this week
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
