import { useMemo, useState } from "react";
import { MessageSquare, Pin, PinOff, Trash2 } from "lucide-react";
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  CARD_LABELS,
  ROOMS,
  authorName,
  cardCanPin,
  cardListed,
  cardSummary,
  formatDate,
  messageable,
  roomById,
  todayIso,
  witnessesByTrade,
  type CardKind,
  type MeetingCard,
  type RoomId,
} from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

export function FindView() {
  const cards = useBoard((state) => state.cards);
  const posts = useBoard((state) => state.posts);
  const me = useBoard((state) => authorName(state.me));
  const steward = useBoard((state) => state.steward);

  const witnesses = useMemo(() => witnessesByTrade(posts, cards), [posts, cards]);
  const canMessage = useMemo(() => messageable(me, cards, posts), [me, cards, posts]);
  const groups = useMemo(() => {
    const out = { listed: [] as MeetingCard[], waiting: [] as MeetingCard[], trades: [] as MeetingCard[] };
    for (const card of cards) {
      if (card.kind === "trade") out.trades.push(card);
      else if (cardListed(card, witnesses)) out.listed.push(card);
      else out.waiting.push(card);
    }
    out.listed.sort((a, b) => (a.next || "9999").localeCompare(b.next || "9999") || a.name.localeCompare(b.name));
    out.trades.sort((a, b) => Number(cardListed(b, witnesses)) - Number(cardListed(a, witnesses)));
    return out;
  }, [cards, witnesses]);

  const rowProps = { me, steward, canMessage };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Kicker>Find</Kicker>
        <h1 className="max-w-xl font-display text-4xl text-fg">A date list. Not a recommendation.</h1>
        <p className="max-w-2xl text-base text-muted">
          A card lists after two people have been. It hides after two missed meetings.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        {groups.listed.length === 0 ? <p className="text-sm text-muted">No card has been visited twice yet.</p> : null}
        {groups.listed.map((card) => (
          <MeetingRow key={card.id} card={card} shown {...rowProps} />
        ))}
      </section>

      {groups.waiting.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-fg">Not yet listed</h2>
          {groups.waiting.map((card) => (
            <MeetingRow key={card.id} card={card} shown={false} {...rowProps} />
          ))}
        </section>
      ) : null}

      {groups.trades.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-fg">Trades</h2>
          <p className="text-sm text-muted">A business lists when two members it worked for name it in a Did.</p>
          {groups.trades.map((card) => (
            <TradeRow key={card.id} card={card} witnesses={witnesses.get(card.id) ?? []} {...rowProps} />
          ))}
        </section>
      ) : null}

      <AddCard me={me} />
    </div>
  );
}

type RowProps = { card: MeetingCard; me: string; steward: boolean; canMessage: Set<string> };

function Tags({ card, children }: { card: MeetingCard; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg">{roomById(card.room).name}</span>
      {card.kind === "candidate" ? <span className="rounded-sm border border-signal px-2 py-1 text-signal">Candidate card</span> : null}
      {card.kind === "trade" ? <span className="rounded-sm border border-line px-2 py-1 text-muted">Trade</span> : null}
      {children}
    </div>
  );
}

function MessageHost({ card, me, canMessage }: Pick<RowProps, "card" | "me" | "canMessage">) {
  const openDm = useBoard((state) => state.openDm);
  if (!card.host || card.host === me) return null;
  if (canMessage.has(card.host)) {
    return (
      <button type="button" className={btnQuiet} onClick={() => openDm(card.host)}>
        <MessageSquare className="size-4" aria-hidden="true" />
        Message {card.host}
      </button>
    );
  }
  return card.firstTimer ? <span className="self-center text-xs text-muted">Go once and mark it to message the host.</span> : null;
}

