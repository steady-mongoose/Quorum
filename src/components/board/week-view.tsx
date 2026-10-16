import { useMemo } from "react";
import { btnGhost, btnSignal, Kicker, useNow } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { CouncilBar } from "@/components/board/council-bar";
import { COUNCIL_APPROVED_LABEL, homeMeetingEntries, homeOrder, homePostEntries, homeSections, toHomeMember } from "@/lib/board/home";
import { CONGREGATIONS, homeCatalog } from "@/lib/board/places";
import { zipRowsForMember } from "@/lib/board/zcta";
import { ZCTA_SEED } from "@/lib/board/zcta-seed";
import {
  addDays,
  authorName,
  parseIsoDate,
  cardSummary,
  formatDate,
  needsFor,
  readingLine,
  roomById,
  todayIso,
  weekFor,
  witnessesByTrade,
  type MeetingCard,
  type Post,
} from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { useQuorum } from "@/lib/quorum/store";
import { formatWindow, officeById, telHref, windowStatus } from "@/lib/quorum/model";

/**
 * The front door: the next seven days, nearest first, this week's call, and
 * what a parish needs. Council-approved posts are the only thing that jumps
 * the order. A card with no local room stays off this page.
 */
export function WeekView() {
  const cards = useBoard((state) => state.cards);
  const posts = useBoard((state) => state.posts);
  const profile = useBoard((state) => state.profile);
  const joined = useBoard((state) => state.joined);
  const approvals = useBoard((state) => state.councilApprovals);
  const corrections = useBoard((state) => state.zipCorrections);
  const extraTownRooms = useBoard((state) => state.extraTownRooms);
  const me = useBoard((state) => authorName(state.me));
  const setSection = useBoard((state) => state.setSection);
  const today = todayIso();
  const catalog = useMemo(() => homeCatalog(zipRowsForMember(profile.zip, ZCTA_SEED, corrections), extraTownRooms), [corrections, extraTownRooms, profile.zip]);
  const member = useMemo(() => toHomeMember(profile, joined, CONGREGATIONS), [profile, joined]);
  const week = useMemo(() => weekFor(cards, witnessesByTrade(posts, cards), today), [cards, posts, today]);
  const needs = useMemo(() => needsFor(cards), [cards]);
  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const postById = useMemo(() => new Map(posts.map((post) => [post.id, post])), [posts]);
  const sections = useMemo(() => {
    const cardEntries = homeMeetingEntries(
      week.flatMap((day) => day.cards).map((card) => ({
        id: card.id,
        at: parseIsoDate(card.next)?.getTime() ?? 0,
        localRoomId: card.localRoomId,
        going: card.going,
      })),
    );
    const postEntries = homePostEntries(posts, approvals);
    return homeSections(homeOrder(member, [...postEntries, ...cardEntries], catalog, approvals));
  }, [approvals, catalog, member, posts, week]);
  const orderedNeeds = useMemo(() => {
    const rows = homeOrder(
      member,
      homeMeetingEntries(needs.map((card) => ({ id: card.id, at: 0, localRoomId: card.localRoomId }))),
      catalog,
    );
    return rows.flatMap((row) => {
      const card = cardById.get(row.entry.id);
      return card ? [card] : [];
    });
  }, [cardById, catalog, member, needs]);
  const empty = sections.length === 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:gap-12">
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-2">
          <Kicker>This week</Kicker>
          <h1 className="font-display text-4xl text-balance text-fg lg:text-5xl">{empty ? "Nothing on the calendar yet." : "This week"}</h1>
          {empty ? (
            <p className="max-w-2xl text-base text-muted">
              A card lands here when it has a date inside seven days and a town, church, or county on it, and that place is one you've joined, your town, your church, or a wider region. A card with no place stays off this page.{" "}
              <button type="button" className="text-signal underline" onClick={() => setSection("rooms")}>
                Look in the rooms
              </button>{" "}
              or list something under Find.
            </p>
          ) : (
            <p className="max-w-prose text-base text-muted">
              Nearest first: what you've joined, then your town, then your church, then farther out. Inside each, the soonest date is first. Saying you'll be there does not move a card. Press <strong className="font-semibold text-fg">I'll be there</strong> on anything you will go to.
            </p>
          )}
        </section>

        {sections.map((section) => (
          <section key={section.tier} className="flex flex-col gap-3">
            <h2 className="border-b border-line pb-2 font-display text-2xl text-fg">{section.label}</h2>
            <div className="grid gap-3 xl:grid-cols-2">
              {section.rows.map((row) => {
                const card = cardById.get(row.entry.id);
                if (card) return <DayCard key={card.id} card={card} me={me} today={today} promoted={row.label ? row.reason : null} />;
                const post = postById.get(row.entry.id);
                return post ? <PromotedPost key={post.id} post={post} reason={row.reason ?? ""} /> : null;
              })}
            </div>
          </section>
        ))}
      </div>

      <aside className="flex flex-col gap-8 lg:sticky lg:top-28 lg:self-start">
        <TheCall />
        {orderedNeeds.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">A parish needs</h2>
            {orderedNeeds.map((card) => (
              <NeedCard key={card.id} card={card} />
            ))}
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function whenLabel(iso: string, today: string): string {
  if (!iso) return "";
  if (iso === today) return `Today · ${formatDate(iso)}`;
  if (iso === addDays(today, 1)) return `Tomorrow · ${formatDate(iso)}`;
  return formatDate(iso);
}

function DayCard({ card, me, today, promoted }: { card: MeetingCard; me: string; today: string; promoted: string | null }) {
  const rsvp = useBoard((state) => state.rsvp);
  const setRoom = useBoard((state) => state.setRoom);
  const going = card.going.includes(me);
  const when = whenLabel(card.next, today);
  return (
    <article className={cn("rounded-lg border bg-surface p-4", promoted ? "border-signal" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg" onClick={() => setRoom(card.room)}>
          {roomById(card.room).name}
        </button>
        {when ? <span className="text-muted">{when}</span> : null}
        {promoted ? <span className="rounded-sm border border-signal px-2 py-1 text-signal">{COUNCIL_APPROVED_LABEL}</span> : null}
        {card.kind === "candidate" ? <span className="rounded-sm border border-signal px-2 py-1 text-signal">Candidate event</span> : null}
        {card.firstTimer ? <span className="text-signal">new people welcome</span> : null}
      </div>
      {promoted ? <p className="mt-2 text-sm text-muted">{promoted}</p> : null}
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

function PromotedPost({ post, reason }: { post: Post; reason: string }) {
  const setRoom = useBoard((state) => state.setRoom);
  return (
    <article className="rounded-lg border border-signal bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-sm border border-signal px-2 py-1 text-signal">{COUNCIL_APPROVED_LABEL}</span>
        <button type="button" className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg" onClick={() => setRoom(post.room)}>
          {roomById(post.room).name}
        </button>
      </div>
      {reason ? <p className="mt-2 text-sm text-muted">{reason}</p> : null}
      <h3 className="mt-2 text-2xl text-fg">{post.claim}</h3>
      {post.reason ? <p className="mt-1 text-sm text-muted">{post.reason}</p> : null}
      <CouncilBar entryId={post.id} />
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
