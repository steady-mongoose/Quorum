import { useState } from "react";
import { MessageSquare, Pin, PinOff, Trash2 } from "lucide-react";
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  ROOMS,
  canDm,
  cardCanPin,
  cardListed,
  formatDate,
  roomById,
  todayIso,
  tradeWitnesses,
  type CardKind,
  type MeetingCard,
  type RoomId,
} from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

export function FindView() {
  const cards = useBoard((state) => state.cards);
  const posts = useBoard((state) => state.posts);
  const steward = useBoard((state) => state.steward);
  const meetings = cards.filter((card) => card.kind !== "trade");
  const trades = cards.filter((card) => card.kind === "trade");
  const listed = meetings
    .filter((card) => cardListed(card, posts))
    .sort((a, b) => (a.next || "9999").localeCompare(b.next || "9999") || a.name.localeCompare(b.name));
  const waiting = meetings.filter((card) => !cardListed(card, posts));
  const tradesListed = trades.filter((card) => cardListed(card, posts));
  const tradesWaiting = trades.filter((card) => !cardListed(card, posts));

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

      {trades.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-fg">Trades</h2>
          <p className="text-sm text-muted">
            A business cannot list itself. Two members who it worked for file a Did naming it, and
            it is listed. The work is the advertisement.
          </p>
          {tradesListed.map((card) => (
            <CardRow key={card.id} card={card} steward={steward} />
          ))}
          {tradesWaiting.length > 0 ? (
            <p className="text-sm text-muted">Waiting on witnesses:</p>
          ) : null}
          {tradesWaiting.map((card) => (
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
  const cards = useBoard((state) => state.cards);
  const me = useBoard((state) => state.me);
  const visited = useBoard((state) => state.visited);
  const updateCard = useBoard((state) => state.updateCard);
  const markHappened = useBoard((state) => state.markHappened);
  const removeCard = useBoard((state) => state.removeCard);
  const openDm = useBoard((state) => state.openDm);
  const [nextDate, setNextDate] = useState(card.next || todayIso());
  const [closing, setClosing] = useState(false);
  const room = roomById(card.room);
  const name = me.trim() || "You";
  const host = card.host && card.host === name;
  const canPin = cardCanPin(card, posts);
  const shown = cardListed(card, posts);
  const witnesses = card.kind === "trade" ? tradeWitnesses(card, posts) : [];
  const canMessageHost = card.host && card.host !== name && canDm(me.trim(), card.host, cards, posts);
  const wentToo = card.wentBy.includes(name);

  return (
    <article className={cn("rounded-lg border border-line bg-surface p-4", !shown && "opacity-80")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg">{room.name}</span>
        {card.kind === "candidate" ? (
          <span className="rounded-sm border border-signal px-2 py-1 text-signal">Candidate card</span>
        ) : null}
        {card.kind === "trade" ? (
          <span className="rounded-sm border border-line px-2 py-1 text-muted">Trade</span>
        ) : null}
        {card.unverified ? <span className="text-muted">to be visited</span> : null}
        {card.pinned ? <span className="text-signal">pinned</span> : null}
        {card.firstTimer ? <span className="text-signal">takes a first-timer</span> : null}
      </div>
      <h3 className="mt-2 text-xl text-fg">{card.name}</h3>
      <p className="text-sm text-muted">
        {card.place} · {card.time}
        {card.host ? ` · ${card.kind === "trade" ? "" : "host "}${card.host}` : ""}
      </p>

      {card.kind === "trade" ? (
        <p className="mt-1 text-sm text-muted">
          {witnesses.length === 0
            ? "No member has named this work yet."
            : `Named by ${witnesses.join(", ")}${witnesses.length < 2 ? " · one more lists it" : ""}`}
        </p>
      ) : (
        <>
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
            {card.wentBy.length > 0 ? <span>· went: {card.wentBy.join(", ")}</span> : null}
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {card.kind !== "trade" ? (
          <button type="button" className={btnGhost} onClick={() => visited(card.id)}>
            {wentToo ? "I went again" : "I went"}
          </button>
        ) : null}
        {canMessageHost ? (
          <button type="button" className={btnQuiet} onClick={() => openDm(card.host)}>
            <MessageSquare className="size-4" aria-hidden="true" />
            Message {card.host}
          </button>
        ) : card.firstTimer && card.host && card.host !== name ? (
          <span className="self-center text-xs text-muted">Go once, mark it, then you can message the host.</span>
        ) : null}
        {(host || steward) && shown && card.kind !== "trade" ? (
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
        {host && card.kind !== "trade" ? (
          <button type="button" className={btnQuiet} onClick={() => updateCard(card.id, { firstTimer: !card.firstTimer })}>
            {card.firstTimer ? "Stop taking first-timers" : "Take a first-timer"}
          </button>
        ) : null}
        {(host || steward) && card.kind !== "trade" ? (
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
  const [firstTimer, setFirstTimer] = useState(false);
  const count = Math.max(0, Math.round(Number(visits) || 0));
  const trade = kind === "trade";

  function submit() {
    addCard({
      room,
      kind,
      name,
      place,
      time,
      host: host || me,
      next: trade ? "" : next,
      visits: trade ? 0 : count,
      addedBy: me.trim() || "You",
      firstTimer: trade ? false : firstTimer,
    });
    setName("");
    setPlace("");
    setTime("");
    setNext("");
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">List a card</h2>
      <p className="mt-1 text-sm text-muted">
        A meeting lists only after you have been twice. A trade lists only after two members name
        its work in a Did; the tradesman cannot be one of them. Candidate cards go in Civic, labeled,
        and never outrank a neighbor's Did.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-muted">
          Room
          <select className={fieldClass} value={room} onChange={(event) => { const id = event.target.value as RoomId; setRoom(id); if (id !== "civic" && kind === "candidate") setKind("meeting"); if (id !== "skills" && id !== "guilds" && kind === "trade") setKind("meeting"); }}>
            {ROOMS.filter((item) => item.id !== "dispatch").map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Kind
          <select className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value as CardKind)}>
            <option value="meeting">{roomById(room).service ? "Service" : "Meeting"}</option>
            {room === "civic" ? <option value="candidate">Candidate card (labeled)</option> : null}
            {room === "skills" || room === "guilds" ? <option value="trade">Trade (a business)</option> : null}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          {trade ? "Business or tradesman" : "Name"}
          <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          {trade ? "Town" : "Place"}
          <input className={fieldClass} value={place} onChange={(event) => setPlace(event.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          {trade ? "What they do" : "Time"}
          <input className={fieldClass} placeholder={trade ? "Electrical, residential" : "First Monday 7:30 p.m."} value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          {trade ? "Their name on this board" : "Host"}
          <input className={fieldClass} placeholder={me || "A name, not a group"} value={host} onChange={(event) => setHost(event.target.value)} />
        </label>
        {trade ? null : (
          <>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Next date{room === "guilds" ? " (required for Guilds)" : ""}
              <input type="date" className={fieldClass} value={next} onChange={(event) => setNext(event.target.value)} />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Times you have been
              <input type="number" min={0} className={fieldClass} value={visits} onChange={(event) => setVisits(event.target.value)} />
            </label>
            <label className="flex items-center gap-3 text-sm text-muted sm:col-span-2">
              <input type="checkbox" className="size-5" checked={firstTimer} onChange={(event) => setFirstTimer(event.target.checked)} />
              The host takes a first-timer. Someone who has been once can message the host.
            </label>
          </>
        )}
      </div>
      <button type="button" className={cn(btnSignal, "mt-4")} onClick={submit}>
        {trade ? "Save, waiting on witnesses" : count < 2 ? "Save, not yet listed" : "List it"}
      </button>
    </section>
  );
}
