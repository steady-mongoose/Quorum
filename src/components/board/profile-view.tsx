import { useMemo } from "react";
import { MessageSquare } from "lucide-react";
import { btnQuiet, fieldClass, Kicker } from "@/components/quorum/bits";
import { authorName, cardSummary, formatDate, namedLines, stoodWith } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

/**
 * Four lines, earned by going somewhere. Visible in full only to people
 * who have stood in a room with you; everyone else sees a name.
 */
export function ProfileView() {
  const me = useBoard((state) => authorName(state.me));
  const viewing = useBoard((state) => state.viewing);
  const profile = useBoard((state) => state.profile);
  const setProfile = useBoard((state) => state.setProfile);
  const cards = useBoard((state) => state.cards);
  const posts = useBoard((state) => state.posts);
  const openDm = useBoard((state) => state.openDm);
  const name = viewing?.trim() || me;
  const mine = name === me;

  const peers = useMemo(() => stoodWith(me, cards, posts), [me, cards, posts]);
  const allowed = mine || peers.has(name);
  const theirs = useMemo(() => stoodWith(name, cards, posts), [name, cards, posts]);
  const hosts = cards.filter((card) => card.host === name && card.kind !== "trade" && card.kind !== "need");
  const named = useMemo(() => namedLines(name, posts), [name, posts]);

  if (!allowed) {
    return (
      <div className="flex flex-col gap-3">
        <Kicker>Profile</Kicker>
        <h1 className="font-display text-4xl text-fg">{name}</h1>
        <p className="max-w-2xl text-base text-muted">You have not stood in a room with {name} yet. Go to something they go to.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 lg:max-w-4xl">
      <section className="flex flex-col gap-2">
        <Kicker>{mine ? "You" : "Profile"}</Kicker>
        <h1 className="font-display text-4xl text-fg lg:text-5xl">{name}</h1>
        {mine ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-2 text-sm text-muted">
              Household
              <input className={fieldClass} placeholder="the McMullins" value={profile.household} onChange={(event) => setProfile({ household: event.target.value })} />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Parish or congregation
              <input className={fieldClass} value={profile.parish} onChange={(event) => setProfile({ parish: event.target.value })} />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Trade
              <input className={fieldClass} value={profile.trade} onChange={(event) => setProfile({ trade: event.target.value })} />
            </label>
          </div>
        ) : (
          <p className="text-sm text-muted">Only what the name says. Household, parish, and trade are theirs to tell you.</p>
        )}
        {!mine ? (
          <button type="button" className={btnQuiet + " self-start px-0"} onClick={() => openDm(name)}>
            <MessageSquare className="size-4" aria-hidden="true" />
            Message {name}
          </button>
        ) : null}
      </section>

      {named.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xl text-fg">Named</h2>
          <ul className="flex flex-col gap-2">
            {named.map((post) => (
              <li key={post.id} className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <span className="text-fg">{post.claim}</span>
                <span className="text-muted">
                  {" "}
                  · {post.author}, {formatDate(post.on)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hosts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xl text-fg">Hosts</h2>
          <ul className="flex flex-col gap-2">
            {hosts.map((card) => (
              <li key={card.id} className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <span className="text-fg">{card.name}</span> <span className="text-muted">· {cardSummary(card)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-2xl text-fg">Stood with</h2>
        <p className="text-sm text-muted">{theirs.size === 0 ? "Nobody yet." : [...theirs].join(", ")}</p>
      </section>
    </div>
  );
}
