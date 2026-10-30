import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { Copy, Check as CheckIcon, MessageSquare, Pin, PinOff, Trash2 } from "lucide-react";
import {
  btnGhost,
  btnQuiet,
  btnSignal,
  copyStatus,
  fieldClass,
  Kicker,
  useCopy,
} from "@/components/quorum/bits";
import { GatheringShareControl } from "@/components/board/gathering-share";
import { RsvpControl } from "@/components/board/rsvp-control";
import { cn } from "@/lib/cn";
import {
  CARD_LABELS,
  WEEKDAYS,
  authorName,
  cardCanPin,
  cardListed,
  cardSummary,
  formatDate,
  hostsClear,
  readingLine,
  roomById,
  stoodWith,
  todayIso,
  witnessesByTrade,
  type CardKind,
  type MeetingCard,
  type RoomId,
  forViewer,
  seesGoing,
  takesRoll,
} from "@/lib/board/model";
import { rollCallFor, rollKey, toggleRoll } from "@/lib/board/rsvp-api";
import { userFacingError } from "@/lib/board/errors";
import { useBoard } from "@/lib/board/store";
import { scrollRestoredCard } from "@/lib/board/scroll-card";
import { OWNER_THEME, themeById, themeVars } from "@/lib/board/themes";
import { NeedCard } from "@/components/board/week-view";

export function FindView() {
  const boardCards = useBoard((state) => state.cards);
  const viewerAdmin = useBoard((state) => state.admin);
  const viewerName = useBoard((state) => authorName(state.me));
  const viewerHosts = useBoard((state) => state.rsvpHosts);
  const viewerRooms = useBoard((state) => state.stewardRooms);
  const cards = useMemo(
    () => boardCards.map((card) => forViewer(card, {
          admin: viewerAdmin,
          name: viewerName,
          hosts: viewerHosts,
          stewardRooms: viewerRooms,
        })),
    [boardCards, viewerAdmin, viewerName, viewerHosts, viewerRooms],
  );
  const posts = useBoard((state) => state.posts);
  const scrollCardId = useBoard((state) => state.scrollCardId);
  const me = useBoard((state) => authorName(state.me));
  const steward = useBoard((state) => state.steward);

  const witnesses = useMemo(() => witnessesByTrade(posts, cards), [posts, cards]);
  const peers = useMemo(() => stoodWith(me, cards, posts), [me, cards, posts]);
  const clear = useMemo(() => hostsClear(posts), [posts]);
  const groups = useMemo(() => {
    const out = {
      listed: [] as MeetingCard[],
      waiting: [] as MeetingCard[],
      trades: [] as MeetingCard[],
      needs: [] as MeetingCard[],
    };
    for (const card of cards) {
      if (card.kind === "trade") out.trades.push(card);
      else if (card.kind === "need") out.needs.push(card);
      else if (cardListed(card, witnesses)) out.listed.push(card);
      else out.waiting.push(card);
    }
    out.listed.sort(
      (a, b) => (a.next || "9999").localeCompare(b.next || "9999") || a.name.localeCompare(b.name),
    );
    out.trades.sort((a, b) => Number(cardListed(b, witnesses)) - Number(cardListed(a, witnesses)));
    return out;
  }, [cards, witnesses]);

  const removal = useUndoCardRemoval();
  const rowProps = { me, steward, peers, clear, onRemove: removal.remove };
  useEffect(() => {
    if (!scrollCardId) return;
    if (!scrollRestoredCard(scrollCardId)) return;
    useBoard.setState({ scrollCardId: null });
  }, [scrollCardId, cards]);

  return (
    <div className="grid gap-8 pb-[calc(var(--tabbar-h,64px)+env(safe-area-inset-bottom)+9rem)] lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] lg:gap-12">
      <RemovalToast removal={removal} />
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <Kicker>Find</Kicker>
          <h1 className="illum max-w-xl font-display text-4xl text-balance text-fg lg:text-5xl">
            Every meeting, in one list.
          </h1>
          <p className="max-w-prose text-base text-muted">
            Every meeting, church service, vouched-for business, and family that needs meals. Press{" "}
            <strong className="font-semibold text-fg">I'll be there</strong> for next time. The host
            records who came. A meeting drops off after it is missed twice. If you host something,
            this is where you write it up afterwards. Invite codes are made under More, on About.
          </p>
        </section>

        <section className="grid gap-3 xl:grid-cols-2">
          {groups.listed.length === 0 ? (
            <p className="text-sm text-muted" role="status">
              No card has been visited twice yet.
            </p>
          ) : null}
          {groups.listed.map((card) => (
            <MeetingRow key={card.id} card={card} shown {...rowProps} />
          ))}
        </section>

        {groups.needs.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-2xl text-fg">A parish needs</h2>
            {groups.needs.map((card) => (
              <NeedCard key={card.id} card={card} />
            ))}
          </section>
        ) : null}

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
            <h2 className="text-2xl text-fg">Businesses and tradesmen</h2>
            <p className="text-sm text-muted">
              A business is listed once two members post that it did work for them.
            </p>
            {groups.trades.map((card) => (
              <TradeRow
                key={card.id}
                card={card}
                witnesses={witnesses.get(card.id) ?? []}
                {...rowProps}
              />
            ))}
          </section>
        ) : null}
      </div>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <AddCard me={me} />
      </aside>
    </div>
  );
}

