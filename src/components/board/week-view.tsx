import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { btnGhost, btnSignal, Kicker, useNow } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { dayHeading } from "@/lib/board/week-days";
import {
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
import { categoryNames, roomCategoryIds } from "@/lib/board/categories";
import { HomePanel } from "@/components/board/home-view";
import { GatheringShareControl } from "@/components/board/gathering-share";
import { RsvpControl } from "@/components/board/rsvp-control";
import { armRoom, clearChipNames, withViewTransition } from "@/lib/board/motion";
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
  const navigate = useNavigate();
  const deskOn = useBoard((state) => state.deskOn);
  const justCleared = useBoard((state) => state.undoClear !== null);
  const today = todayIso();
  const week = useMemo(
    () => weekFor(cards, witnessesByTrade(posts, cards), today),
    [cards, posts, today],
  );
  const needs = useMemo(() => needsFor(cards), [cards]);

  return (
    <div className="flex flex-col gap-10">
      <HomePanel />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-8">
          <section className="plate plate--hero flex flex-col gap-2">
            <Kicker>This week</Kicker>
            <h1 className="illum font-display text-4xl text-balance text-fg lg:text-5xl">
              {week.length === 0 ? "Nothing on the calendar yet." : "This week"}
            </h1>
            {week.length > 0 ? (
              <p className="max-w-prose text-base text-muted">
                The next seven days. Press{" "}
                <strong className="font-semibold text-fg">I'll be there</strong> on anything you
                will go to; the host will take roll after.
              </p>
            ) : null}
            {week.length === 0 ? (
              <p className="max-w-2xl text-base text-muted">
                {justCleared
                  ? "The board is cleared, and nothing is on the calendar. "
                  : "A card lands here when it has a date inside seven days. "}
                <button
                  type="button"
                  className="text-signal underline"
                  onClick={() => {
                    setSection("rooms");
                    void navigate({ to: "/rooms" });
                  }}
                >
                  Look in the rooms
                </button>{" "}
                or list something under Find.
              </p>
            ) : null}
          </section>

          {week.map((day) => (
            <section key={day.iso} className="day flex flex-col gap-3">
              <h2 className="flex items-baseline justify-between gap-4 border-b border-line bg-bg px-4 py-2">
                <span className="font-display text-2xl text-fg">{dayHeading(day.iso, today)}</span>
                <span className="text-xs font-semibold tracking-widest text-muted uppercase tabular-nums">
                  {formatDate(day.iso)}
                </span>
              </h2>
              <div className="cards">
                {day.cards.map((card) => (
                  <DayCard key={card.id} card={card} me={me} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="flex flex-col gap-8 lg:sticky lg:top-28 lg:self-start">
          {deskOn ? <TheCall /> : null}
          {needs.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">
                A parish needs
              </h2>
              {needs.map((card) => (
                <NeedCard key={card.id} card={card} />
              ))}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function DayCard({ card, me }: { card: MeetingCard; me: string }) {
  const rsvp = useBoard((state) => state.rsvp);
  const setRoom = useBoard((state) => state.setRoom);
  const going = card.going.includes(me);
  return (
    <article className="card rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center rounded-sm bg-raised px-3 font-semibold text-fg"
          onClick={(event) => {
            clearChipNames(event.currentTarget);
            event.currentTarget.style.viewTransitionName = `card-${card.room}`;
            armRoom(card.room);
            withViewTransition(() => setRoom(card.room));
          }}
        >
          {roomById(card.room).name}
        </button>
        {card.kind === "candidate" ? (
          <span className="rounded-sm border border-signal px-2 py-1 text-signal">
            Candidate event
          </span>
        ) : null}
        {card.firstTimer ? <span className="text-signal">new people welcome</span> : null}
      </div>
      <p className="text-sm text-muted">{categoryNames(roomCategoryIds(roomById(card.room)))}</p>
      <h3 className="mt-2 text-2xl text-fg">{card.name}</h3>
      <p className="text-sm text-muted">{cardSummary(card)}</p>
      {card.book ? <p className="mt-1 text-sm text-fg">{readingLine(card)}</p> : null}
      {card.going.length > 0 ? (
        <p className="mt-1 text-sm text-muted">Going: {card.going.join(", ")}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {card.host !== me ? (
          <RsvpControl card={card} going={going} onToggle={() => rsvp(card.id)} />
        ) : null}
        <GatheringShareControl card={card} />
      </div>
    </article>
  );
}

export function NeedCard({ card }: { card: MeetingCard }) {
  const takeSlot = useBoard((state) => state.takeSlot);
  return (
    <article className="card rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg">
          {roomById(card.room).name}
        </span>
        <span className="text-muted">organized by {card.host}</span>
      </div>
      <p className="text-sm text-muted">{categoryNames(roomCategoryIds(roomById(card.room)))}</p>
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
              <button
                type="button"
                className={btnSignal}
                onClick={() => takeSlot(card.id, slot.day)}
              >
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
  const live = campaigns.filter(
    (campaign) =>
      campaign.demand.trim() && windowStatus(campaign.surgeStart, campaign.surgeEnd, now).live,
  );
  if (live.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-widest text-signal uppercase">
        This week's call · window open
      </h2>
      {live.map((campaign) => {
        const office = officeById(campaign.officeId, customOffices);
        return (
          <article
            key={campaign.id}
            className="card rounded-lg border border-signal bg-surface p-4"
          >
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
