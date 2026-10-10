import { memo, useMemo, useState } from "react";
import { Check as CheckIcon, CornerDownRight, Flag, MessageSquare, Pin, Trash2, X } from "lucide-react";
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker, pill, When } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  MARK_LABEL,
  POST_TYPES,
  ROOMS,
  RULE_LABEL,
  authorName,
  banFor,
  blankDraft,
  cardSummary,
  composerCheck,
  formatDate,
  formatWhen,
  needsFor,
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
  type Draft,
  type HardRule,
  type Mark,
  type MeetingCard,
  type Post,
} from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { NeedCard } from "@/components/board/week-view";

const MARKS: Mark[] = ["unsupported", "sloppy"];
const RULES = Object.keys(RULE_LABEL) as HardRule[];

export function RoomView() {
  const room = useBoard((state) => state.room);
  const setRoom = useBoard((state) => state.setRoom);
  const posts = useBoard((state) => state.posts);
  const cards = useBoard((state) => state.cards);
  const removals = useBoard((state) => state.removals);
  const me = useBoard((state) => authorName(state.me));
  const steward = useBoard((state) => state.steward);
  const meta = roomById(room);
  const today = todayIso();

  const feed = useMemo(() => sortRoom(posts, room), [posts, room]);
  const replies = useMemo(() => repliesByParent(posts), [posts]);
  const peers = useMemo(() => stoodWith(me, cards, posts), [me, cards, posts]);
  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const shelf = useMemo(() => shelfFor(room, cards, witnessesByTrade(posts, cards), today), [room, cards, posts, today]);
  const needs = useMemo(() => (meta.parish ? needsFor(cards, room) : []), [cards, room, meta.parish]);
  const ban = banFor(me, removals, Date.now());
  const canFile = typesFor(meta, steward).length > 0;

  const shelfBlock = (
    <>
      {shelf.map((card) => (
        <article key={card.id} className="rounded-lg border border-signal bg-surface p-4">
          <Kicker className="flex items-center gap-2">
            <Pin className="size-3" aria-hidden="true" />
            {card.kind === "candidate" ? "Candidate event" : "Coming up"}
            {card.pinned ? " · pinned by the host" : ""}
          </Kicker>
          <h2 className="mt-2 text-2xl text-fg">{card.name}</h2>
          <p className="text-sm text-muted">
            {cardSummary(card)}
            {card.next ? ` · ${formatDate(card.next)}` : ""}
            {card.firstTimer ? " · new people welcome" : ""}
          </p>
          {card.book ? <p className="mt-1 text-sm text-fg">{readingLine(card)}</p> : null}
          {card.going.length > 0 ? <p className="mt-1 text-sm text-muted">Going: {card.going.join(", ")}</p> : null}
        </article>
      ))}

      {needs.map((card) => (
        <NeedCard key={card.id} card={card} />
      ))}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible" aria-label="Rooms">
        {ROOMS.map((item) => (
          <button key={item.id} type="button" aria-current={item.id === room ? "page" : undefined} onClick={() => setRoom(item.id)} className={pill(item.id === room)}>
            {item.name}
          </button>
        ))}
      </nav>

      <section className="flex flex-col gap-2">
        <Kicker>{meta.cardNoun === "Service" ? "Parish" : "Room"}</Kicker>
        <h1 className="font-display text-4xl text-balance text-fg lg:text-5xl">{meta.name}</h1>
        <p className="max-w-prose text-base text-muted">{meta.what}</p>
        <p className="max-w-prose text-sm text-muted">
          {canFile ? "What is coming up is at the top. Below that, post what you did or ask a question. Nothing refreshes on its own; when you reach the bottom, you are done." : "Only stewards post here."}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:gap-12">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 lg:hidden">{shelfBlock}</div>

          {ban ? (
            <p className="rounded-md border border-line bg-surface p-4 text-sm text-muted">
              {ban.strikes >= 2 ? "This account is closed. Second hard removal." : `Filing is off until ${new Date(ban.until).toLocaleDateString()}. Reason on record: ${RULE_LABEL[ban.reason]}.`}
            </p>
          ) : canFile ? (
            <Composer me={me} steward={steward} />
          ) : (
            <p className="text-sm text-muted">Only stewards post in this room.</p>
          )}

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
            steward={steward}
          />
        ))}
            <p className="py-6 text-sm text-muted">{feed.length === 0 ? "Nothing posted here yet." : "That is everything."}</p>
          </section>
        </div>

        <aside className="hidden flex-col gap-4 lg:sticky lg:top-28 lg:flex lg:self-start">
          {shelf.length === 0 && needs.length === 0 ? <p className="text-sm text-muted">Nothing coming up in this room inside two weeks.</p> : shelfBlock}
          <MarkLog />
        </aside>
      </div>
      <div className="lg:hidden">
        <MarkLog />
      </div>
    </div>
  );
}

