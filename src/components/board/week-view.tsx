import { useMemo } from "react";
import { btnGhost, btnSignal, Kicker, useNow } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  WEEKDAYS,
  authorName,
  cardSummary,
  formatDate,
  needsFor,
  readingLine,
  roomById,
  todayIso,
  weekFor,
  witnessesByTrade,
  type MeetingCard,
} from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { useQuorum } from "@/lib/quorum/store";
import { formatWindow, officeById, telHref, windowStatus } from "@/lib/quorum/model";

/**
 * The front door: the next seven days with something on them, this week's
 * call, and what a parish needs. Empty days are left out, and an empty week
 * says so and points at the rooms.
 */
export function WeekView() {
  const cards = useBoard((state) => state.cards);
  const posts = useBoard((state) => state.posts);
  const me = useBoard((state) => authorName(state.me));
  const setSection = useBoard((state) => state.setSection);
  const today = todayIso();
  const week = useMemo(() => weekFor(cards, witnessesByTrade(posts, cards), today), [cards, posts, today]);
  const needs = useMemo(() => needsFor(cards), [cards]);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:gap-12">
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-2">
          <Kicker>This week</Kicker>
          <h1 className="font-display text-4xl text-balance text-fg lg:text-5xl">{week.length === 0 ? "Nothing on the calendar yet." : "Where to be."}</h1>
          {week.length === 0 ? (
            <p className="max-w-2xl text-base text-muted">
              A card lands here when it has a date inside seven days.{" "}
              <button type="button" className="text-signal underline" onClick={() => setSection("rooms")}>
                Read your rooms
              </button>{" "}
              or list something under Find.
            </p>
          ) : null}
        </section>

        {week.map((day) => (
          <section key={day.iso} className="flex flex-col gap-3">
            <h2 className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
              <span className="font-display text-2xl text-fg">{day.iso === today ? "Today" : day.iso === todayIsoPlus(today, 1) ? "Tomorrow" : WEEKDAYS[new Date(day.iso + "T00:00").getDay()]}</span>
              <span className="text-xs font-semibold tracking-widest text-muted uppercase tabular-nums">{formatDate(day.iso)}</span>
            </h2>
            <div className="grid gap-3 xl:grid-cols-2">
              {day.cards.map((card) => (
                <DayCard key={card.id} card={card} me={me} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <aside className="flex flex-col gap-8 lg:sticky lg:top-28 lg:self-start">
        <TheCall />
        {needs.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">A parish needs</h2>
            {needs.map((card) => (
              <NeedCard key={card.id} card={card} />
            ))}
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function todayIsoPlus(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number);
  return todayIso(new Date(y, m - 1, d + days));
}

function DayCard({ card, me }: { card: MeetingCard; me: string }) {
  const rsvp = useBoard((state) => state.rsvp);
  const setRoom = useBoard((state) => state.setRoom);
  const going = card.going.includes(me);
  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg" onClick={() => setRoom(card.room)}>
          {roomById(card.room).name}
        </button>
        {card.kind === "candidate" ? <span className="rounded-sm border border-signal px-2 py-1 text-signal">Candidate card</span> : null}
        {card.firstTimer ? <span className="text-signal">takes a first-timer</span> : null}
      </div>
      <h3 className="mt-2 text-2xl text-fg">{card.name}</h3>
      <p className="text-sm text-muted">{cardSummary(card)}</p>
      {card.book ? <p className="mt-1 text-sm text-fg">{readingLine(card)}</p> : null}
      {card.going.length > 0 ? <p className="mt-1 text-sm text-muted">Going: {card.going.join(", ")}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {card.host !== me ? (
          <button type="button" className={going ? btnGhost : btnSignal} onClick={() => rsvp(card.id)}>
            {going ? "I'll be there · undo" : "I'll be there"}
          </button>
        ) : (
          <span className="self-center text-sm text-muted">You host this.</span>
        )}
      </div>
    </article>
  );
}

export function NeedCard({ card }: { card: MeetingCard }) {
  const takeSlot = useBoard((state) => state.takeSlot);
  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg">{roomById(card.room).name}</span>
        <span className="text-muted">organized by {card.host}</span>
      </div>
      <h3 className="mt-2 text-xl text-fg">{card.name}</h3>
      <p className="text-sm text-muted">
        {card.time} · {card.place}
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {card.slots.map((slot) => (
          <li key={slot.day}>
            {slot.by ? (
              <span className={cn(btnGhost, "cursor-default text-muted")}>
                {slot.day}: {slot.by}
              </span>
            ) : (
              <button type="button" className={btnSignal} onClick={() => takeSlot(card.id, slot.day)}>
                {slot.day}: I'll take it
              </button>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

/** The County's open call window, if any, with the number to dial. */
function TheCall() {
  const campaigns = useQuorum((state) => state.campaigns);
  const customOffices = useQuorum((state) => state.customOffices);
  const openDesk = useQuorum((state) => state.openDesk);
  const setSection = useBoard((state) => state.setSection);
  const now = useNow();
  if (!now) return null;
  const live = campaigns.filter((campaign) => campaign.demand.trim() && windowStatus(campaign.surgeStart, campaign.surgeEnd, now).live);
  if (live.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-widest text-signal uppercase">This week's call · window open</h2>
      {live.map((campaign) => {
        const office = officeById(campaign.officeId, customOffices);
        return (
          <article key={campaign.id} className="rounded-lg border border-signal bg-surface p-4">
            <h3 className="text-2xl text-fg">{campaign.title}</h3>
            <p className="text-sm text-muted">
              {office.name}, {office.role} · {formatWindow(campaign.surgeStart, campaign.surgeEnd)}
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
                The script
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