type RowProps = {
  card: MeetingCard;
  me: string;
  steward: boolean;
  peers: Set<string>;
  clear: Map<string, boolean>;
  onRemove: (card: MeetingCard) => void;
};

function useUndoCardRemoval() {
  const removeCard = useBoard((state) => state.removeCard);
  const undoQueue = useBoard((state) => state.undoQueue);
  const removed = undoQueue[undoQueue.length - 1] ?? null;
  return {
    removed,
    async remove(card: MeetingCard) {
      await removeCard(card.id);
    },
    undo() {
      if (!removed) return;
      useBoard.getState().undoRemoveCard(removed.id);
    },
  };
}

const TOAST_CLASS =
  "board-toast fixed inset-x-0 bottom-[calc(var(--tabbar-h,64px)+env(safe-area-inset-bottom)+0.75rem)] z-40 mx-auto flex w-[min(36rem,calc(100%-2rem))] flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface px-4 py-2 shadow-lg md:bottom-6 lg:bottom-6";

function RemovalToast({ removal }: { removal: ReturnType<typeof useUndoCardRemoval> }) {
  const boardError = useBoard((state) => state.boardError);
  const appeals = useBoard((state) => state.appeals);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost(document.body);
  }, []);
  const errorText = boardError
    ? userFacingError(boardError, "That did not go through. Please try again in a moment.")
    : "";
  const showError = errorText.length > 0;
  if (!host || (!showError && !removal.removed)) return null;
  if (showError) {
    return createPortal(
      <div
        className={cn(TOAST_CLASS, "border-danger text-danger")}
        role="alert"
        style={themeVars(themeById(OWNER_THEME))}
      >
        <p className="text-sm">{errorText}</p>
        <button
          type="button"
          className={cn(btnGhost, "min-h-[44px]")}
          onClick={() => useBoard.setState({ boardError: "", failedRemovalNames: [] })}
        >
          Dismiss
        </button>
        {boardError === "This account is barred from the board." && appeals.length > 0 ? (
          <ul className="mt-1 w-full text-muted">
            {appeals.map((row) => (
              <li key={row.id}>
                Your {row.kind} appeal is{" "}
                {row.decision === "lift" ? "lifted" : row.decision === "uphold" ? "upheld" : "open"}
                .
              </li>
            ))}
          </ul>
        ) : null}
      </div>,
      host,
    );
  }
  return createPortal(
    <div
      className={cn(TOAST_CLASS, "border-line text-muted")}
      role="status"
      style={themeVars(themeById(OWNER_THEME))}
    >
      <p className="text-sm">Removed {removal.removed.name}.</p>
      <button type="button" className={cn(btnGhost, "min-h-[44px]")} onClick={removal.undo}>
        Undo
      </button>
    </div>,
    host,
  );
}

function Tags({ card, children }: { card: MeetingCard; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg">
        {roomById(card.room).name}
      </span>
      {card.kind === "candidate" ? (
        <span className="rounded-sm border border-signal px-2 py-1 text-signal">
          Candidate event
        </span>
      ) : null}
      {card.kind === "trade" ? (
        <span className="rounded-sm border border-line px-2 py-1 text-muted">Trade</span>
      ) : null}
      {children}
    </div>
  );
}

function MessageHost({ card, me, peers }: Pick<RowProps, "card" | "me" | "peers">) {
  const openDm = useBoard((state) => state.openDm);
  if (!card.host || card.host === me) return null;
  if (peers.has(card.host)) {
    return (
      <button type="button" className={btnQuiet} onClick={() => openDm(card.host)}>
        <MessageSquare className="size-4" aria-hidden="true" />
        Message {card.host}
      </button>
    );
  }
  return card.firstTimer ? (
    <span className="self-center text-[13px] text-muted">
      After you have been once, you can message the host.
    </span>
  ) : null;
}