function CardSelect({ label, cards, empty, value, onChange }: { label: string; cards: MeetingCard[]; empty?: string; value: string; onChange: (id: string) => void }) {
  return (
    <label className="flex flex-col gap-2 text-sm text-muted">
      {label}
      <select className={cn(fieldClass, "min-h-11")} value={value} onChange={(event) => onChange(event.target.value)}>
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {cards.map((card) => (
          <option key={card.id} value={card.id}>
            {card.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Composer({ me, steward }: { me: string; steward: boolean }) {
  const room = useBoard((state) => state.room);
  const posts = useBoard((state) => state.posts);
  const cards = useBoard((state) => state.cards);
  const removals = useBoard((state) => state.removals);
  const file = useBoard((state) => state.file);
  const [draft, setDraft] = useState(() => blankDraft(room));
  const [result, setResult] = useState<Check | null>(null);
  const meta = roomById(room);
  const current = draft.room === room ? draft : blankDraft(room);
  const type = current.type ? typeMeta(current.type) : null;
  const allowed = typesFor(meta, steward);

  const roomCards = useMemo(() => cards.filter((card) => card.room === room && (card.kind === "meeting" || card.kind === "candidate")), [cards, room]);
  const ownCards = useMemo(() => roomCards.filter((card) => card.host === me), [roomCards, me]);
  const trades = useMemo(() => cards.filter((card) => card.kind === "trade" && card.room === room && card.host !== me), [cards, room, me]);
  const closing = current.type === "hosted" ? ownCards.find((card) => card.id === current.cardId) : undefined;
  const check = useMemo(() => composerCheck(current, { author: me, steward, posts, cards, removals, now: Date.now() }), [current, me, steward, posts, cards, removals]);

  const patch = (next: Partial<Draft>) => setDraft({ ...current, ...next });
  const reset = () => {
    setDraft(blankDraft(room));
    setResult(null);
  };
  const send = () => {
    const outcome = file(current);
    if (outcome.ok) reset();
    else setResult(outcome);
  };
  const toggleCame = (name: string) => {
    const came = current.came.includes(name) ? current.came.filter((n) => n !== name) : [...current.came, name];
    patch({ came, named: came.includes(current.named) ? current.named : "" });
  };

  return (
    <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <p className="text-sm text-muted">What kind of post is this?</p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Post type">
        {POST_TYPES.filter((item) => allowed.includes(item.id)).map((item) => {
          const noCard = item.cardPick === "own" && ownCards.length === 0;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={current.type === item.id}
              title={noCard ? "You host no card in this room." : item.what}
              disabled={noCard}
              onClick={() => patch({ type: item.id, cardId: item.cardPick === "own" ? ownCards[0].id : "", came: [], named: "" })}
              className={pill(current.type === item.id, "px-4")}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {type ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-muted">{type.what}</p>
          {type.cardPick === "own" ? <CardSelect label="The card this closes" cards={ownCards} value={current.cardId} onChange={(cardId) => patch({ cardId, came: [], named: "" })} /> : null}
          {type.cardPick === "optional" && roomCards.length > 0 ? <CardSelect label="Card, if any" cards={roomCards} empty="No card" value={current.cardId} onChange={(cardId) => patch({ cardId })} /> : null}
          {type.tradePick && trades.length > 0 ? <CardSelect label="Who did the work" cards={trades} empty="No one" value={current.tradeId} onChange={(tradeId) => patch({ tradeId })} /> : null}
          <label className="flex flex-col gap-2 text-sm text-muted">
            {type.claimLabel}
            <textarea className={cn(fieldClass, "min-h-24")} value={current.claim} onChange={(event) => patch({ claim: event.target.value })} />
          </label>
          {type.reasonLabel ? (
            <label className="flex flex-col gap-2 text-sm text-muted">
              {type.reasonLabel}
              <input className={fieldClass} value={current.reason} onChange={(event) => patch({ reason: event.target.value })} />
            </label>
          ) : null}
          {type.dateLabel ? (
            <label className="flex flex-col gap-2 text-sm text-muted">
              {type.dateLabel}
              <input type="date" className={cn(fieldClass, "max-w-xs")} value={current.on} onChange={(event) => patch({ on: event.target.value })} />
            </label>
          ) : null}
          {type.closes ? (
            <>
              <fieldset className="flex flex-col gap-2 text-sm text-muted">
                <legend>Roll call. Who came, from those who said they would.</legend>
                {closing && closing.going.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {closing.going.map((name) => (
                      <label key={name} className={pill(current.came.includes(name), "cursor-pointer")}>
                        <input type="checkbox" className="sr-only" checked={current.came.includes(name)} onChange={() => toggleCame(name)} />
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
                  <select className={cn(fieldClass, "min-h-11 max-w-xs")} value={current.named} onChange={(event) => patch({ named: event.target.value })}>
                    <option value="">No one this time</option>
                    {current.came.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="flex flex-col gap-2 text-sm text-muted">
                Next date, if there is one
                <input type="date" className={cn(fieldClass, "max-w-xs")} value={current.next} onChange={(event) => patch({ next: event.target.value })} />
              </label>
              {closing?.book ? (
                <label className="flex flex-col gap-2 text-sm text-muted">
                  What to have read by then ({closing.book})
                  <input className={fieldClass} placeholder="chapters 5 and 6" value={current.pages} onChange={(event) => patch({ pages: event.target.value })} />
                </label>
              ) : null}
            </>
          ) : null}
          {type.attest ? (
            <label className="flex items-start gap-3 text-sm text-muted">
              <input type="checkbox" className="mt-1 size-5" checked={current.attested} onChange={(event) => patch({ attested: event.target.checked })} />
              No child's face. No home address. No private person named who was not acting in public.
            </label>
          ) : null}
          {result && !result.ok ? (
            <ul className="flex flex-col gap-1 text-sm text-signal">
              {result.stops.map((stop) => (
                <li key={stop}>{stop}</li>
              ))}
            </ul>
          ) : null}
          {check.notes.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm text-muted">
              {check.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <button type="button" className={btnSignal} onClick={send}>
              File {type.label}
            </button>
            <button type="button" className={btnQuiet} onClick={reset}>
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Name({ name }: { name: string }) {
  const view = useBoard((state) => state.view);
  return (
    <button type="button" className="font-semibold text-fg hover:underline" onClick={() => view(name)}>
      {name}
    </button>
  );
}

const PostCard = memo(function PostCard({ post, replies, card, trade, mine, canMessage, steward }: { post: Post; replies: Post[]; card?: MeetingCard; trade?: MeetingCard; mine: boolean; canMessage: boolean; steward: boolean }) {
  const reply = useBoard((state) => state.reply);
  const revise = useBoard((state) => state.revise);
  const closeAsked = useBoard((state) => state.closeAsked);
  const mark = useBoard((state) => state.mark);
  const remove = useBoard((state) => state.remove);
  const openDm = useBoard((state) => state.openDm);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [claim, setClaim] = useState(post.claim);
  const [reason, setReason] = useState(post.reason);
  const [removing, setRemoving] = useState(false);
  const type = typeMeta(post.type);

  return (
    <article className={cn("py-5 first:pt-0", post.mark === "sloppy" && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg">{type.label}</span>
        <span className="text-muted">
          <Name name={post.author} /> · {post.on ? formatDate(post.on) : <When at={post.at} format={formatWhen} />}
        </span>
        {card ? <span className="text-signal">· {card.name}</span> : null}
        {trade ? <span className="text-muted">· work by {trade.name}</span> : null}
        {type.closable && post.closed ? <span className="text-muted">· answered</span> : null}
        {post.mark ? <span className="rounded-sm border border-line px-2 py-1 text-muted">{MARK_LABEL[post.mark]}</span> : null}
      </div>

      {editing ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea className={cn(fieldClass, "min-h-20")} value={claim} onChange={(e) => setClaim(e.target.value)} />
          {type.reasonLabel ? <input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
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
          <p className="mt-2 max-w-prose text-base text-fg">{post.claim}</p>
          {post.reason ? <p className="mt-1 text-sm text-muted">{post.reason}</p> : null}
          {type.closes ? (
            <p className="mt-1 text-sm text-muted">
              {post.came.length > 0 ? `Came: ${post.came.join(", ")}. ` : ""}
              {post.named ? (
                <span className="text-signal">Named: {post.named}. </span>
              ) : null}
              {post.next ? `Next ${formatDate(post.next)}.` : "No next date."}
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
            <input className={fieldClass} placeholder="A reply with a reason" value={replyText} onChange={(event) => setReplyText(event.target.value)} />
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
            <button type="button" className={btnQuiet} onClick={() => setReplying(false)} aria-label="Cancel reply">
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
          <button type="button" className={cn(btnQuiet, "px-0")} onClick={() => openDm(post.author)}>
            <MessageSquare className="size-4" aria-hidden="true" />
            Message {post.author}
          </button>
        ) : null}
        {mine && type.closable && !post.closed ? (
          <button type="button" className={cn(btnQuiet, "px-0")} onClick={() => closeAsked(post.id)}>
            <CheckIcon className="size-4" aria-hidden="true" />
            Answered
          </button>
        ) : null}
        {mine && post.mark ? (
          <button type="button" className={cn(btnQuiet, "px-0")} onClick={() => setEditing(true)}>
            Revise
          </button>
        ) : null}
      </div>

      {steward ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          <span className="self-center text-xs tracking-widest text-muted uppercase">Steward</span>
          {MARKS.map((item) => (
            <button key={item} type="button" className={btnQuiet} onClick={() => mark(post.id, post.mark === item ? null : item)}>
              <Flag className="size-4" aria-hidden="true" />
              {post.mark === item ? `Clear ${MARK_LABEL[item].toLowerCase()}` : MARK_LABEL[item]}
            </button>
          ))}
          {removing ? (
            <>
              {RULES.map((rule) => (
                <button key={rule} type="button" className={btnGhost} onClick={() => remove(post.id, rule)}>
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
      ) : null}
    </article>
  );
});

function MarkLog() {
  const room = useBoard((state) => state.room);
  const markLog = useBoard((state) => state.markLog);
  const rows = markLog.filter((row) => row.room === room).slice(0, 20);
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">Steward marks in this room</h2>
      <ul className="flex flex-col gap-1 text-sm text-muted">
        {rows.map((row) => (
          <li key={row.id}>
            {row.by} {row.mark ? `marked ${row.author}'s post ${row.mark}` : `cleared a mark on ${row.author}'s post`} · <When at={row.at} format={formatWhen} />
          </li>
        ))}
      </ul>
    </section>
  );
}
