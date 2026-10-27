import { memo, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { AttachPicture, SharedMediaFigure } from "@/components/board/media-share";
import { RoomCall } from "@/components/board/room-call";
import { ModerationQueue } from "@/components/board/moderation-queue";
import { ReportControl } from "@/components/board/report-control";
import { RoomChat } from "@/components/board/room-chat";
import {
  Check as CheckIcon,
  CornerDownRight,
  Flag,
  MessageSquare,
  Pin,
  Trash2,
  X,
} from "lucide-react";
import {
  btnGhost,
  btnQuiet,
  btnSignal,
  fieldClass,
  Kicker,
  pill,
  When,
} from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  MARK_LABEL,
  POST_TYPES,
  RULE_LABEL,
  RULE_SENTENCE,
  authorName,
  activeBan,
  blankDraft,
  cardSummary,
  composerCheck,
  composerErrorId,
  composerSubmitsOnEnter,
  draftHasWriting,
  formatDate,
  formatWhen,
  needsFor,
  postButtonLabel,
  readingLine,
  repliesByParent,
  roomById,
  shelfFor,
  sortRoom,
  stoodWith,
  todayIso,
  typeMeta,
  typesFor,
  witnessesByTrade,
  type Check,
  type ComposerField,
  type Draft,
  type HardRule,
  type Mark,
  type MeetingCard,
  type Post,
} from "@/lib/board/model";
import { CouncilBar } from "@/components/board/council-bar";
import { sendReport } from "@/lib/board/report-api";
import { useBoard } from "@/lib/board/store";
import { QuotePassage } from "@/components/board/quote-card";
import { NeedCard } from "@/components/board/week-view";
import { cancelFreshPost, expectFreshPost, takeFreshPost } from "@/lib/board/ink";
import { RoomAudienceEditor, RoomAudienceMark, RoomHoldPlate } from "@/components/board/audience";
import { getArmedRoom, subscribeArmedRoom } from "@/lib/board/motion";

const MARKS: Mark[] = ["unsupported", "out_of_scope", "sloppy"];
const RULES = Object.keys(RULE_LABEL) as HardRule[];