function TradeRow({ card, witnesses, ...rest }: RowProps & { witnesses: string[] }) {
  const shown = witnesses.length >= 2;
  return (
    <article
      id={`card-${card.id}`}
      className={cn("card rounded-lg border border-line bg-surface p-4", !shown && "opacity-80")}
    >
      <Tags card={card} />
      <h3 className="mt-2 text-xl text-fg">{card.name}</h3>
      <p className="text-sm text-muted">{cardSummary(card)}</p>
      <p className="mt-1 text-sm text-muted">
        {witnesses.length === 0
          ? "Nobody has vouched for this business yet."
          : `Vouched for by ${witnesses.join(", ")}${shown ? "" : " · one more and it is listed"}`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <MessageHost card={card} {...rest} />
        {rest.steward ? (
          <button
            type="button"
            className={btnQuiet}
            aria-label={`Remove ${card.name}`}
            onClick={() => rest.onRemove(card)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** A host's one-use code for one card. Shown once; the host hands it over however they like. */
/**
 * Invite codes come from the server, under About ("Make a code"). This used to
 * mint a code in the browser only, which the signup door rejected.
 */
function InviteNote() {
  const setSection = useBoard((state) => state.setSection);
  return (
    <span className="text-sm text-muted">
      To invite someone,{" "}
      <Link
        to="/"
        hash="invite"
        className="text-signal underline"
        onClick={() => setSection("about")}
      >
        make a code on the About page
      </Link>
      .
    </span>
  );
}

function MeetingRow({ card, shown, ...rest }: RowProps & { shown: boolean }) {
  const visited = useBoard((state) => state.visited);
  const rsvp = useBoard((state) => state.rsvp);
  const updateCard = useBoard((state) => state.updateCard);
  const closeCard = useBoard((state) => state.closeCard);
  const [closing, setClosing] = useState(false);
  const [nextDate, setNextDate] = useState(card.next || todayIso());
  const [line, setLine] = useState("");
  const [came, setCame] = useState<string[]>([]);
  const [cameKeys, setCameKeys] = useState<string[]>([]);
  const [cameIds, setCameIds] = useState<string[]>([]);
  const rollCall = useBoard((state) => state.rollCall);
  const roll = rollCallFor(card, rollCall);
  const [pages, setPages] = useState("");
  const [refused, setRefused] = useState<string[]>([]);
  const room = roomById(card.room);
  const isHost = card.host === rest.me;
  const canPin = cardCanPin(card, rest.clear);
  const went = card.wentBy.includes(rest.me);
  const going = card.going.includes(rest.me);

  return (
    <article
      id={`card-${card.id}`}
      className={cn("card rounded-lg border border-line bg-surface p-4", !shown && "opacity-80")}
    >
      <Tags card={card}>
        {card.unverified ? <span className="text-muted">not yet visited</span> : null}
        {card.pinned ? <span className="text-signal">pinned</span> : null}
        {card.firstTimer ? <span className="text-signal">new people welcome</span> : null}
      </Tags>
      <h3 className="mt-2 text-xl text-fg">{card.name}</h3>
      <p className="text-sm text-muted">{cardSummary(card)}</p>
      {card.book ? <p className="mt-1 text-sm text-fg">{readingLine(card)}</p> : null}
      <p className="mt-1 text-sm text-muted">
        {card.next
          ? `Next ${formatDate(card.next)}`
          : room.requiresNextDate
            ? "No next date. Not listed."
            : "No next date yet."}
      </p>
      <div
        className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted"
        aria-label="Last four meetings"
      >
        <span>Last four meetings:</span>
        {card.lastFour.length === 0 ? <span>none logged</span> : null}
        {card.lastFour.map((went, index) => (
          <span
            key={index}
            className={cn("size-3 rounded-sm", went ? "bg-signal" : "border border-line")}
            title={went ? "happened" : "missed"}
          />
        ))}
        {takesRoll(card) ? <span>· has been: {card.wentBy.join(", ") || "nobody yet"}</span> : null}
        {seesGoing(card) && card.going.length > 0 ? <span>· going: {card.going.join(", ")}</span> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {!isHost && card.next ? (
          <RsvpControl card={card} going={going} onToggle={() => rsvp(card.id)} />
        ) : null}
        {takesRoll(card) ? (
          <button type="button" className={btnGhost} onClick={() => visited(card.id)} disabled={went}>
            {went ? "You've been" : "I went"}
          </button>
        ) : null}
        <MessageHost card={card} {...rest} />
        {isHost ? <InviteNote /> : null}
        {(isHost || rest.steward) && shown ? (
          <button
            type="button"
            className={btnQuiet}
            disabled={!card.pinned && !canPin}
            title={!canPin ? "The host's last note was marked. Revise it first." : undefined}
            onClick={() => updateCard(card.id, { pinned: !card.pinned })}
          >
            {card.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            {card.pinned ? "Unpin" : "Pin at the top of the room"}
          </button>
        ) : null}
        <GatheringShareControl card={card} />
        {isHost ? (
          <button
            type="button"
            className={btnQuiet}
            onClick={() => updateCard(card.id, { firstTimer: !card.firstTimer })}
          >
            {card.firstTimer ? "Stop welcoming new people" : "Welcome new people"}
          </button>
        ) : null}
        {isHost ? (
          closing ? (
            <form
              className="flex w-full flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const happened =
                  (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") !== "no";
                void closeCard(
                  card.id,
                  happened,
                  nextDate,
                  line,
                  happened ? came : [],
                  pages,
                  happened ? cameIds : [],
                ).then(
                  (check) => {
                    if (!check.ok) {
                      setRefused(check.stops);
                      return;
                    }
                    setClosing(false);
                    setLine("");
                    setCame([]);
                    setCameKeys([]);
                    setCameIds([]);
                    setPages("");
                    setRefused([]);
                  },
                );
              }}
            >
              <label className="flex flex-col gap-2 text-sm text-muted">
                How it went
                <input
                  className={cn(fieldClass, "min-h-[44px]")}
                  placeholder="One line is enough"
                  value={line}
                  onChange={(event) => setLine(event.target.value)}
                />
              </label>
              {card.book ? (
                <label className="flex flex-col gap-2 text-sm text-muted">
                  What to have read by then
                  <input
                    className={cn(fieldClass, "min-h-[44px]")}
                    placeholder={card.book}
                    value={pages}
                    onChange={(event) => setPages(event.target.value)}
                  />
                </label>
              ) : null}
              {refused.length > 0 ? (
                <ul className="flex flex-col gap-1 text-sm text-danger" role="alert">
                  {refused.map((stop) => (
                    <li key={stop}>{stop}</li>
                  ))}
                </ul>
              ) : null}
              {takesRoll(card) && roll.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>Who came:</span>
                  {roll.map((person) => (
                    <label
                      key={rollKey(person)}
                      className={cn(
                        "inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-line px-3",
                        cameKeys.includes(rollKey(person)) && "bg-signal text-signal-ink",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={cameKeys.includes(rollKey(person))}
                        onChange={() => {
                          const next = toggleRoll(roll, cameKeys, person);
                          setCameKeys(next.keys);
                          setCame(next.came);
                          setCameIds(next.cameIds);
                        }}
                      />
                      {person.name}
                    </label>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex flex-col gap-2 text-sm text-muted">
                  Next date
                  <input
                    type="date"
                    className={cn(fieldClass, "min-h-[44px] sm:max-w-xs")}
                    value={nextDate}
                    onChange={(event) => setNextDate(event.target.value)}
                  />
                </label>
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
              Write it up
            </button>
          )
        ) : null}
        {rest.steward ? (
          <button
            type="button"
            className={btnQuiet}
            aria-label={`Remove ${card.name}`}
            onClick={() => rest.onRemove(card)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </button>
        ) : null}
      </div>
    </article>
  );
}

function AddCard({ me }: { me: string }) {
  const addCard = useBoard((state) => state.addCard);
  const rooms = useBoard((state) => state.rooms);
  const [room, setRoom] = useState<RoomId>("shop");
  const [kind, setKind] = useState<CardKind>("meeting");
  const [fields, setFields] = useState({
    name: "",
    place: "",
    time: "",
    host: "",
    next: "",
    firstTimer: false,
    book: "",
    pages: "",
  });
  const [days, setDays] = useState<string[]>([]);
  const reading = room === "shelf" && kind === "meeting";
  const kinds = roomById(room).cardKinds;
  const labels = CARD_LABELS[kind === "trade" ? "trade" : kind === "need" ? "need" : "meeting"];
  const set = (patch: Partial<typeof fields>) => setFields({ ...fields, ...patch });

  const pickRoom = (id: RoomId) => {
    setRoom(id);
    if (!roomById(id).cardKinds.includes(kind)) setKind("meeting");
  };
  const submit = () => {
    addCard({
      room,
      kind,
      ...fields,
      host: fields.host || me,
      next: kind === "meeting" || kind === "candidate" ? fields.next : "",
      firstTimer: kind === "meeting" && fields.firstTimer,
      slots: kind === "need" ? days.map((day) => ({ day, by: "" })) : [],
      book: reading ? fields.book : "",
      pages: reading ? fields.pages : "",
    });
    setFields({
      name: "",
      place: "",
      time: "",
      host: "",
      next: "",
      firstTimer: false,
      book: "",
      pages: "",
    });
    setDays([]);
  };

  const text = (key: "name" | "place" | "time" | "host", placeholder?: string) => (
    <label className="flex flex-col gap-2 text-sm text-muted">
      {labels[key]}
      <input
        className={fieldClass}
        placeholder={placeholder}
        value={fields[key]}
        onChange={(event) => set({ [key]: event.target.value })}
      />
    </label>
  );

  const kindLabel = (item: CardKind) =>
    item === "meeting"
      ? roomById(room).cardNoun
      : item === "candidate"
        ? "Candidate event"
        : item === "trade"
          ? "A business or tradesman"
          : "A family that needs meals";

  return (
    <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">List a card</h2>
      <p className="mt-1 text-sm text-muted">
        You count as the first visit. It shows to the room's members as soon as you save it, so they
        can say they'll be there. A trade lists after two members name its work. A parish need is
        posted by whoever is organizing it, with the family's say-so.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-muted">
          Room
          <select
            className={cn(fieldClass, "min-h-[44px]")}
            aria-label="Room"
            value={room}
            onChange={(event) => pickRoom(event.target.value as RoomId)}
          >
            {rooms
              .filter((item) => item.cardKinds.length > 0)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Kind
          <select
            className={cn(fieldClass, "min-h-[44px]")}
            aria-label="Kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as CardKind)}
          >
            {kinds.map((item) => (
              <option key={item} value={item}>
                {kindLabel(item)}
              </option>
            ))}
          </select>
        </label>
        {text("name")}
        {text("place")}
        {text(
          "time",
          kind === "trade"
            ? "Electrical, residential"
            : kind === "need"
              ? "Dinners this week"
              : "First Monday 7:30 p.m.",
        )}
        {text("host", me)}
        {reading ? (
          <>
            <label className="flex flex-col gap-2 text-sm text-muted">
              The book, title and author
              <input
                className={fieldClass}
                placeholder="Meditations, Marcus Aurelius"
                value={fields.book}
                onChange={(event) => set({ book: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              What to have read for the first table
              <input
                className={fieldClass}
                placeholder="Book one"
                value={fields.pages}
                onChange={(event) => set({ pages: event.target.value })}
              />
            </label>
          </>
        ) : null}
        {kind === "need" ? (
          <fieldset className="flex flex-col gap-2 text-sm text-muted sm:col-span-2">
            <legend>Days</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => (
                <label
                  key={day}
                  className={cn(
                    "inline-flex min-h-[44px] cursor-pointer items-center rounded-md border border-line px-3",
                    days.includes(day) && "bg-signal text-signal-ink",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={days.includes(day)}
                    onChange={() =>
                      setDays(days.includes(day) ? days.filter((d) => d !== day) : [...days, day])
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {kind === "meeting" || kind === "candidate" ? (
          <>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Next date{roomById(room).requiresNextDate ? " (required here)" : ""}
              <input
                type="date"
                className={fieldClass}
                value={fields.next}
                onChange={(event) => set({ next: event.target.value })}
              />
            </label>
            {kind === "meeting" ? (
              <label className="flex items-center gap-3 self-end text-sm text-muted">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={fields.firstTimer}
                  onChange={(event) => set({ firstTimer: event.target.checked })}
                />
                New people welcome. Someone who has been once can message you.
              </label>
            ) : null}
          </>
        ) : null}
      </div>
      <button type="button" className={cn(btnSignal, "mt-4")} onClick={submit}>
        {kind === "trade"
          ? "Save; listed once two members vouch"
          : kind === "need"
            ? "Post it"
            : "Save; listed once a second person has been"}
      </button>
    </section>
  );
}
