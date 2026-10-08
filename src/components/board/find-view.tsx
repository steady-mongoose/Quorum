import { useState } from "react";
import { Pin, PinOff, Trash2 } from "lucide-react";
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  ROOMS,
  cardCanPin,
  cardListed,
  formatDate,
  roomById,
  todayIso,
  type CardKind,
  type MeetingCard,
  type RoomId,
} from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

export function FindView() {
  const cards = useBoard((state) => state.cards);
  const steward = useBoard((state) => state.steward);
  const listed = cards
    .filter(cardListed)
    .sort((a, b) => (a.next || "9999").localeCompare(b.next || "9999") || a.name.localeCompare(b.name));
  const waiting = cards.filter((card) => !cardListed(card));

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Kicker>Find</Kicker>
        <h1 className="max-w-xl font-display text-4xl text-fg">A date list. Not a recommendation.</h1>
        <p className="max-w-2xl text-base text-muted">
          Name, place, time, host, and whether the last four meetings happened. Strangers do not
          create listings. Someone who went twice can. A card hides after two missed meetings. A text
          to ten named people is the real promotion.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        {listed.length === 0 ? (
          <p className="text-sm text-muted">No card has been visited twice yet.</p>
        ) : (
          listed.map((card) => <CardRow key={card.id} card={card} steward={steward} />)
        )}
      </section>

      {waiting.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-fg">Not yet listed</h2>
          <p className="text-sm text-muted">
            Checked once, still to be visited before they stay. Mark "I went" after a real visit.
          </p>
          {waiting.map((card) => (
            <CardRow key={card.id} card={card} steward={steward} />
          ))}
        </section>
      ) : null}

      <AddCard />
    </div>
  );
}

function CardRow({ card, steward }: { card: MeetingCard; steward: boolean }) {
  const posts = useBoard((state) => state.posts);
  const me = useBoard((state) => state.me);
  const visited = useBoard((state) => state.visited);
  const updateCard = useBoard((state) => state.updateCard);
  const markHappened = useBoard((state) => state.markHappened);
  const removeCard = useBoard((state) => state.removeCard);
  const [nextDate, setNextDate] = useState(card.next || todayIso());
  const [closing, setClosing] = useState(false);
  const room = roomById(card.room);
  const host = card.host && card.host === (me.trim() || "You");
  const canPin = cardCanPin(card, posts);
  const shown = cardListed(card);

  return (
    <article className={cn("rounded-lg border border-line bg-surface p-4", !shown && "opacity-80")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg">{room.name}</span>
        {card.kind === "candidate" ? (
          <span className="rounded-sm border border-signal px-2 py-1 text-signal">Candidate card</span>
        ) : null}
        {card.unverified ? <span className="text-muted">to be visited</span> : null}
        {card.pinned ? <span className="text-signal">pinned</span> : null}
      </div>
      <h3 className="mt-2 text-xl text-fg">{card.name}</h3>
      <p className="text-sm text-muted">
        {card.place} · {card.time}
        {card.host ? ` · host ${card.host}` : ""}
      </p>
      <p className="mt-1 text-sm text-muted">
        {card.next ? `Next ${formatDate(card.next)}` : room.id === "guilds" ? "No next date. Not listed." : "No next date yet."}
      </p>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted" aria-label="Last four meetings">
        <span>Last four:</span>
        {card.lastFour.length === 0 ? (
          <span>none logged</span>
        ) : (
          card.lastFour.map((went, index) => (
            <span
              key={index}
              className={cn("size-3 rounded-sm", went ? "bg-signal" : "border border-line")}
              title={went ? "happened" : "missed"}
            />
          ))
        )}
        <span>· {card.visits} visit{card.visits === 1 ? "" : "s"} by the lister</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnGhost} onClick={() => visited(card.id)}>
          I went
        </button>
        {(host || steward) && shown ? (
          <button
            type="button"
            className={btnQuiet}
            disabled={!card.pinned && !canPin}
            title={!canPin ? "The host's last note was marked. Revise it first." : undefined}
            onClick={() => updateCard(card.id, { pinned: !card.pinned })}
          >
            {card.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            {card.pinned ? "Drop pin" : "Pin in room"}
          </button>
        ) : null}
        {host || steward ? (
          closing ? (
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <input
                type="date"
                className={cn(fieldClass, "sm:max-w-xs")}
                value={nextDate}
                onChange={(event) => setNextDate(event.target.value)}
                aria-label="Next date"
              />
              <button type="button" className={btnSignal} onClick={() => { markHappened(card.id, true, nextDate); setClosing(false); }}>
                It happened
              </button>
              <button type="button" className={btnGhost} onClick={() => { markHappened(card.id, false, nextDate); setClosing(false); }}>
                It did not
              </button>
              <button type="button" className={btnQuiet} onClick={() => setClosing(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className={btnQuiet} onClick={() => setClosing(true)}>
              After the hour
            </button>
          )
        ) : null}
        {steward ? (
          <button type="button" className={btnQuiet} aria-label={`Remove ${card.name}`} onClick={() => removeCard(card.id)}>
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function AddCard() {
  const me = useBoard((state) => state.me);
  const addCard = useBoard((state) => state.addCard);
  const [room, setRoom] = useState<RoomId>("skills");
  const [kind, setKind] = useState<CardKind>("meeting");
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [time, setTime] = useState("");
  const [host, setHost] = useState("");
  const [next, setNext] = useState("");
  const [visits, setVisits] = useState("2");
  const count = Math.max(0, Math.round(Number(visits) || 0));

  function submit() {
    addCard({ room, kind, name, place, time, host: host || me, next, visits: count, addedBy: me.trim() || "You" });
    setName("");
    setPlace("");
    setTime("");
    setNext("");
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">List a card</h2>
      <p className="mt-1 text-sm text-muted">
        Only after you have been twice. It stays off the list until then. Candidate cards go in
        Civic, labeled, and never outrank a neighbor's Did.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-muted">
          Room
          <select className={fieldClass} value={room} onChange={(event) => { const id = event.target.value as RoomId; setRoom(id); if (id !== "civic") setKind("meeting"); }}>
            {ROOMS.filter((item) => item.id !== "dispatch").map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {room === "civic" ? (
          <label className="flex flex-col gap-2 text-sm text-muted">
            Kind
            <select className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value as CardKind)}>
              <option value="meeting">Hearing or meeting</option>
              <option value="candidate">Candidate card (labeled)</option>
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-2 text-sm text-muted">
          Name
          <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Place
          <input className={fieldClass} value={place} onChange={(event) => setPlace(event.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Time
          <input className={fieldClass} placeholder="First Monday 7:30 p.m." value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Host
          <input className={fieldClass} placeholder={me || "A name, not a group"} value={host} onChange={(event) => setHost(event.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Next date{room === "guilds" ? " (required for Guilds)" : ""}
          <input type="date" className={fieldClass} value={next} onChange={(event) => setNext(event.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Times you have been
          <input type="number" min={0} className={fieldClass} value={visits} onChange={(event) => setVisits(event.target.value)} />
        </label>
      </div>
      <button type="button" className={cn(btnSignal, "mt-4")} onClick={submit}>
        {count < 2 ? "Save, not yet listed" : "List it"}
      </button>
    </section>
  );
}
