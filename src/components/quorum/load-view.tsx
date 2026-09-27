import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { btnSignal, Kicker, LevelSwitch, Meter, Pips, useNow } from "@/components/quorum/bits";
import {
  focusLine,
  formatWindow,
  levelMeta,
  officeById,
  officesAt,
  perOfficeLabel,
  scatterLine,
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

export function LoadView() {
  const campaigns = useQuorum((state) => state.campaigns);
  const logs = useQuorum((state) => state.logs);
  const allies = useQuorum((state) => state.allies);
  const openDesk = useQuorum((state) => state.openDesk);
  const aimOffice = useQuorum((state) => state.aimOffice);
  const level = useQuorum((state) => state.level);
  const setLevel = useQuorum((state) => state.setLevel);
  const customOffices = useQuorum((state) => state.customOffices);
  const now = useNow();
  const roster = officesAt(level, customOffices);
  const meta = levelMeta(level);
  const [people, setPeople] = useState(VOLUME.federal);
  const [officeId, setOfficeId] = useState("johnson");
  const activeId = roster.some((item) => item.id === officeId) ? officeId : (roster[0]?.id ?? "johnson");
  const office = officeById(activeId, customOffices);
  const bounds = level === "county" ? { min: 5, max: 200, step: 5 } : level === "state" ? { min: 10, max: 500, step: 10 } : { min: 20, max: 800, step: 10 };
  const shown = Math.min(bounds.max, Math.max(bounds.min, people));

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of logs) {
      map.set(entry.campaignId, (map.get(entry.campaignId) ?? 0) + 1);
    }
    return map;
  }, [logs]);

  const visible = campaigns.filter(
    (campaign) => officeById(campaign.officeId, customOffices).level === level,
  );
  const cap = level === "county" ? 40 : level === "state" ? 80 : 200;
  const focusLit = Math.max(shown > 0 ? 1 : 0, Math.min(12, Math.round((shown / cap) * 12)));
  const scatterLit = shown > 0 ? 1 : 0;

  function choose(next: Level) {
    setLevel(next);
    const list = officesAt(next, customOffices);
    setOfficeId(list[0]?.id ?? "switchboard");
    setPeople(VOLUME[next]);
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <Kicker>The choke point</Kicker>
        <h1 className="max-w-xl font-display text-4xl leading-tight text-fg">
          One office has to answer.
        </h1>
        <p className="max-w-2xl text-base text-muted">
          Federal, state, or county: the bill dies in one pair of hands. Quorum
          aims the same sentence at that desk. It does not dial. You do.
        </p>
        <LevelSwitch value={level} onChange={choose} />
        <p className="text-sm text-muted">{BLURB[level]}</p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm text-muted">If your network fields</p>
              <p className="font-display text-4xl tabular-nums text-fg">
                {shown}
                <span className="ml-2 font-sans text-base text-muted">people</span>
              </p>
            </div>
            <label className="flex w-full flex-col gap-2 sm:max-w-xs">
              <span className="text-sm text-muted">Concentrate on</span>
              <select
                className="min-h-11 rounded-md border border-line bg-raised px-3 text-base text-fg"
                value={activeId}
                onChange={(event) => setOfficeId(event.target.value)}
              >
                {roster.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.role}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input
            type="range"
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            value={shown}
            aria-label="Number of constituents in the window"
            onChange={(event) => setPeople(Number(event.target.value))}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <article className="flex flex-col gap-4 rounded-md border border-line bg-bg p-4">
              <div>
                <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                  Scatter
                </p>
                <h2 className="mt-2 text-2xl text-fg">{meta.scatterTitle}</h2>
              </div>
              <p className="font-display text-4xl tabular-nums text-muted">
                {perOfficeLabel(shown, meta.scatterAcross)}
              </p>
              <p className="text-sm text-muted">
                contacts each, spread over {meta.scatterAcross} {meta.scatterNoun}
              </p>
              <Pips lit={scatterLit} tone="muted" />
              <p className="text-sm text-fg">{scatterLine(shown, meta.scatterAcross)}</p>
            </article>
            <article className="flex flex-col gap-4 rounded-md border border-signal bg-bg p-4">
              <div>
                <p className="text-xs font-semibold tracking-widest text-signal uppercase">
                  Concentrate
                </p>
                <h2 className="mt-2 text-2xl text-fg">{office.name}</h2>
              </div>
              <p className="font-display text-4xl tabular-nums text-signal">{shown}</p>
              <p className="text-sm text-muted">contacts on this one desk, inside 90 minutes</p>
              <Pips lit={focusLit} tone="signal" />
              <p className="text-sm text-fg">{focusLine(shown, level)}</p>
            </article>
          </div>
          <button
            type="button"
            className={btnSignal}
            onClick={() => aimOffice(activeId, shown)}
          >
            Open a desk at this volume
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-3xl text-fg">{meta.label} desks</h2>
          <p className="text-sm text-muted tabular-nums">{visible.length} open</p>
        </div>
        <div className="grid gap-4">
          {visible.length === 0 ? (
            <p className="text-sm text-muted">
              No desk at this level yet. Open one from the meter, or add the office that holds the gavel.
            </p>
          ) : null}
          {visible.map((campaign) => {
            const target = officeById(campaign.officeId, customOffices);
            const count = counts.get(campaign.id) ?? 0;
            const groups = allies.filter((ally) => ally.campaignId === campaign.id);
            const pledged = groups.reduce((sum, ally) => sum + ally.pledged, 0);
            const status = now
              ? windowStatus(campaign.surgeStart, campaign.surgeEnd, now)
              : null;
            return (
              <button
                key={campaign.id}
                type="button"
                onClick={() => openDesk(campaign.id)}
                className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 text-left transition-transform duration-150 ease-out active:scale-95"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      campaign.posture === "absolute"
                        ? "rounded-sm bg-signal px-2 py-1 text-xs font-semibold text-signal-ink"
                        : "rounded-sm border border-line px-2 py-1 text-xs font-semibold text-muted"
                    }
                  >
                    {campaign.posture === "absolute" ? "Absolute" : "Partial"}
                  </span>
                  {status?.live ? (
                    <span className="inline-flex items-center gap-2 text-xs font-semibold text-signal">
                      <span className="live-dot size-2 rounded-full bg-signal" />
                      {status.label}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">
                      {formatWindow(campaign.surgeStart, campaign.surgeEnd)}
                      {status ? ` · ${status.label}` : ""}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="text-2xl text-fg">{campaign.title}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {target.name} · {target.role}
                  </p>
                  {groups.length > 0 ? (
                    <p className="mt-1 text-sm text-signal">
                      {pledged} pledged across {groups.length}{" "}
                      {groups.length === 1 ? "group" : "groups"}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="tabular-nums text-fg">
                      {count}
                      <span className="text-muted"> / {campaign.threshold} logged</span>
                    </span>
                    <span className="text-muted">Your cell only</span>
                  </div>
                  <Meter value={count} max={campaign.threshold} />
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
