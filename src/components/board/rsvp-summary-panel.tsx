import { useEffect, useState } from "react";
import { fetchRsvpSummary, type RsvpSummary, type SummaryCount } from "@/lib/board/rsvp-api";
import { HIDDEN_CELL_LABEL, RSVP_SUMMARY_MIN_COUNT, privacyNote } from "@/lib/board/rsvp-rules";
import { gatheringLabel, sortSummaryRooms, sortWeeks, weekLabel } from "@/lib/board/rsvp-summary-view";

/**
 * Admin RSVP counts (Oct 30): going, times members came and write-ups, per room, per
 * gathering and per week. Counts only: no one is named or listed, nothing is
 * ranked, no gathering titles. Members never see this page. Every line about
 * hiding is derived from RSVP_SUMMARY_MIN_COUNT (rsvp-rules.ts).
 */
export const RSVP_SUMMARY_INTRO =
  "Counts only. No one is named or listed. \u201cGoing\u201d is who said they'd come to the next date. \u201cTimes came\u201d adds up, over every gathering, the members a host or steward marked as having come, so one member who came to three gatherings counts three times. \u201cBy week\u201d counts the write-ups filed each week. Barred members are counted too.";
export const RSVP_WEEK_CAPTION = "By week, from write-ups: write-ups filed.";

type State = { kind: "loading" } | { kind: "ready"; summary: RsvpSummary } | { kind: "message"; text: string };

export function RsvpSummaryPanel() {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let cancel = false;
    void fetchRsvpSummary()
      .then((result) => {
        if (cancel) return;
        if (result.ok) setState({ kind: "ready", summary: result.summary });
        else if (result.status === 403) setState({ kind: "message", text: "These counts are for an admin." });
        else if (result.status === 503) setState({ kind: "message", text: "RSVPs are not on the server yet." });
        else setState({ kind: "message", text: "The RSVP counts could not be loaded." });
      })
      .catch(() => {
        if (!cancel) setState({ kind: "message", text: "The RSVP counts could not be loaded." });
      });
    return () => {
      cancel = true;
    };
  }, []);
  const n = state.kind === "ready" ? state.summary.minCount : RSVP_SUMMARY_MIN_COUNT;
  const statusText = state.kind === "loading" ? "Loading RSVP counts." : state.kind === "message" ? state.text : "";
  return (
    <section
      className="col-span-12 flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-6"
      aria-labelledby="rsvp-summary-title"
    >
      <h2 id="rsvp-summary-title" className="text-2xl text-fg">
        RSVP counts
      </h2>
      <p className="max-w-prose text-sm text-muted">{RSVP_SUMMARY_INTRO}</p>
      <p className="max-w-prose text-sm text-muted">{privacyNote(n)}</p>
      {/* One always-mounted live line for loading and every message (Design #126 L1). */}
      <p role="status" className={statusText ? "text-sm text-muted" : "sr-only"}>
        {statusText}
      </p>
      {state.kind === "ready" ? <Tables summary={state.summary} /> : null}
    </section>
  );
}

/** A count, or "Hidden" that a screen reader hears as "hidden to protect privacy". */
export function Shown({ count }: { count: SummaryCount }) {
  return count === null ? (
    <>
      <span aria-hidden="true">Hidden</span>
      <span className="sr-only">{HIDDEN_CELL_LABEL}</span>
    </>
  ) : (
    <>{count}</>
  );
}

const th = "px-2 py-2 font-semibold text-muted";
/** Number headers never wrap, so the table holds at 390px (Design #126 r5712986677 M1). */
const numTh = `${th} whitespace-nowrap text-right`;
const num = "px-2 py-2 text-right tabular-nums text-fg";

/** Visible "Times came"; a screen reader hears "Times members came" (Design #126 M1). */
export function TimesCameHeader() {
  return (
    <>
      <span aria-hidden="true">Times came</span>
      <span className="sr-only">Times members came</span>
    </>
  );
}

/** "came 10 times", "came 1 time", or "came Hidden" (no number, so no "times"). */
function CameTimes({ count }: { count: SummaryCount }) {
  if (count === null) {
    return (
      <>
        came <Shown count={null} />
      </>
    );
  }
  return <>came {count === 1 ? "1 time" : `${count} times`}</>;
}

/** "going 13 · came 10 times · write-ups 3" (Design #126 M1). */
export function SummaryLine({ cells }: { cells: { going: SummaryCount; came: SummaryCount; writeUps: SummaryCount } }) {
  return (
    <>
      going <Shown count={cells.going} />{"\u00a0· "}<CameTimes count={cells.came} />{"\u00a0· "}write-ups <Shown count={cells.writeUps} />
    </>
  );
}

export function Tables({ summary }: { summary: RsvpSummary }) {
  if (summary.rooms.length === 0) return <p className="text-sm text-muted">No gatherings yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg">
        All rooms: <SummaryLine cells={summary.totals} />
      </p>
      {sortSummaryRooms(summary.rooms).map((room) => (
        <details key={room.roomId || "none"} className="flex flex-col gap-2">
          <summary className="min-h-[44px] cursor-pointer py-2 text-fg">
            {room.name}: <SummaryLine cells={room} />
          </summary>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Gatherings in ${room.name}`}>
            <table className="w-full min-w-[19rem] text-left text-sm">
              <caption className="sr-only">Gatherings in {room.name}: going, times members came and write-ups for each</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Gathering</th>
                  <th scope="col" className={numTh}>Going</th>
                  <th scope="col" className={numTh}>
                    <TimesCameHeader />
                  </th>
                  <th scope="col" className={numTh}>Write-ups</th>
                </tr>
              </thead>
              <tbody>
                {room.gatherings.map((g) => (
                  <tr key={g.gatheringId} className="border-t border-line">
                    <th scope="row" className="px-2 py-2 font-normal text-fg">
                      {gatheringLabel(g.date)}
                    </th>
                    <td className={num}><Shown count={g.going} /></td>
                    <td className={num}><Shown count={g.came} /></td>
                    <td className={num}><Shown count={g.writeUps} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {room.weeks.length > 0 ? (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Weeks in ${room.name}`}>
              <table className="w-full min-w-[16rem] text-left text-sm">
                <caption className="px-2 py-2 text-left text-muted">{RSVP_WEEK_CAPTION}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={th}>Week of</th>
                    <th scope="col" className={numTh}>Write-ups</th>
                  </tr>
                </thead>
                <tbody>
                  {sortWeeks(room.weeks).map((w) => (
                    <tr key={w.week} className="border-t border-line">
                      <th scope="row" className="px-2 py-2 font-normal text-fg">
                        {weekLabel(w.week)}
                      </th>
                      <td className={num}><Shown count={w.writeUps} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </details>
      ))}
    </div>
  );
}