function TradeRow({ card, witnesses, ...rest }: RowProps & { witnesses: string[] }) {
  const removeCard = useBoard((state) => state.removeCard);
  const shown = witnesses.length >= 2;
  return (
    <article className={cn("rounded-lg border border-line bg-surface p-4", !shown && "opacity-80")}>
      <Tags card={card} />
      <h3 className="mt-2 text-xl text-fg">{card.name}</h3>
      <p className="text-sm text-muted">{cardSummary(card)}</p>
      <p className="mt-1 text-sm text-muted">
        {witnesses.length === 0 ? "No member has named this work yet." : `Named by ${witnesses.join(", ")}${shown ? "" : " · one more lists it"}`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <MessageHost card={card} {...rest} />
        {rest.steward ? (
          <button type="button" className={btnQuiet} aria-label={`Remove ${card.name}`} onClick={() => removeCard(card.id)}>
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function MeetingRow({ card, shown, ...rest }: RowProps & { shown: boolean }) {
  const posts = useBoard((state) => state.posts);
  const visited = useBoard((state) => state.visited);
  const updateCard = useBoard((state) => state.updateCard);
  const closeCard = useBoard((state) => state.closeCard);
  const removeCard = useBoard((state) => state.removeCard);
  const [closing, setClosing] = useState(false);
  const [nextDate, setNextDate] = useState(card.next || todayIso());
  const [line, setLine] = useState("");
  const room = roomById(card.room);
  const isHost = card.host === rest.me;
  const canPin = cardCanPin(card, posts);

  return (
    <article className={cn("rounded-lg border border-line bg-surface p-4", !shown && "opacity-80")}>
      <Tags card={card}>
        {card.unverified ? <span className="text-muted">to be visited</span> : null}
        {card.pinned ? <span className="text-signal">pinned</span> : null}
        {card.firstTimer ? <span className="text-signal">takes a first-timer</span> : null}
      </Tags>
      <h3 className="mt-2 text-xl text-fg">{card.name}</h3>
      <p className="text-sm text-muted">{cardSummary(card)}</p>
      <p className="mt-1 text-sm text-muted">
        {card.next ? `Next ${formatDate(card.next)}` : room.requiresNextDate ? "No next date. Not listed." : "No next date yet."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted" aria-label="Last four meetings">
        <span>Last four:</span>
        {card.lastFour.length === 0 ? <span>none logged</span> : null}
        {card.lastFour.map((went, index) => (
          <span key={index} className={cn("size-3 rounded-sm", went ? "bg-signal" : "border border-line")} title={went ? "happened" : "missed"} />
        ))}
        <span>· went: {card.wentBy.join(", ") || "nobody yet"}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnGhost} onClick={() => visited(card.id)} disabled={card.wentBy.includes(rest.me)}>
          {card.wentBy.includes(rest.me) ? "You went" : "I went"}
        </button>
        <MessageHost card={card} {...rest} />
        {(isHost || rest.steward) && shown ? (
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
        {isHost ? (
          <button type="button" className={btnQuiet} onClick={() => updateCard(card.id, { firstTimer: !card.firstTimer })}>
            {card.firstTimer ? "Stop taking first-timers" : "Take a first-timer"}
          </button>
        ) : null}
        {isHost ? (
          closing ? (
            <form
              className="flex w-full flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const happened = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "yes";
                closeCard(card.id, happened, nextDate, line);
                setClosing(false);
                setLine("");
              }}
            >
              <input className={fieldClass} placeholder="How it went, in a line" value={line} onChange={(event) => setLine(event.target.value)} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <input type="date" className={cn(fieldClass, "sm:max-w-xs")} value={nextDate} onChange={(event) => setNextDate(event.target.value)} aria-label="Next date" />
                <button type="submit" value="yes" className={btnSignal}>
                  It happened
                </button>
                <button type="submit" value="no" className={btnGhost}>
                  It did not
                </button>
                <button type="button" className={btnQuiet} onClick={() => setClosing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className={btnQuiet} onClick={() => setClosing(true)}>
              After the hour
            </button>
          )
        ) : null}
        {rest.steward ? (
          <button type="button" className={btnQuiet} aria-label={`Remove ${card.name}`} onClick={() => removeCard(card.id)}>
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function AddCard({ me }: { me: string }) {
  const addCard = useBoard((state) => state.addCard);
  const [room, setRoom] = useState<RoomId>("skills");
  const [kind, setKind] = useState<CardKind>("meeting");
  const [fields, setFields] = useState({ name: "", place: "", time: "", host: "", next: "", firstTimer: false });
  const kinds = roomById(room).cardKinds;
  const trade = kind === "trade";
  const labels = CARD_LABELS[trade ? "trade" : "meeting"];
  const set = (patch: Partial<typeof fields>) => setFields({ ...fields, ...patch });

  const pickRoom = (id: RoomId) => {
    setRoom(id);
    if (!roomById(id).cardKinds.includes(kind)) setKind("meeting");
  };
  const submit = () => {
    addCard({ room, kind, ...fields, host: fields.host || me, next: trade ? "" : fields.next, firstTimer: !trade && fields.firstTimer });
    setFields({ name: "", place: "", time: "", host: "", next: "", firstTimer: false });
  };

  const text = (key: "name" | "place" | "time" | "host", placeholder?: string) => (
    <label className="flex flex-col gap-2 text-sm text-muted">
      {labels[key]}
      <input className={fieldClass} placeholder={placeholder} value={fields[key]} onChange={(event) => set({ [key]: event.target.value })} />
    </label>
  );

  return (
    <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">List a card</h2>
      <p className="mt-1 text-sm text-muted">
        You count as the first visit. It lists after a second person marks "I went." A trade lists after two members name its work.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-muted">
          Room
          <select className={fieldClass} value={room} onChange={(event) => pickRoom(event.target.value as RoomId)}>
            {ROOMS.filter((item) => item.cardKinds.length > 0).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Kind
          <select className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value as CardKind)}>
            {kinds.map((item) => (
              <option key={item} value={item}>
                {item === "meeting" ? roomById(room).cardNoun : item === "candidate" ? "Candidate card (labeled)" : "Trade (a business)"}
              </option>
            ))}
          </select>
        </label>
        {text("name")}
        {text("place")}
        {text("time", trade ? "Electrical, residential" : "First Monday 7:30 p.m.")}
        {text("host", me)}
        {trade ? null : (
          <>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Next date{roomById(room).requiresNextDate ? " (required here)" : ""}
              <input type="date" className={fieldClass} value={fields.next} onChange={(event) => set({ next: event.target.value })} />
            </label>
            <label className="flex items-center gap-3 self-end text-sm text-muted">
              <input type="checkbox" className="size-5" checked={fields.firstTimer} onChange={(event) => set({ firstTimer: event.target.checked })} />
              Takes a first-timer
            </label>
          </>
        )}
      </div>
      <button type="button" className={cn(btnSignal, "mt-4")} onClick={submit}>
        {trade ? "Save, waiting on witnesses" : "Save, not yet listed"}
      </button>
    </section>
  );
}
