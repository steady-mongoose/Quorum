import { memo, useMemo, useState } from "react";
import { Check as CheckIcon, CornerDownRight, Flag, MessageSquare, Pin, Trash2, X } from "lucide-react";
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker, pill, When, useNow } from "@/components/quorum/bits";
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
  messageable,
  repliesByParent,
  roomById,
  shelfFor,
  sortRoom,
  todayIso,
  typeMeta,
  witnessesByTrade,
  type Check,
  type Draft,
  type HardRule,
  type Mark,
  type MeetingCard,
  type Post,
} from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { useQuorum } from "@/lib/quorum/store";
import { formatWindow, officeById, telHref, windowStatus } from "@/lib/quorum/model";

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

  // One pass each; every PostCard reads from these instead of scanning posts.
  const feed = useMemo(() => sortRoom(posts, room), [posts, room]);
  const replies = useMemo(() => repliesByParent(posts), [posts]);
  const canMessage = useMemo(() => messageable(me, cards, posts), [me, cards, posts]);
  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const shelf = useMemo(
    () => shelfFor(room, cards, witnessesByTrade(posts, cards), today),
    [room, cards, posts, today],
  );
  const ban = banFor(me, removals, Date.now());

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Rooms">
        {ROOMS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={item.id === room ? "page" : undefined}
            onClick={() => setRoom(item.id)}
            className={pill(item.id === room)}
          >
            {item.name}
          </button>
        ))}
      </nav>

      <section className="flex flex-col gap-2">
        <Kicker>{meta.cardNoun === "Service" ? "Service time" : "Room"}</Kicker>
        <h1 className="font-display text-4xl text-fg">{meta.name}</h1>
        <p className="max-w-2xl text-base text-muted">{meta.what}</p>
      </section>

      {room === "civic" ? <CivicDesk /> : null}

      {shelf.map((card) => (
        <article key={card.id} className="rounded-lg border border-signal bg-surface p-4">
          <Kicker className="flex items-center gap-2">
            <Pin className="size-3" aria-hidden="true" />
            {card.kind === "candidate" ? "Candidate card" : "Coming up"}
            {card.pinned ? " · pinned until the hour" : ""}
          </Kicker>
          <h2 className="mt-2 text-2xl text-fg">{card.name}</h2>
          <p className="text-sm text-muted">
            {cardSummary(card)}
            {card.next ? ` · ${formatDate(card.next)}` : ""}
            {card.firstTimer ? " · takes a first-timer" : ""}
          </p>
        </article>
      ))}

      {ban ? (
        <p className="rounded-md border border-line bg-surface p-4 text-sm text-muted">
          {ban.strikes >= 2
            ? "This account is closed. Second hard removal."
            : `Filing is off until ${new Date(ban.until).toLocaleDateString()}. Reason on record: ${RULE_LABEL[ban.reason]}.`}
        </p>
      ) : (
        <Composer me={me} />
      )}

      <section className="flex flex-col gap-3">
        {feed.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            replies={replies.get(post.id) ?? []}
            card={post.cardId ? cardById.get(post.cardId) : undefined}
            trade={post.tradeId ? cardById.get(post.tradeId) : undefined}
            mine={post.author === me}
            canMessage={canMessage.has(post.author)}
            steward={steward}
          />
        ))}
        <p className="py-6 text-center text-sm text-muted">
          {feed.length === 0 ? "Nothing filed here yet." : "You're caught up."}
        </p>
      </section>

      <MarkLog />
    </div>
  );
}

/** Quorum campaigns show in Civic as labeled cards while their window is open. */
function CivicDesk() {
  const campaigns = useQuorum((state) => state.campaigns);
  const customOffices = useQuorum((state) => state.customOffices);
  const openDesk = useQuorum((state) => state.openDesk);
  const setSection = useBoard((state) => state.setSection);
  const now = useNow();
  if (!now) return null;
  const live = campaigns.filter(
    (campaign) => campaign.demand.trim() && windowStatus(campaign.surgeStart, campaign.surgeEnd, now).live,
  );
  return (
    <>
      {live.map((campaign) => {
        const office = officeById(campaign.officeId, customOffices);
        return (
          <article key={campaign.id} className="rounded-lg border border-signal bg-surface p-4">
            <Kicker className="flex items-center gap-2">
              <span className="live-dot size-2 rounded-full bg-signal" aria-hidden="true" />
              Call window open · {formatWindow(campaign.surgeStart, campaign.surgeEnd)}
            </Kicker>
            <h2 className="mt-2 text-2xl text-fg">{campaign.title}</h2>
            <p className="text-sm text-muted">
              {office.name}, {office.role}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className={btnSignal} href={telHref(office.dcPhone)}>
                Call {office.dcPhone}
              </a>
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  openDesk(campaign.id);
                  setSection("civic");
                }}
              >
                Open the desk
              </button>
            </div>
          </article>
        );
      })}
    </>
  );
}