export function RoomView() {
  const room = useBoard((state) => state.room);
  const armedRoom = useSyncExternalStore(subscribeArmedRoom, getArmedRoom, () => null);
  const setRoom = useBoard((state) => state.setRoom);
  const posts = useBoard((state) => state.posts);
  const cards = useBoard((state) => state.cards);
  const removals = useBoard((state) => state.removals);
  const bans = useBoard((state) => state.bans);
  const appeals = useBoard((state) => state.appeals);
  const rooms = useBoard((state) => state.rooms);
  const remote = useBoard((state) => state.remote);
  const older = useBoard(
    (state) => state.roomPages.find((page) => page.room === room)?.next ?? null,
  );
  const loadOlder = useBoard((state) => state.loadOlder);
  const me = useBoard((state) => authorName(state.me));
  const steward = useBoard((state) => state.steward);
  const meta = roomById(room, rooms);
  const today = todayIso();

  const feed = useMemo(() => sortRoom(posts, room), [posts, room]);
  const replies = useMemo(() => repliesByParent(posts), [posts]);
  const peers = useMemo(() => stoodWith(me, cards, posts), [me, cards, posts]);
  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const shelf = useMemo(
    () => shelfFor(room, cards, witnessesByTrade(posts, cards), today),
    [room, cards, posts, today],
  );
  const needs = useMemo(
    () => (meta.parish ? needsFor(cards, room) : []),
    [cards, room, meta.parish],
  );
  const setRoomAudience = useBoard((state) => state.setRoomAudience);
  const roomHold = useBoard((state) => state.roomHold);
  const dismissRoomHold = useBoard((state) => state.dismissRoomHold);
  const held = roomHold && roomHold.roomId === room ? roomHold : null;
  const known = rooms.find((item) => item.id === room);
  const ban = activeBan(me, removals, Date.now(), bans, appeals);
  const canFile = typesFor(meta, steward).length > 0;
  const [tools, setTools] = useState(false);

  const shelfBlock = (
    <>
      {shelf.map((card) => (
        <article key={card.id} className="card rounded-lg border border-signal bg-surface p-4">
          <Kicker className="flex items-center gap-2">
            <Pin className="size-3" aria-hidden="true" />
            {card.kind === "candidate"
              ? "Candidate event"
              : meta.cardNoun === "Debate"
                ? "This month's question"
                : meta.cardNoun === "Reading"
                  ? "This month's book"
                  : "Coming up"}
            {card.pinned ? " · pinned by the host" : ""}
          </Kicker>
          <h2 className="mt-2 text-2xl text-fg">{card.name}</h2>
          <p className="text-sm text-muted">
            {cardSummary(card)}
            {card.next ? ` · ${formatDate(card.next)}` : ""}
            {card.firstTimer ? " · new people welcome" : ""}
          </p>
          {card.book ? <p className="mt-1 text-sm text-fg">{readingLine(card)}</p> : null}
          {card.going.length > 0 ? (
            <p className="mt-1 text-sm text-muted">Going: {card.going.join(", ")}</p>
          ) : null}
        </article>
      ))}

      {needs.map((card) => (
        <NeedCard key={card.id} card={card} />
      ))}
    </>
  );

  if (held) {
    const title = known?.name ?? "This room";
    const audience = held.code === "missing" ? undefined : (known?.audience ?? held.audience);
    return (
      <div className="flex flex-col gap-6">
        <section className="plate flex flex-col gap-2">
          {held.code === "missing" ? null : (
            <>
              <Kicker>Room</Kicker>
              <h1 className="illum font-display text-4xl text-balance text-fg lg:text-5xl">{title}</h1>
              <RoomAudienceMark audience={audience} />
            </>
          )}
          <RoomHoldPlate code={held.code} onDismiss={dismissRoomHold} />
        </section>
        <nav className="relative z-10 flex flex-wrap gap-2 pb-1" aria-label="Rooms">
          {rooms.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={item.id === room ? "page" : undefined}
              onClick={() => setRoom(item.id)}
              className={pill(item.id === room)}
            >
              {item.name}
              {item.audience === "men" || item.audience === "women" ? (
                <RoomAudienceMark audience={item.audience} />
              ) : null}
            </button>
          ))}
        </nav>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="plate plate--hero flex flex-col gap-2">
        <Kicker>{meta.cardNoun === "Service" ? "Church" : "Room"}</Kicker>
        <h1
          className="illum font-display text-4xl text-balance text-fg lg:text-5xl"
          style={armedRoom === room ? { viewTransitionName: `card-${room}` } : undefined}
        >
          {meta.name}
        </h1>
        <RoomAudienceMark audience={meta.audience} />
        <p className="max-w-prose text-base text-muted">{meta.what}</p>
        {meta.host ? (
          <RoomAudienceEditor
            key={`${meta.id}-${meta.audience ?? "all"}`}
            audience={meta.audience === "men" || meta.audience === "women" ? meta.audience : "all"}
            onSave={(audience) => setRoomAudience(meta.id, audience)}
          />
        ) : null}
        <RoomCall roomId={room} />
        <RoomChat roomId={room} />
        <ModerationQueue roomId={room} />
      </section>

      <nav
        className="relative z-10 flex flex-wrap gap-2 pb-1"
        aria-label="Rooms"
      >
        {rooms.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={item.id === room ? "page" : undefined}
            onClick={() => setRoom(item.id)}
            className={pill(item.id === room)}
          >
            {item.name}
            {item.audience === "men" || item.audience === "women" ? (
              <RoomAudienceMark audience={item.audience} />
            ) : null}
          </button>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:gap-12">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 lg:hidden">{shelfBlock}</div>

          {ban ? (
            <p className="rounded-md border border-line bg-surface p-4 text-sm text-muted">
              {ban.reason === "csam"
                ? "This account is closed."
                : ban.strikes >= 2
                  ? "This account is closed. Second hard removal."
                  : `Filing is off until ${new Date(ban.until).toLocaleDateString()}. Reason on record: ${RULE_LABEL[ban.reason]}.`}
            </p>
          ) : canFile ? (
            <Composer me={me} steward={steward} />
          ) : (
            <p className="text-sm text-muted">Only stewards post in this room.</p>
          )}

          {steward && feed.length > 0 ? (
            <label className="inline-flex min-h-[44px] items-center gap-2 self-end text-[0.8125rem] text-muted">
              <input
                type="checkbox"
                className="size-5"
                checked={tools}
                onChange={(event) => setTools(event.target.checked)}
              />
              Show steward tools on posts
            </label>
          ) : null}
          <section className="flex flex-col divide-y divide-line">
            {feed.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                replies={replies.get(post.id) ?? []}
                card={post.cardId ? cardById.get(post.cardId) : undefined}
                trade={post.tradeId ? cardById.get(post.tradeId) : undefined}
                mine={post.author === me}
                canMessage={peers.has(post.author)}
                steward={steward && tools}
              />
            ))}
            {remote && older ? (
              <button
                type="button"
                className="py-6 text-left text-sm text-signal underline"
                onClick={() => void loadOlder(room)}
              >
                Older posts
              </button>
            ) : (
              <p className="py-6 text-sm text-muted" role="status">
                {feed.length === 0 ? "Nothing posted here yet." : "That is everything."}
              </p>
            )}
          </section>
        </div>

        <aside className="hidden flex-col gap-4 lg:sticky lg:top-28 lg:flex lg:self-start">
          {shelf.length === 0 && needs.length === 0 ? (
            <p className="text-sm text-muted">Nothing coming up in this room inside two weeks.</p>
          ) : (
            shelfBlock
          )}
          <MarkLog />
          <AppealLog />
        </aside>
      </div>
      <div className="lg:hidden">
        <MarkLog />
        <AppealLog />
      </div>
    </div>
  );
}

