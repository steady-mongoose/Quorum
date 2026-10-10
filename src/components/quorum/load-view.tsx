import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronUp } from "lucide-react";
import { btnGhost, btnSignal, Kicker, LevelSwitch, Meter, Pips, useNow } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  focusLine,
  formatWindow,
  levelMeta,
  officeById,
  officesAt,
  perOfficeLabel,
  scatterLine,
  telHref,
  windowStatus,
  type Level,
} from "@/lib/quorum/model";
import { useQuorum } from "@/lib/quorum/store";

const BLURB: Record<Level, string> = {
  federal: "Congress. The same people, spread across 435 offices, never fill one switchboard.",
  state: "Florida. A clean bill still dies on one calendar in Tallahassee.",
  county: "Hillsborough County. Seven commissioners, one agenda. Wimauma is District 4.",
};

const VOLUME: Record<Level, number> = { federal: 240, state: 120, county: 40 };

/**
 * The desk's first page, in the order a member needs it: the calls that are
 * open or coming, each with the number and the script; then, for whoever
 * organizes, how to start a new one.
 */
export function LoadView() {
  const campaigns = useQuorum((state) => state.campaigns);
  const logs = useQuorum((state) => state.logs);
  const allies = useQuorum((state) => state.allies);
  const openDesk = useQuorum((state) => state.openDesk);
  const customOffices = useQuorum((state) => state.customOffices);
  const now = useNow();
  const [starting, setStarting] = useState(false);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of logs) map.set(entry.campaignId, (map.get(entry.campaignId) ?? 0) + 1);
    return map;
  }, [logs]);

  // Every call with a sentence, open ones first, then by how soon they open.
  const calls = useMemo(() => {
    if (!now) return [];
    return campaigns
      .filter((campaign) => campaign.demand.trim())
      .map((campaign) => ({ campaign, status: windowStatus(campaign.surgeStart, campaign.surgeEnd, now) }))
      .sort((a, b) => Number(b.status.live) - Number(a.status.live) || a.status.minutes - b.status.minutes);
  }, [campaigns, now]);
  const drafts = campaigns.filter((campaign) => !campaign.demand.trim());

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Kicker>Calls this week</Kicker>
          <h2 className="font-display text-3xl text-fg">{calls.some((c) => c.status.live) ? "A call is on right now." : "No call is on right now. Here is what is coming."}</h2>
          <p className="max-w-prose text-base text-muted">
            Each card is one official to phone, the message to give them, and the hour everyone is calling. When it says open, dial the number and read the message. Then press "I called" and record it.
          </p>
        </div>
        {calls.length === 0 ? <p className="text-sm text-muted">No calls yet. Someone starts one below.</p> : null}
        <div className="grid gap-4 xl:grid-cols-2">
          {calls.map(({ campaign, status }) => {
            const target = officeById(campaign.officeId, customOffices);
            const count = counts.get(campaign.id) ?? 0;
            const groups = allies.filter((ally) => ally.campaignId === campaign.id);
            const pledged = groups.reduce((sum, ally) => sum + ally.pledged, 0);
            return (
              <article key={campaign.id} className={cn("flex flex-col gap-4 rounded-lg border bg-surface p-4", status.live ? "border-signal" : "border-line")}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-sm bg-raised px-2 py-1 font-semibold text-fg">{levelMeta(target.level).label}</span>
                  {status.live ? (
                    <span className="inline-flex items-center gap-2 font-semibold text-signal">
                      <span className="live-dot size-2 rounded-full bg-signal" />
                      Open now · {status.minutes}m left
                    </span>
                  ) : (
                    <span className="text-muted">
                      {formatWindow(campaign.surgeStart, campaign.surgeEnd)} · {status.label.toLowerCase()}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="text-2xl text-fg">{campaign.title}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {target.name} · {target.role}
                  </p>
                </div>
                <p className="border-l-2 border-line pl-3 text-base text-fg">{campaign.demand}</p>
                <div className="flex flex-wrap gap-2">
                  <a className={status.live ? btnSignal : btnGhost} href={telHref(target.dcPhone)}>
                    Call {target.dcPhone}
                  </a>
                  <button type="button" className={btnGhost} onClick={() => openDesk(campaign.id)}>
                    What to say · I called
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="tabular-nums text-fg">
                      {count}
                      <span className="text-muted"> of {campaign.threshold} calls logged by your people</span>
                    </span>
                    {groups.length > 0 ? (
                      <span className="text-muted">
                        {pledged} more pledged by {groups.length} {groups.length === 1 ? "group" : "groups"}
                      </span>
                    ) : null}
                  </div>
                  <Meter value={count} max={campaign.threshold} />
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-4 border-t border-line pt-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Kicker>For whoever organizes</Kicker>
            <h2 className="font-display text-3xl text-fg">Start a new call</h2>
            <p className="max-w-prose text-base text-muted">
              Choose the one official who controls whether the bill moves (a committee chair, the Speaker, the commission chair), then write the message and set the hour on the next page.
              {drafts.length > 0 ? ` You have ${drafts.length} started and not yet written.` : ""}
            </p>
          </div>
          <button type="button" className={btnGhost} onClick={() => setStarting((open) => !open)} aria-expanded={starting}>
            {starting ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
            {starting ? "Hide" : "Start one"}
          </button>
        </div>
        {starting ? <StartCall /> : null}
        {drafts.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {drafts.map((campaign) => {
              const target = officeById(campaign.officeId, customOffices);
              return (
                <li key={campaign.id}>
                  <button type="button" className={cn(btnGhost, "w-full justify-between")} onClick={() => openDesk(campaign.id)}>
                    <span>
                      {target.name}, {target.role} · no sentence yet
                    </span>
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

/** Pick the level and the office, see what the numbers do on one desk, start. */
function StartCall() {
  const aimOffice = useQuorum((state) => state.aimOffice);
  const level = useQuorum((state) => state.level);
  const setLevel = useQuorum((state) => state.setLevel);
  const customOffices = useQuorum((state) => state.customOffices);
  const roster = officesAt(level, customOffices);
  const meta = levelMeta(level);
  const [people, setPeople] = useState(VOLUME[level]);
  const [officeId, setOfficeId] = useState(roster[0]?.id ?? "johnson");
  const activeId = roster.some((item) => item.id === officeId) ? officeId : (roster[0]?.id ?? "johnson");
  const office = officeById(activeId, customOffices);
  const bounds = level === "county" ? { min: 5, max: 200, step: 5 } : level === "state" ? { min: 10, max: 500, step: 10 } : { min: 20, max: 800, step: 10 };
  const shown = Math.min(bounds.max, Math.max(bounds.min, people));
  const cap = level === "county" ? 40 : level === "state" ? 80 : 200;
  const focusLit = Math.max(shown > 0 ? 1 : 0, Math.min(12, Math.round((shown / cap) * 12)));

  function choose(next: Level) {
    setLevel(next);
    const list = officesAt(next, customOffices);
    setOfficeId(list[0]?.id ?? "switchboard");
    setPeople(VOLUME[next]);
  }

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-4 sm:p-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-fg">1. Which level is the bill at?</p>
        <LevelSwitch value={level} onChange={choose} />
        <p className="text-sm text-muted">{BLURB[level]}</p>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-fg">2. Which official decides whether this bill moves?</span>
        <select className="min-h-11 max-w-md rounded-md border border-line bg-raised px-3 text-base text-fg" value={activeId} onChange={(event) => setOfficeId(event.target.value)}>
          {roster.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.role}
            </option>
          ))}
        </select>
        <span className="max-w-prose text-sm text-muted">{office.holds}</span>
      </label>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-fg">3. How many of your people will call?</p>
        <p className="font-display text-4xl tabular-nums text-fg">
          {shown}
          <span className="ml-2 font-sans text-base text-muted">people</span>
        </p>
        <input type="range" min={bounds.min} max={bounds.max} step={bounds.step} value={shown} aria-label="How many of your people will call" onChange={(event) => setPeople(Number(event.target.value))} />
        <p className="max-w-prose text-sm text-muted">Why one official and one hour: the same number of people, spread across every office over a week, is nothing. All on one phone line in one hour is something the staff have to tell the boss about.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <article className="flex flex-col gap-3 rounded-md border border-line bg-bg p-4">
            <p className="text-xs font-semibold tracking-widest text-muted uppercase">Spread out, the usual way</p>
            <p className="font-display text-3xl tabular-nums text-muted">
              {perOfficeLabel(shown, meta.scatterAcross)} <span className="font-sans text-sm">each</span>
            </p>
            <p className="text-sm text-muted">
              across {meta.scatterAcross} {meta.scatterNoun}
            </p>
            <Pips lit={shown > 0 ? 1 : 0} tone="muted" />
            <p className="text-sm text-fg">{scatterLine(shown, meta.scatterAcross)}</p>
          </article>
          <article className="flex flex-col gap-3 rounded-md border border-signal bg-bg p-4">
            <p className="text-xs font-semibold tracking-widest text-signal uppercase">All on this one desk</p>
            <p className="font-display text-3xl tabular-nums text-signal">
              {shown} <span className="font-sans text-sm text-muted">in one hour</span>
            </p>
            <p className="text-sm text-muted">{office.name}</p>
            <Pips lit={focusLit} tone="signal" />
            <p className="text-sm text-fg">{focusLine(shown, level)}</p>
          </article>
        </div>
      </div>

      <button type="button" className={btnSignal} onClick={() => aimOffice(activeId, shown)}>
        Next: write the message and set the hour
        <ArrowUpRight className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
