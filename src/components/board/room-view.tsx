import { useMemo, useState } from "react";
import { Check, CornerDownRight, Flag, MessageSquare, Pin, Trash2, X } from "lucide-react";
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker, useNow } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  HARD_RULES,
  POST_TYPES,
  ROOMS,
  banFor,
  blankDraft,
  canDm,
  composerCheck,
  formatDate,
  formatWhen,
  repliesTo,
  roomById,
  sawLockedFor,
  shelfFor,
  sortRoom,
  typeMeta,
  type HardRule,
  type Post,
  type PostType,
} from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { useQuorum } from "@/lib/quorum/store";
import { formatWindow, officeById, windowStatus } from "@/lib/quorum/model";

export function RoomView() {
  const room = useBoard((state) => state.room);
  const setRoom = useBoard((state) => state.setRoom);
  const posts = useBoard((state) => state.posts);
  const cards = useBoard((state) => state.cards);
  const me = useBoard((state) => state.me);
  const bans = useBoard((state) => state.bans);
  const steward = useBoard((state) => state.steward);
  const now = useNow();
  const meta = roomById(room);
  const feed = useMemo(() => sortRoom(posts, room), [posts, room]);
  const shelf = useMemo(() => (now ? shelfFor(room, cards, posts, now) : []), [room, cards, posts, now]);
  const ban = now ? banFor(me.trim() || "You", bans, now.getTime()) : null;

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Rooms">
        {ROOMS.map((item) => {
          const active = item.id === room;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setRoom(item.id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-semibold",
                active ? "bg-signal text-signal-ink" : "border border-line bg-surface text-muted",
              )}
            >
              {item.name}
            </button>
          );
        })}
      </nav>

      <section className="flex flex-col gap-2">
        <Kicker>{meta.service ? "Service time" : "Room"}</Kicker>
        <h1 className="font-display text-4xl text-fg">{meta.name}</h1>
        <p className="max-w-2xl text-base text-muted">{meta.what}</p>
      </section>

      {room === "civic" ? <CivicDesk /> : null}

      {shelf.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label="Coming up">
          {shelf.map((card) => (
            <article key={card.id} className="rounded-lg border border-signal bg-surface p-4">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-signal uppercase">
                <Pin className="size-3" aria-hidden="true" />
                {card.kind === "candidate" ? "Candidate card" : "Coming up"}
                {card.pinned ? " · pinned until the hour" : ""}
              </p>
              <h2 className="mt-2 text-2xl text-fg">{card.name}</h2>
              <p className="text-sm text-muted">
                {card.place} · {card.time}
                {card.host ? ` · ${card.host}` : ""}
                {card.next ? ` · ${formatDate(card.next)}` : ""}
                {card.firstTimer ? " · takes a first-timer" : ""}
              </p>
            </article>
          ))}
        </section>
      ) : null}

      {ban ? (
        <p className="rounded-md border border-line bg-surface p-4 text-sm text-muted">
          {ban.strikes >= 2
            ? "This account is closed. Second hard removal."
            : `Filing is off until ${new Date(ban.until).toLocaleDateString()}. Reason on record: ${
                HARD_RULES.find((rule) => rule.id === ban.reason)?.label ?? ban.reason
              }.`}
        </p>
      ) : (
        <Composer />
      )}

      <section className="flex flex-col gap-3">
        {feed.map((post) => (
          <PostCard key={post.id} post={post} now={now?.getTime() ?? 0} steward={steward} />
        ))}
        <p className="py-6 text-center text-sm text-muted">
          {feed.length === 0 ? "Nothing filed here yet." : "You're caught up."}
        </p>
      </section>

      <MarkLog />
    </div>
  );
}

/** Quorum campaigns show in Civic as labeled cards, pinned until the window closes. */
function CivicDesk() {
  const campaigns = useQuorum((state) => state.campaigns);
  const customOffices = useQuorum((state) => state.customOffices);
  const openDesk = useQuorum((state) => state.openDesk);
  const setSection = useBoard((state) => state.setSection);
  const now = useNow();
  const live = campaigns.filter(
    (campaign) => campaign.demand.trim() && now && windowStatus(campaign.surgeStart, campaign.surgeEnd, now).live,
  );
  if (live.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {live.map((campaign) => {
        const office = officeById(campaign.officeId, customOffices);
        return (
          <article key={campaign.id} className="rounded-lg border border-signal bg-surface p-4">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-signal uppercase">
              <span className="live-dot size-2 rounded-full bg-signal" aria-hidden="true" />
              Call window open · {formatWindow(campaign.surgeStart, campaign.surgeEnd)}
            </p>
            <h2 className="mt-2 text-2xl text-fg">{campaign.title}</h2>
            <p className="text-sm text-muted">
              {office.name}, {office.role} · {office.dcPhone}
            </p>
            <button
              type="button"
              className={cn(btnGhost, "mt-3")}
              onClick={() => {
                openDesk(campaign.id);
                setSection("civic");
              }}
            >
              Open the desk
            </button>
          </article>
        );
      })}
    </div>
  );
}

