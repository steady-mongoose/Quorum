import { useEffect, useState } from "react";
import { fetchRsvpSummary, type RsvpSummary, type SummaryCount } from "@/lib/board/rsvp-api";
import { HIDDEN_CELL_LABEL, RSVP_SUMMARY_MIN_COUNT, privacyNote } from "@/lib/board/rsvp-rules";
import { gatheringLabel, sortSummaryRooms, sortWeeks, weekLabel } from "@/lib/board/rsvp-summary-view";

/**
 * Admin RSVP counts (Oct 30): going, have come and write-ups, per room, per
 * gathering and per week. Counts only: no one is named or listed, nothing is
 * ranked, no gathering titles. Members never see this page. Every line about
 * hiding is derived from RSVP_SUMMARY_MIN_COUNT (rsvp-rules.ts).
 */
export const RSVP_SUMMARY_INTRO =
  "Counts only. No one is named or listed. \u201cGoing\u201d is who said they'd come to the next date. \u201cHave come\u201d is how many members a host or steward has ever marked as having come. \u201cBy week\u201d counts the write-ups filed each week. Barred members are counted too.";
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
const num = "px-2 py-2 text-right tabular-nums text-fg";

export function Tables({ summary }: { summary: RsvpSummary }) {
  if (summary.rooms.length === 0) return <p className="text-sm text-muted">No gatherings yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg">
        All rooms: going <Shown count={summary.totals.going} />, have come <Shown count={summary.totals.came} />,
        write-ups <Shown count={summary.totals.writeUps} />.
      </p>
      {sortSummaryRooms(summary.rooms).map((room) => (
        <details key={room.roomId || "none"} className="flex flex-col gap-2">
          <summary className="min-h-[44px] cursor-pointer py-2 text-fg">
            {room.name}: going <Shown count={room.going} />, have come <Shown count={room.came} />, write-ups{" "}
            <Shown count={room.writeUps} />
          </summary>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Gatherings in ${room.name}`}>
            <table className="w-full min-w-[22rem] text-left text-sm">
              <caption className="sr-only">Gatherings in {room.name}</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Gathering</th>
                  <th scope="col" className={`${th} text-right`}>Going</th>
                  <th scope="col" className={`${th} text-right`}>Have come</th>
                  <th scope="col" className={`${th} text-right`}>Write-ups</th>
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
                    <th scope="col" className={`${th} text-right`}>Write-ups</th>
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
