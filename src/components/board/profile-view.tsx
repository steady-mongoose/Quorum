import { useMemo } from "react";
import { MessageSquare } from "lucide-react";
import { btnQuiet, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { authorName, cardSummary, formatDate, namedLines, stoodWith } from "@/lib/board/model";
import { CONGREGATIONS, MEMBER_ROOMS, localRoomLabel } from "@/lib/board/places";
import { useBoard } from "@/lib/board/store";

/**
 * Household, church, trade, plus who you have met, what you host, and
 * when a host mentioned you. Visible only to people who have been to the
 * same meeting as you; everyone else sees a name.
 */
export function ProfileView() {
  const me = useBoard((state) => authorName(state.me));
  const viewing = useBoard((state) => state.viewing);
  const profile = useBoard((state) => state.profile);
  const setProfile = useBoard((state) => state.setProfile);
  const joined = useBoard((state) => state.joined);
  const joinPlace = useBoard((state) => state.joinPlace);
  const leavePlace = useBoard((state) => state.leavePlace);
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
        <p className="max-w-2xl text-base text-muted">You can see a profile once you have been to the same meeting as that person. You and {name} have not been to one yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 lg:max-w-4xl">
      <section className="flex flex-col gap-2">
        <Kicker>{mine ? "You" : "Profile"}</Kicker>
        <h1 className="font-display text-4xl text-fg lg:text-5xl">{name}</h1>
        {mine ? (
          <p className="max-w-prose text-sm text-muted">Your household, church, trade, and ZIP. The ZIP picks your town. The church name, when it matches one we know, is your congregation. Only people who have been to the same meeting as you can see this page; to everyone else you are a name.</p>
        ) : null}
        {mine ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm text-muted">
              Household
              <input className={fieldClass} placeholder="the McMullins" value={profile.household} onChange={(event) => setProfile({ household: event.target.value })} />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Church
              <input className={fieldClass} placeholder="Epiphany of Our Lord" value={profile.parish} onChange={(event) => setProfile({ parish: event.target.value })} list="congregations" />
              <datalist id="congregations">
                {CONGREGATIONS.map((item) => (
                  <option key={item.id} value={item.name} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Trade
              <input className={fieldClass} placeholder="Electrician" value={profile.trade} onChange={(event) => setProfile({ trade: event.target.value })} />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              ZIP
              <input className={fieldClass} inputMode="numeric" autoComplete="postal-code" placeholder="33578" maxLength={10} value={profile.zip} onChange={(event) => setProfile({ zip: event.target.value })} />
            </label>
          </div>
        ) : null}
        {!mine ? (
          <button type="button" className={btnQuiet + " self-start px-0"} onClick={() => openDm(name)}>
            <MessageSquare className="size-4" aria-hidden="true" />
            Message {name}
          </button>
        ) : null}
      </section>

      {named.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xl text-fg">Mentioned by a host</h2>
          <p className="text-sm text-muted">A host can single out one person after each meeting. The last few times that was {mine ? "you" : name}:</p>
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
          <h2 className="text-2xl text-fg">{mine ? "Meetings you host" : `Meetings ${name} hosts`}</h2>
          <ul className="flex flex-col gap-2">
            {hosts.map((card) => (
              <li key={card.id} className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <span className="text-fg">{card.name}</span> <span className="text-muted">· {cardSummary(card)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mine ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-2xl text-fg">Rooms you've joined</h2>
          <p className="max-w-prose text-sm text-muted">Joined rooms come first on the front page. Your town's other rooms come next, from the ZIP above. Leaving a room does not erase its cards.</p>
          <ul className="flex flex-col gap-2 lg:max-w-xl">
            {MEMBER_ROOMS.map((room) => {
              const on = joined.some((place) => place.kind === "room" && place.id === room.id);
              return (
                <li key={room.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2">
                  <span className="text-sm text-fg">{localRoomLabel(room)}</span>
                  <button type="button" className={on ? btnQuiet : btnSignal} onClick={() => (on ? leavePlace({ kind: "room", id: room.id }) : joinPlace({ kind: "room", id: room.id }))}>
                    {on ? "Leave" : "Join"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-2xl text-fg">{mine ? "People you've met here" : `People ${name} has met here`}</h2>
        <p className="text-sm text-muted">{theirs.size === 0 ? "Nobody yet. Go to a meeting." : [...theirs].join(", ")}</p>
      </section>
    </div>
  );
}