function Composer() {
  const room = useBoard((state) => state.room);
  const me = useBoard((state) => state.me);
  const posts = useBoard((state) => state.posts);
  const cards = useBoard((state) => state.cards);
  const file = useBoard((state) => state.file);
  const [draft, setDraft] = useState(() => blankDraft(room));
  const [touched, setTouched] = useState(false);
  const meta = roomById(room);
  const current = draft.room === room ? draft : blankDraft(room);
  const name = me.trim() || "You";
  const sawLocked = sawLockedFor(name, posts);
  const check = composerCheck(current, sawLocked, me, cards);
  const typeMetaNow = current.type ? typeMeta(current.type) : null;
  const roomCards = cards.filter((card) => card.room === room && card.kind !== "trade");
  const hostedCards = roomCards.filter((card) => card.host === name);
  const trades = cards.filter((card) => card.kind === "trade" && card.room === room && card.host !== name);

  function patch(next: Partial<typeof current>) {
    setDraft({ ...current, ...next });
  }

  function send() {
    setTouched(true);
    if (!check.ok) return;
    file(current);
    setDraft(blankDraft(room));
    setTouched(false);
  }

  const selectClass = cn(fieldClass, "min-h-11");

  return (
    <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <p className="text-sm text-muted">Every post picks a type or it does not send.</p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Post type">
        {POST_TYPES.filter((type) => meta.takes.includes(type.id)).map((type) => {
          const active = current.type === type.id;
          const hostedButNoCard = type.id === "hosted" && hostedCards.length === 0;
          return (
            <button
              key={type.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={hostedButNoCard ? "You host no card in this room." : type.what}
              disabled={hostedButNoCard}
              onClick={() => patch({ type: type.id as PostType, cardId: type.id === "hosted" ? (hostedCards[0]?.id ?? "") : current.cardId })}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold disabled:opacity-40",
                active ? "bg-signal text-signal-ink" : "border border-line bg-raised text-muted",
              )}
            >
              {type.label}
            </button>
          );
        })}
      </div>
      {typeMetaNow ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-muted">{typeMetaNow.what}</p>

          {current.type === "hosted" ? (
            <label className="flex flex-col gap-2 text-sm text-muted">
              The card this closes
              <select className={selectClass} value={current.cardId} onChange={(event) => patch({ cardId: event.target.value })}>
                {hostedCards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.name} · {card.time}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {current.type === "did" && roomCards.length > 0 ? (
            <label className="flex flex-col gap-2 text-sm text-muted">
              About a card? (a Did that names one sorts first)
              <select className={selectClass} value={current.cardId} onChange={(event) => patch({ cardId: event.target.value })}>
                <option value="">No card</option>
                {roomCards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {current.type === "did" && trades.length > 0 ? (
            <label className="flex flex-col gap-2 text-sm text-muted">
              Who did the work? (two of these list a tradesman)
              <select className={selectClass} value={current.tradeId} onChange={(event) => patch({ tradeId: event.target.value })}>
                <option value="">Nobody I am naming</option>
                {trades.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.name} · {card.time}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-2 text-sm text-muted">
            {typeMetaNow.claimLabel}
            <textarea
              className={cn(fieldClass, "min-h-24")}
              value={current.claim}
              onChange={(event) => patch({ claim: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">
            {typeMetaNow.reasonLabel}
            <input
              className={fieldClass}
              value={current.reason}
              onChange={(event) => patch({ reason: event.target.value })}
            />
          </label>
          {typeMetaNow.needsDate ? (
            <label className="flex flex-col gap-2 text-sm text-muted">
              {current.type === "hosted" ? "The date it happened" : "Date"}
              <input
                type="date"
                className={cn(fieldClass, "max-w-xs")}
                value={current.on}
                onChange={(event) => patch({ on: event.target.value })}
              />
            </label>
          ) : null}
          {current.type === "saw" ? (
            <label className="flex items-start gap-3 text-sm text-muted">
              <input
                type="checkbox"
                className="mt-1 size-5"
                checked={current.attested}
                onChange={(event) => patch({ attested: event.target.checked })}
              />
              No child's face. No home address. No private person named who was not acting in public. A
              correction gets its own clip.
            </label>
          ) : null}
          {touched && check.stops.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm text-signal">
              {check.stops.map((stop) => (
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
              File {typeMetaNow.label}
            </button>
            <button type="button" className={btnQuiet} onClick={() => setDraft(blankDraft(room))}>
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PostCard({ post, now, steward }: { post: Post; now: number; steward: boolean }) {
  const posts = useBoard((state) => state.posts);
  const cards = useBoard((state) => state.cards);
  const me = useBoard((state) => state.me);
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
  const replies = repliesTo(posts, post.id);
  const name = me.trim() || "You";
  const mine = post.author === name;
  const meta = typeMeta(post.type);
  const card = post.cardId ? cards.find((item) => item.id === post.cardId) : undefined;
  const trade = post.tradeId ? cards.find((item) => item.id === post.tradeId) : undefined;
  const canMessage = !mine && canDm(me.trim(), post.author, cards, posts);

  return (
    <article
      className={cn(
        "rounded-lg border border-line bg-surface p-4",
        post.mark === "sloppy" && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg">{meta.label}</span>
        {post.on ? <span className="text-muted">{formatDate(post.on)}</span> : null}
        <span className="text-muted">
          {post.author} · {formatWhen(post.at, now)}
        </span>
        {card ? <span className="text-signal">· {card.name}</span> : null}
        {trade ? <span className="text-muted">· work by {trade.name}</span> : null}
        {post.type === "asked" && post.closed ? <span className="text-muted">· answered</span> : null}
        {post.mark ? (
          <span className="rounded-sm border border-line px-2 py-1 text-muted">
            {post.mark === "sloppy" ? "Sloppy" : "Unsupported"}
          </span>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea className={cn(fieldClass, "min-h-20")} value={claim} onChange={(e) => setClaim(e.target.value)} />
          <input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <button
              type="button"
              className={btnSignal}
              onClick={() => {
                if (!claim.trim() || !reason.trim()) return;
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
          {post.reason ? (
            <p className="mt-1 text-sm text-muted">
              {post.type === "hosted"
                ? /^\d{4}-\d{2}-\d{2}$/.test(post.reason)
                  ? `Next ${formatDate(post.reason)}`
                  : "No next date"
                : post.reason}
            </p>
          ) : null}
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
            <button type="button" className={btnQuiet} onClick={() => setReplying(false)}>
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
        {mine && post.type === "asked" && !post.closed ? (
          <button type="button" className={cn(btnQuiet, "px-0")} onClick={() => closeAsked(post.id)}>
            <Check className="size-4" aria-hidden="true" />
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
          <button
            type="button"
            className={btnQuiet}
            onClick={() => mark(post.id, post.mark === "unsupported" ? null : "unsupported")}
          >
            <Flag className="size-4" aria-hidden="true" />
            {post.mark === "unsupported" ? "Clear mark" : "Unsupported"}
          </button>
          <button
            type="button"
            className={btnQuiet}
            onClick={() => mark(post.id, post.mark === "sloppy" ? null : "sloppy")}
          >
            {post.mark === "sloppy" ? "Clear sloppy" : "Sloppy"}
          </button>
          {removing ? (
            <>
              {HARD_RULES.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  className={btnGhost}
                  onClick={() => remove(post.id, rule.id as HardRule)}
                >
                  Remove: {rule.label}
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
}

/**
 * Every steward mark in this room, for every member to read. The brief:
 * if stewards use the mark to bury a view, the room is over. This is how
 * the room would know.
 */
function MarkLog() {
  const room = useBoard((state) => state.room);
  const markLog = useBoard((state) => state.markLog);
  const now = useNow();
  const rows = markLog.filter((row) => row.room === room).slice(0, 20);
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">Mark log · this room</h2>
      <ul className="flex flex-col gap-1 text-sm text-muted">
        {rows.map((row) => (
          <li key={row.id}>
            {row.by} {row.mark ? `marked ${row.author}'s post ${row.mark}` : `cleared a mark on ${row.author}'s post`} ·{" "}
            {now ? formatWhen(row.at, now.getTime()) : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