function CardSelect({
  label,
  cards,
  empty,
  value,
  onChange,
}: {
  label: string;
  cards: MeetingCard[];
  empty?: string;
  value: string;
  onChange: (id: string) => void;
}) {
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

function Composer({ me }: { me: string }) {
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

  const roomCards = useMemo(() => cards.filter((card) => card.room === room && card.kind !== "trade"), [cards, room]);
  const ownCards = useMemo(() => roomCards.filter((card) => card.host === me), [roomCards, me]);
  const trades = useMemo(() => cards.filter((card) => card.kind === "trade" && card.room === room && card.host !== me), [cards, room, me]);
  const check = useMemo(
    () => composerCheck(current, { author: me, posts, cards, removals, now: Date.now() }),
    [current, me, posts, cards, removals],
  );

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

  return (
    <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <p className="text-sm text-muted">Every post picks a type or it does not send.</p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Post type">
        {POST_TYPES.filter((item) => meta.takes.includes(item.id)).map((item) => {
          const noCard = item.cardPick === "own" && ownCards.length === 0;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={current.type === item.id}
              title={noCard ? "You host no card in this room." : item.what}
              disabled={noCard}
              onClick={() => patch({ type: item.id, cardId: item.cardPick === "own" ? ownCards[0].id : "" })}
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
          {type.cardPick === "own" ? (
            <CardSelect label="The card this closes" cards={ownCards} value={current.cardId} onChange={(cardId) => patch({ cardId })} />
          ) : null}
          {type.cardPick === "optional" && roomCards.length > 0 ? (
            <CardSelect label="Card, if any" cards={roomCards} empty="No card" value={current.cardId} onChange={(cardId) => patch({ cardId })} />
          ) : null}
          {type.tradePick && trades.length > 0 ? (
            <CardSelect label="Who did the work" cards={trades} empty="No one" value={current.tradeId} onChange={(tradeId) => patch({ tradeId })} />
          ) : null}
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
          {type.next ? (
            <label className="flex flex-col gap-2 text-sm text-muted">
              Next date, if there is one
              <input type="date" className={cn(fieldClass, "max-w-xs")} value={current.next} onChange={(event) => patch({ next: event.target.value })} />
            </label>
          ) : null}
          {type.attest ? (
            <label className="flex items-start gap-3 text-sm text-muted">
              <input type="checkbox" className="mt-1 size-5" checked={current.attested} onChange={(event) => patch({ attested: event.target.checked })} />
              No child's face. No home address. No private person named who was not acting in public. A
              correction gets its own clip.
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
    <article className={cn("rounded-lg border border-line bg-surface p-4", post.mark === "sloppy" && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg">{type.label}</span>
        <span className="text-muted">
          {post.author} · {post.on ? formatDate(post.on) : <When at={post.at} format={formatWhen} />}
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
          <p className="mt-3 text-base text-fg">{post.claim}</p>
          {post.reason ? <p className="mt-1 text-sm text-muted">{post.reason}</p> : null}
          {type.next ? <p className="mt-1 text-sm text-muted">{post.next ? `Next ${formatDate(post.next)}` : "No next date"}</p> : null}
        </>
      )}

      {replies.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2 border-l border-line pl-3">
          {replies.map((item) => (
            <li key={item.id} className="text-sm">
              <span className="text-muted">{item.author} · </span>
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
              Hard remove
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
});

/** Every steward mark in this room, for every member to read. */
function MarkLog() {
  const room = useBoard((state) => state.room);
  const markLog = useBoard((state) => state.markLog);
  const rows = markLog.filter((row) => row.room === room).slice(0, 20);
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">Mark log · this room</h2>
      <ul className="flex flex-col gap-1 text-sm text-muted">
        {rows.map((row) => (
          <li key={row.id}>
            {row.by} {row.mark ? `marked ${row.author}'s post ${row.mark}` : `cleared a mark on ${row.author}'s post`} ·{" "}
            <When at={row.at} format={formatWhen} />
          </li>
        ))}
      </ul>
    </section>
  );
}
