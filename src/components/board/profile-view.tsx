import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { AccountRemoval } from "@/components/board/account-removal";
import { btnQuiet, fieldClass, Kicker } from "@/components/quorum/bits";
import { FIELD_HINT } from "@/lib/board/field-hints";
import { cn } from "@/lib/cn";
import { authorName, cardSummary, formatDate, metAt, namedLines } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { useMessageReach } from "@/components/board/use-message-reach";
import { MfaSettings } from "@/components/board/mfa-ui";
import { useServerSession } from "@/lib/server-session-state";

/**
 * Household, church, trade, plus who you have met, what you host, and
 * when a host mentioned you. Visible only to people who have been to the
 * same meeting as you; everyone else sees a name.
 */
export function ProfileView() {
  const rawMe = useBoard((state) => state.me);
  const me = authorName(rawMe);
  const setMe = useBoard((state) => state.setMe);
  const viewing = useBoard((state) => state.viewing);
  const profile = useBoard((state) => state.profile);
  const setProfile = useBoard((state) => state.setProfile);
  const deskOn = useBoard((state) => state.deskOn);
  const setDeskOn = useBoard((state) => state.setDeskOn);
  const [knownAs, setKnownAs] = useState(rawMe);
  const [household, setHousehold] = useState(profile.household);
  const [parish, setParish] = useState(profile.parish);
  const [trade, setTrade] = useState(profile.trade);
  const fieldsId = useId();
  const [saved, setSaved] = useState(false);
  const skipSave = useRef(true);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    setSaved(false);
    const save = window.setTimeout(() => {
      setProfile({ household, parish, trade });
      const next = knownAs.trim();
      if (next) {
        const current = useBoard.getState();
        if (authorName(current.viewing ?? "") === authorName(current.me)) {
          useBoard.setState({ viewing: next });
        }
        setMe(next);
      }
      setSaved(true);
    }, 600);
    const hide = window.setTimeout(() => setSaved(false), 2600);
    return () => {
      window.clearTimeout(save);
      window.clearTimeout(hide);
    };
  }, [household, parish, trade, knownAs, setProfile, setMe]);
  const cards = useBoard((state) => state.cards);
  const posts = useBoard((state) => state.posts);
  const openDm = useBoard((state) => state.openDm);
  const server = useServerSession();
  const name = viewing?.trim() || me;
  const mine = name === me;

  // The profile gate is a meeting together, as the page says. Replies do not count.
  const peers = useMemo(() => metAt(me, cards), [me, cards]);
  const allowed = mine || peers.has(name);
  const theirs = useMemo(() => metAt(name, cards), [name, cards]);
  const joinedRooms = useBoard((state) => state.rooms);
  const reach = useMessageReach(
    joinedRooms.filter((room) => room.joined).map((room) => room.id),
  );
  const hosts = cards.filter((card) => card.host === name && card.kind !== "trade" && card.kind !== "need");
  const named = useMemo(() => namedLines(name, posts), [name, posts]);

  if (!allowed) {
    return (
      <div className="plate pc-head flex flex-col gap-3">
        <Kicker>Profile</Kicker>
        <h1 className="illum font-display text-4xl text-fg">{name}</h1>
        <p className="max-w-2xl text-base text-muted">You can see a profile once you have been to the same meeting as that person. You and {name} have not been to one yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 lg:max-w-4xl">
      <section className="plate pc-head flex flex-col gap-2">
        <Kicker>{mine ? "You" : "Profile"}</Kicker>
        <h1 className="illum font-display text-4xl text-fg lg:text-5xl">{name}</h1>
        {mine ? (
          <p className="max-w-prose text-sm text-muted">Your household, church, and trade. Only people who have been to the same meeting as you can see this page; to everyone else you are a name.</p>
        ) : null}
        {mine ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-2 text-sm text-muted sm:col-span-3">
              Name, as people know you
              <input
                className={cn(fieldClass, "min-h-[44px]")}
                autoComplete="name"
                value={knownAs}
                onChange={(event) => setKnownAs(event.target.value)}
              />
            </label>
            <div className="flex flex-col gap-2 text-sm text-muted">
              <label htmlFor={`${fieldsId}-household`}>Household</label>
              <input
                id={`${fieldsId}-household`}
                className={cn(fieldClass, "min-h-[44px]")}
                aria-describedby={`${fieldsId}-household-hint`}
                value={household}
                onChange={(event) => setHousehold(event.target.value)}
              />
              <p id={`${fieldsId}-household-hint`} className="text-xs text-muted">
                {FIELD_HINT.household}
              </p>
            </div>
            <div className="flex flex-col gap-2 text-sm text-muted">
              <label htmlFor={`${fieldsId}-church`}>Church</label>
              <input
                id={`${fieldsId}-church`}
                className={cn(fieldClass, "min-h-[44px]")}
                aria-describedby={`${fieldsId}-church-hint`}
                value={parish}
                onChange={(event) => setParish(event.target.value)}
              />
              <p id={`${fieldsId}-church-hint`} className="text-xs text-muted">
                {FIELD_HINT.church}
              </p>
            </div>
            <div className="flex flex-col gap-2 text-sm text-muted">
              <label htmlFor={`${fieldsId}-trade`}>Trade</label>
              <input
                id={`${fieldsId}-trade`}
                className={cn(fieldClass, "min-h-[44px]")}
                aria-describedby={`${fieldsId}-trade-hint`}
                value={trade}
                onChange={(event) => setTrade(event.target.value)}
              />
              <p id={`${fieldsId}-trade-hint`} className="text-xs text-muted">
                {FIELD_HINT.trade}
              </p>
            </div>
            {saved ? (
              <p role="status" className="text-sm text-muted sm:col-span-3">
                Saved
              </p>
            ) : null}
          </div>
        ) : null}
        {mine ? (
          <section className="mt-4 flex flex-col gap-2">
            <h2 className="text-2xl text-fg">The desk</h2>
            <p className="max-w-prose text-sm text-muted">
              Optional: coordinated calls to local officials. It stays off until you turn it on.
              The emblems stay.
            </p>
            <label className="inline-flex min-h-[44px] items-center gap-3 text-sm text-fg">
              <input
                type="checkbox"
                className="size-5"
                checked={deskOn}
                onChange={(event) => setDeskOn(event.target.checked)}
              />
              Show The desk
            </label>
          </section>
        ) : null}
        {!mine && reach.canMessage(name) ? (
          <button type="button" className={btnQuiet + " self-start px-0"} onClick={() => openDm(name)}>
            <MessageSquare className="size-4" aria-hidden="true" />
            Message {name}
          </button>
        ) : null}
      </section>

      {named.length > 0 ? (
        <section className="card pc-card flex flex-col gap-2 p-4 sm:p-5">
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
        <section className="card pc-card flex flex-col gap-2 p-4 sm:p-5">
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

      <section className="card pc-card flex flex-col gap-2 p-4 sm:p-5">
        <h2 className="text-2xl text-fg">{mine ? "People you've met here" : `People ${name} has met here`}</h2>
        <p className="text-sm text-muted">{theirs.size === 0 ? "No one yet. People you meet at a gathering will appear here." : [...theirs].join(", ")}</p>
      </section>

      {mine && server.mode === "live" ? <MfaSettings /> : null}
      {mine ? (
        <div className="card pc-card p-4 sm:p-5">
          <AccountRemoval live={server.mode === "live" && Boolean(server.user)} />
        </div>
      ) : null}
    </div>
  );
}