function FieldError({ id, messages }: { id: string; messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <p id={id} className="text-sm text-danger">
      {messages.join(" ")}
    </p>
  );
}

function describedBy(field: ComposerField, messages: string[]): string | undefined {
  return messages.length > 0 ? composerErrorId(field) : undefined;
}

function CardSelect({
  label,
  cards,
  empty,
  value,
  onChange,
  errorId,
  error,
}: {
  label: string;
  cards: MeetingCard[];
  empty?: string;
  value: string;
  onChange: (id: string) => void;
  errorId: string;
  error: string[];
}) {
  return (
    <label className="flex flex-col gap-2 text-sm text-muted">
      {label}
      <select
        className={cn(fieldClass, "min-h-[44px]")}
        value={value}
        aria-invalid={error.length > 0 ? true : undefined}
        aria-describedby={error.length > 0 ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {cards.map((card) => (
          <option key={card.id} value={card.id}>
            {card.name}
          </option>
        ))}
      </select>
      <FieldError id={errorId} messages={error} />
    </label>
  );
}

function Composer({ me, steward }: { me: string; steward: boolean }) {
  const room = useBoard((state) => state.room);
  const posts = useBoard((state) => state.posts);
  const cards = useBoard((state) => state.cards);
  const removals = useBoard((state) => state.removals);
  const bans = useBoard((state) => state.bans);
  const rooms = useBoard((state) => state.rooms);
  const file = useBoard((state) => state.file);
  const remote = useBoard((state) => state.remote);
  const [draft, setDraft] = useState(() => blankDraft(room));
  const [result, setResult] = useState<Check | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const meta = roomById(room, rooms);
  const current = draft.room === room ? draft : blankDraft(room);
  const type = current.type ? typeMeta(current.type) : null;
  const allowed = typesFor(meta, steward);

  const roomCards = useMemo(
    () =>
      cards.filter(
        (card) => card.room === room && (card.kind === "meeting" || card.kind === "candidate"),
      ),
    [cards, room],
  );
  const ownCards = useMemo(() => roomCards.filter((card) => card.host === me), [roomCards, me]);
  const trades = useMemo(
    () => cards.filter((card) => card.kind === "trade" && card.room === room && card.host !== me),
    [cards, room, me],
  );
  const closing =
    current.type === "hosted" ? ownCards.find((card) => card.id === current.cardId) : undefined;
  const check = useMemo(
    () =>
      composerCheck(current, {
        author: me,
        steward,
        posts,
        cards,
        removals,
        bans,
        rooms,
        now: Date.now(),
      }),
    [current, me, steward, posts, cards, removals, bans, rooms],
  );

  const subjectChoices: { value: Draft["subject"]; label: string }[] = [
    { value: "", label: "No subject" },
  ];
  if (meta.cardKinds.includes("candidate")) {
    subjectChoices.push({ value: "candidate", label: "Candidate" });
  }
  if (meta.cardKinds.includes("trade")) {
    subjectChoices.push({ value: "business", label: "Business" });
  }
  const patch = (next: Partial<Draft>) => {
    setDraft({ ...current, ...next });
    setResult(null);
  };
  const reset = () => {
    pendingRef.current = false;
    setPending(false);
    setDraft(blankDraft(room));
    setResult(null);
    setAttempted(false);
    setConfirmClear(false);
  };
  const send = () => {
    if (pendingRef.current) return;
    setAttempted(true);
    if (!check.ok) {
      setResult(null);
      return;
    }
    pendingRef.current = true;
    setPending(true);
    const before = new Set(useBoard.getState().posts.map((post) => post.id));
    expectFreshPost();
    void file(current)
      .then((outcome) => {
        if (outcome.ok) {
          const fresh = useBoard.getState().posts.find((post) => !before.has(post.id));
          if (!fresh) cancelFreshPost();
          reset();
        } else {
          cancelFreshPost();
          setResult(outcome);
        }
      })
      .finally(() => {
        pendingRef.current = false;
        setPending(false);
      });
  };
  const askClear = () => {
    if (draftHasWriting(current)) setConfirmClear(true);
    else reset();
  };
  const visible = result && !result.ok ? result : attempted && !check.ok ? check : null;
  const messages = (field: ComposerField) => visible?.fields?.[field] ?? [];
  const formMessages = [
    ...messages("form"),
    ...(result && !result.ok && !result.fields ? result.stops : []),
  ];
  const onClaimKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      composerSubmitsOnEnter(
        event.key,
        { meta: event.metaKey, ctrl: event.ctrlKey, shift: event.shiftKey },
        true,
      )
    ) {
      event.preventDefault();
      send();
    }
  };
  const toggleCame = (name: string) => {
    const came = current.came.includes(name)
      ? current.came.filter((n) => n !== name)
      : [...current.came, name];
    patch({ came, named: came.includes(current.named) ? current.named : "" });
  };

  const latestError = visible?.stops.at(-1);
  const typeErrors = messages("type");
  const claimErrors = messages("claim");
  const reasonErrors = messages("reason");
  const dateErrors = messages("on");
  const nextErrors = messages("next");
  const cardErrors = messages("card");
  const tradeErrors = messages("trade");
  const namedErrors = messages("named");
  const pageErrors = messages("pages");
  const attestErrors = messages("attest");

  return (
    <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <form
        className="flex flex-col gap-3"
        aria-describedby={describedBy("form", formMessages)}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <p className="text-sm font-semibold text-fg">Post something</p>
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label="Kind of post"
          aria-invalid={typeErrors.length > 0 ? true : undefined}
          aria-describedby={describedBy("type", typeErrors)}
        >
          {POST_TYPES.filter((item) => allowed.includes(item.id)).map((item) => {
            const noCard = item.cardPick === "own" && ownCards.length === 0;
            const active = current.type === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={noCard}
                onClick={() =>
                  patch({
                    type: item.id,
                    cardId: item.cardPick === "own" ? ownCards[0].id : "",
                    came: [],
                    named: "",
                  })
                }
                className={cn(
                  "flex min-h-[44px] flex-col items-start gap-1 rounded-md border px-3 py-2 text-left disabled:opacity-50",
                  active ? "border-signal bg-raised" : "border-line bg-bg",
                )}
              >
                <span className="text-sm font-semibold text-fg">{item.label}</span>
                <span className="text-xs text-muted">
                  {noCard ? "For hosts. You do not host a meeting in this room." : item.what}
                </span>
              </button>
            );
          })}
        </div>
        <FieldError id={composerErrorId("type")} messages={typeErrors} />

        {type ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{type.what}</p>
            {type.cardPick === "own" ? (
              <CardSelect
                label="The card this closes"
                cards={ownCards}
                value={current.cardId}
                errorId={composerErrorId("card")}
                error={cardErrors}
                onChange={(cardId) => patch({ cardId, came: [], named: "" })}
              />
            ) : null}
            {type.cardPick === "optional" && roomCards.length > 0 ? (
              <CardSelect
                label="Card, if any"
                cards={roomCards}
                empty="No card"
                value={current.cardId}
                errorId={composerErrorId("card")}
                error={cardErrors}
                onChange={(cardId) => patch({ cardId })}
              />
            ) : null}
            {type.tradePick && trades.length > 0 ? (
              <CardSelect
                label="Who did the work"
                cards={trades}
                empty="No one"
                value={current.tradeId}
                errorId={composerErrorId("trade")}
                error={tradeErrors}
                onChange={(tradeId) => patch({ tradeId })}
              />
            ) : null}
            {remote && subjectChoices.length > 1 ? (
              <fieldset className="flex flex-col gap-2 text-sm text-muted">
                <legend>Subject, if the council may label this</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Subject">
                  {subjectChoices.map((choice) => (
                    <label
                      key={choice.value || "none"}
                      className={pill(current.subject === choice.value, "cursor-pointer")}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name="subject"
                        checked={current.subject === choice.value}
                        onChange={() => patch({ subject: choice.value })}
                      />
                      {choice.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <label className="flex flex-col gap-2 text-sm text-muted">
              {type.claimLabel}
              <textarea
                className={cn(fieldClass, "min-h-24")}
                value={current.claim}
                aria-invalid={claimErrors.length > 0 ? true : undefined}
                aria-describedby={describedBy("claim", claimErrors)}
                onChange={(event) => patch({ claim: event.target.value })}
                onKeyDown={onClaimKeyDown}
              />
              <FieldError id={composerErrorId("claim")} messages={claimErrors} />
            </label>
            {type.reasonLabel ? (
              <label className="flex flex-col gap-2 text-sm text-muted">
                {type.reasonLabel}
                <input
                  className={fieldClass}
                  value={current.reason}
                  aria-invalid={reasonErrors.length > 0 ? true : undefined}
                  aria-describedby={describedBy("reason", reasonErrors)}
                  onChange={(event) => patch({ reason: event.target.value })}
                />
                <FieldError id={composerErrorId("reason")} messages={reasonErrors} />
              </label>
            ) : null}
            {type.dateLabel ? (
              <label className="flex flex-col gap-2 text-sm text-muted">
                {type.dateLabel}
                <input
                  type="date"
                  className={cn(fieldClass, "max-w-xs")}
                  value={current.on}
                  aria-invalid={dateErrors.length > 0 ? true : undefined}
                  aria-describedby={describedBy("on", dateErrors)}
                  onChange={(event) => patch({ on: event.target.value })}
                />
                <FieldError id={composerErrorId("on")} messages={dateErrors} />
              </label>
            ) : null}
            {type.closes ? (
              <>
                <fieldset className="flex flex-col gap-2 text-sm text-muted">
                  <legend>Roll call. Who came, from those who said they would.</legend>
                  {closing && closing.going.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {closing.going.map((name) => (
                        <label
                          key={name}
                          className={pill(current.came.includes(name), "cursor-pointer")}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={current.came.includes(name)}
                            onChange={() => toggleCame(name)}
                          />
                          {name}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <span>Nobody said they would come. Say how it went and set the next date.</span>
                  )}
                </fieldset>
                {current.came.length > 0 ? (
                  <label className="flex flex-col gap-2 text-sm text-muted">
                    Name one person, if someone earned it
                    <select
                      className={cn(fieldClass, "min-h-[44px] max-w-xs")}
                      value={current.named}
                      aria-invalid={namedErrors.length > 0 ? true : undefined}
                      aria-describedby={describedBy("named", namedErrors)}
                      onChange={(event) => patch({ named: event.target.value })}
                    >
                      <option value="">No one this time</option>
                      {current.came.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <FieldError id={composerErrorId("named")} messages={namedErrors} />
                  </label>
                ) : null}
                <label className="flex flex-col gap-2 text-sm text-muted">
                  Next date, if there is one
                  <input
                    type="date"
                    className={cn(fieldClass, "max-w-xs")}
                    value={current.next}
                    aria-invalid={nextErrors.length > 0 ? true : undefined}
                    aria-describedby={describedBy("next", nextErrors)}
                    onChange={(event) => patch({ next: event.target.value })}
                  />
                  <FieldError id={composerErrorId("next")} messages={nextErrors} />
                </label>
                {closing?.book ? (
                  <label className="flex flex-col gap-2 text-sm text-muted">
                    What to have read by then ({closing.book})
                    <input
                      className={fieldClass}
                      placeholder="chapters 5 and 6"
                      value={current.pages}
                      aria-invalid={pageErrors.length > 0 ? true : undefined}
                      aria-describedby={describedBy("pages", pageErrors)}
                      onChange={(event) => patch({ pages: event.target.value })}
                    />
                    <FieldError id={composerErrorId("pages")} messages={pageErrors} />
                  </label>
                ) : null}
              </>
            ) : null}
            {type.attest ? (
              <div className="flex flex-col gap-2">
                <label className="flex min-h-[44px] items-center gap-3 text-sm text-muted">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={current.attested}
                    aria-invalid={attestErrors.length > 0 ? true : undefined}
                    aria-describedby={describedBy("attest", attestErrors)}
                    onChange={(event) => patch({ attested: event.target.checked })}
                  />
                  No child's face. No home address. No private person named who was not acting in
                  public.
                </label>
                <FieldError id={composerErrorId("attest")} messages={attestErrors} />
              </div>
            ) : null}
            <AttachPicture
              roomId={room}
              postId={current.postId}
              media={current.media}
              onAttached={({ postId, media }) => patch({ postId, media: [media] })}
              onClear={() => patch({ media: [], postId: "" })}
            />
            <FieldError id={composerErrorId("form")} messages={formMessages} />
            {latestError ? (
              <p role="alert" className="sr-only">
                {latestError}
              </p>
            ) : null}
            {check.notes.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm text-muted">
                {check.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className={cn(btnSignal, "min-h-[44px]")}
                disabled={pending}
                aria-disabled={pending ? true : undefined}
              >
                {pending ? "Posting…" : postButtonLabel(type.id)}
              </button>
              <button
                type="button"
                className={cn(btnQuiet, "ml-auto min-h-[44px]")}
                onClick={askClear}
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}
      </form>
      <ConfirmDialog
        open={confirmClear}
        title="Clear this draft?"
        description="What you wrote will be erased."
        confirmLabel="Clear it"
        cancelLabel="Keep it"
        onConfirm={() => {
          setConfirmClear(false);
          reset();
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </section>
  );
}

function Name({ name }: { name: string }) {
  const view = useBoard((state) => state.view);
  return (
    <button
      type="button"
      className="inline-flex min-h-[44px] items-center font-semibold text-fg hover:underline"
      onClick={() => view(name)}
    >
      {name}
    </button>
  );
}

const PostCard = memo(function PostCard({
  post,
  replies,
  card,
  trade,
  mine,
  canMessage,
  steward,
}: {
  post: Post;
  replies: Post[];
  card?: MeetingCard;
  trade?: MeetingCard;
  mine: boolean;
  canMessage: boolean;
  steward: boolean;
}) {
  const remote = useBoard((state) => state.remote);
  const reply = useBoard((state) => state.reply);
  const revise = useBoard((state) => state.revise);
  const closeAsked = useBoard((state) => state.closeAsked);
  const mark = useBoard((state) => state.mark);
  const remove = useBoard((state) => state.remove);
  const appeal = useBoard((state) => state.appeal);
  const appeals = useBoard((state) => state.appeals);
  const openDm = useBoard((state) => state.openDm);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [claim, setClaim] = useState(post.claim);
  const [reason, setReason] = useState(post.reason);
  const [removing, setRemoving] = useState(false);
  const [markDraft, setMarkDraft] = useState<{
    mark: Mark | null;
    reason: string;
    error: string;
  } | null>(null);
  const [removeError, setRemoveError] = useState("");
  const [appealDraft, setAppealDraft] = useState("");
  const [appealError, setAppealError] = useState("");
  const [appealing, setAppealing] = useState(false);
  const appealOpen = appeals.some(
    (row) => row.postId === post.id && row.kind === "mark" && row.decision === null,
  );
  const type = typeMeta(post.type);
  const [settle] = useState(takeFreshPost);

  return (
    <article className={cn("card py-5 first:pt-0", post.mark && "opacity-60", settle && "post-new")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg">{type.label}</span>
        <span className="text-muted">
          <Name name={post.author} /> ·{" "}
          {post.on ? formatDate(post.on) : <When at={post.at} format={formatWhen} />}
        </span>
        {card ? <span className="text-signal">· {card.name}</span> : null}
        {trade ? <span className="text-muted">· work by {trade.name}</span> : null}
        {type.closable && post.closed ? <span className="text-muted">· answered</span> : null}
        {post.mark ? (
          <span className="rounded-sm border border-line px-2 py-1 text-muted">
            {MARK_LABEL[post.mark]}
          </span>
        ) : null}
        {post.council ? (
          <span className="rounded-sm border border-signal px-2 py-1 text-signal">
            {post.council.label}
          </span>
        ) : null}
      </div>
      <CouncilBar post={post} />

      {editing ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            className={cn(fieldClass, "min-h-20")}
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
          />
          {type.reasonLabel ? (
            <input
              className={fieldClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className={btnSignal}
              onClick={() => {
                if (!claim.trim() || (type.reasonLabel && !reason.trim())) return;
                revise(post.id, { claim, reason });
                setEditing(false);
              }}
            >
              Save revision
            </button>
            <button type="button" className={btnQuiet} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <QuotePassage claim={post.claim} reason={post.reason} author={post.author} />
          {post.reason ? <p className="mt-1 text-sm text-muted">{post.reason}</p> : null}
          {(post.media ?? []).map((item) => (
            <SharedMediaFigure key={item.id} item={item} />
          ))}
          {type.closes ? (
            <p className="mt-1 text-sm text-muted">
              {post.came.length > 0 ? `There: ${post.came.join(", ")}. ` : ""}
              {post.named ? <span className="text-signal">Mentioned: {post.named}. </span> : null}
              {post.next ? `Next time: ${formatDate(post.next)}.` : "No next date set."}
            </p>
          ) : null}
        </>
      )}

      {replies.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2 border-l border-line pl-3">
          {replies.map((item) => (
            <li key={item.id} className="text-sm">
              <span className="text-muted">
                <Name name={item.author} /> ·{" "}
              </span>
              <span className="text-fg">{item.claim}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {replying ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <input
              className={fieldClass}
              placeholder="A reply with a reason"
              value={replyText}
              onChange={(event) => setReplyText(event.target.value)}
            />
            <button
              type="button"
              className={btnSignal}
              onClick={() => {
                reply(post.id, replyText);
                setReplyText("");
                setReplying(false);
              }}
            >
              Reply
            </button>
            <button
              type="button"
              className={btnQuiet}
              onClick={() => setReplying(false)}
              aria-label="Cancel reply"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button type="button" className={cn(btnQuiet, "px-0")} onClick={() => setReplying(true)}>
            <CornerDownRight className="size-4" aria-hidden="true" />
            Reply
          </button>
        )}
        {canMessage ? (
          <button
            type="button"
            className={cn(btnQuiet, "px-0")}
            onClick={() => openDm(post.author)}
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            Message {post.author}
          </button>
        ) : null}
        {mine && type.closable && !post.closed ? (
          <button
            type="button"
            className={cn(btnQuiet, "px-0")}
            onClick={() => closeAsked(post.id)}
          >
            <CheckIcon className="size-4" aria-hidden="true" />
            Answered
          </button>
        ) : null}
        {!mine ? (
          <ReportControl
            label="Report this post"
            onSubmit={(input) => {
              if (!remote) return Promise.resolve({ ok: false, error: "Sign in to report this." });
              return sendReport({
                roomId: post.room,
                subjectKind: "post",
                subjectId: post.id,
                reason: input.reason,
                note: input.note,
              });
            }}
          />
        ) : null}
        {mine && post.mark ? (
          <button type="button" className={cn(btnQuiet, "px-0")} onClick={() => setEditing(true)}>
            Revise
          </button>
        ) : null}
        {mine && post.mark && !appealOpen ? (
          <button type="button" className={cn(btnQuiet, "px-0")} onClick={() => setAppealing(true)}>
            Appeal this mark
          </button>
        ) : null}
        {mine && post.mark && appealOpen ? (
          <span className="self-center text-sm text-muted">Appeal filed with the stewards.</span>
        ) : null}
      </div>

      {steward ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex flex-wrap gap-2">
            <span className="self-center text-[0.8125rem] tracking-widest text-muted uppercase">
              Steward
            </span>
            {MARKS.map((item) => (
              <button
                key={item}
                type="button"
                className={btnQuiet}
                onClick={() =>
                  setMarkDraft({ mark: post.mark === item ? null : item, reason: "", error: "" })
                }
              >
                <Flag className="size-4" aria-hidden="true" />
                {post.mark === item ? `Clear ${MARK_LABEL[item].toLowerCase()}` : MARK_LABEL[item]}
              </button>
            ))}
            {removing ? (
              <>
                {RULES.map((rule) => (
                  <button
                    key={rule}
                    type="button"
                    className={btnGhost}
                    onClick={() => {
                      void remove(post.id, rule).then((result) => {
                        if (!result.ok)
                          setRemoveError(result.error ?? "That post was not removed.");
                      });
                    }}
                  >
                    Remove: {RULE_LABEL[rule]}
                  </button>
                ))}
                <button type="button" className={btnQuiet} onClick={() => setRemoving(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className={btnQuiet} onClick={() => setRemoving(true)}>
                <Trash2 className="size-4" aria-hidden="true" />
                Remove post
              </button>
            )}
          </div>
          {markDraft ? (
            <label className="flex flex-col gap-2 text-sm text-muted">
              One sentence, why
              <input
                className={fieldClass}
                value={markDraft.reason}
                placeholder="The notice does not say where that came from."
                onChange={(event) =>
                  setMarkDraft({ ...markDraft, reason: event.target.value, error: "" })
                }
              />
              {markDraft.error ? (
                <span className="text-danger" role="alert">
                  {markDraft.error}
                </span>
              ) : null}
              <span className="flex gap-2">
                <button
                  type="button"
                  className={btnSignal}
                  onClick={() => {
                    void mark(post.id, markDraft.mark, markDraft.reason).then((result) => {
                      if (!result.ok)
                        setMarkDraft({
                          ...markDraft,
                          error: result.error ?? "That mark was not saved.",
                        });
                      else setMarkDraft(null);
                    });
                  }}
                >
                  Save mark
                </button>
                <button type="button" className={btnQuiet} onClick={() => setMarkDraft(null)}>
                  Cancel
                </button>
              </span>
            </label>
          ) : null}
          {removeError ? (
            <p className="text-sm text-danger" role="alert">
              {removeError}
            </p>
          ) : null}
          {appealing ? (
            <label className="flex flex-col gap-2 text-sm text-muted">
              One sentence to the stewards
              <input
                className={fieldClass}
                value={appealDraft}
                placeholder="The mark names the side, not the missing reason."
                onChange={(event) => {
                  setAppealDraft(event.target.value);
                  setAppealError("");
                }}
              />
              {appealError ? (
                <span className="text-danger" role="alert">
                  {appealError}
                </span>
              ) : null}
              <span className="flex gap-2">
                <button
                  type="button"
                  className={btnSignal}
                  onClick={() => {
                    void appeal(post.id, "mark", appealDraft).then((result) => {
                      if (!result.ok) setAppealError(result.error ?? "That appeal was not filed.");
                      else {
                        setAppealing(false);
                        setAppealDraft("");
                      }
                    });
                  }}
                >
                  File appeal
                </button>
                <button type="button" className={btnQuiet} onClick={() => setAppealing(false)}>
                  Cancel
                </button>
              </span>
            </label>
          ) : null}
          {removing ? (
            <p className="text-sm text-muted">
              Removing a post bars the account. The reason stays in the log. A mark never hides a
              post. {RULE_SENTENCE.doxxing} {RULE_SENTENCE.blasphemy}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
});

function AppealLog() {
  const room = useBoard((state) => state.room);
  const appeals = useBoard((state) => state.appeals);
  const decideAppeal = useBoard((state) => state.decideAppeal);
  const steward = useBoard((state) => state.steward);
  const me = useBoard((state) => authorName(state.me));
  const rows = appeals.filter((row) => row.room === room).slice(0, 20);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">
        Appeals in this room
      </h2>
      <ul className="flex flex-col gap-3 text-sm text-muted">
        {rows.map((row) => (
          <li key={row.id}>
            <p>
              {row.author} appealed a {row.kind}
              {row.rule ? ` (${RULE_LABEL[row.rule]})` : ""}: {row.reason} ·{" "}
              <When at={row.at} format={formatWhen} />
            </p>
            {row.decision ? (
              <p>
                {row.decidedBy} {row.decision === "lift" ? "lifted" : "upheld"} it
                {row.decisionNote ? `: ${row.decisionNote}` : ""}
                {row.decidedAt ? (
                  <>
                    {" "}
                    · <When at={row.decidedAt} format={formatWhen} />
                  </>
                ) : null}
              </p>
            ) : steward && row.author !== me ? (
              openId === row.id ? (
                <label className="mt-2 flex flex-col gap-2">
                  One sentence
                  <input
                    className={fieldClass}
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value);
                      setError("");
                    }}
                  />
                  {error ? (
                    <span className="text-danger" role="alert">
                      {error}
                    </span>
                  ) : null}
                  <span className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btnSignal}
                      onClick={() => {
                        void decideAppeal(row.id, "uphold", note).then((result) => {
                          if (!result.ok) setError(result.error ?? "That decision was not saved.");
                          else setOpenId(null);
                        });
                      }}
                    >
                      Uphold
                    </button>
                    {row.rule === "csam" ? (
                      <span>This removal stays.</span>
                    ) : (
                      <button
                        type="button"
                        className={btnQuiet}
                        onClick={() => {
                          void decideAppeal(row.id, "lift", note).then((result) => {
                            if (!result.ok)
                              setError(result.error ?? "That decision was not saved.");
                            else setOpenId(null);
                          });
                        }}
                      >
                        Lift
                      </button>
                    )}
                    <button type="button" className={btnQuiet} onClick={() => setOpenId(null)}>
                      Cancel
                    </button>
                  </span>
                </label>
              ) : (
                <button
                  type="button"
                  className={cn(btnQuiet, "px-0")}
                  onClick={() => {
                    setOpenId(row.id);
                    setNote("");
                    setError("");
                  }}
                >
                  Decide
                </button>
              )
            ) : (
              <p>Waiting on the stewards.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MarkLog() {
  const room = useBoard((state) => state.room);
  const markLog = useBoard((state) => state.markLog);
  const rows = markLog.filter((row) => row.room === room).slice(0, 20);
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">
        Steward marks in this room
      </h2>
      <ul className="flex flex-col gap-1 text-sm text-muted">
        {rows.map((row) => (
          <li key={row.id}>
            {row.by}{" "}
            {row.mark
              ? `marked ${row.author}'s post ${MARK_LABEL[row.mark]}`
              : `cleared a mark on ${row.author}'s post`}
            {row.reason ? `: ${row.reason}` : ""} · <When at={row.at} format={formatWhen} />
          </li>
        ))}
      </ul>
    </section>
  );
}
