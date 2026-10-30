import { useEffect, useState } from "react";
import { fetchRsvpSummary, type RsvpSummary, type SummaryCount } from "@/lib/board/rsvp-api";

/**
 * Admin RSVP counts (Oct 30): going, came and write-ups, per room, per
 * gathering and per week. Counts only: no one is named or listed, nothing is
 * ranked. Members never see this page.
 */
export function RsvpSummaryPanel() {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; summary: RsvpSummary } | { kind: "message"; text: string }>({ kind: "loading" });
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
  return (
    <section className="col-span-12 flex flex-col gap-3" aria-labelledby="rsvp-summary-title">
      <h2 id="rsvp-summary-title" className="text-2xl text-fg">
        RSVPs
      </h2>
      <p className="max-w-prose text-sm text-muted">
        Counts only. No one is named or listed. &ldquo;Going&rdquo; is who said they would come to the next
        date. &ldquo;Came&rdquo; is who a host or steward has marked as having come. &ldquo;Write-ups&rdquo; is
        how many times a date was written up. Members who are barred are counted too.
        {state.kind === "ready" && state.summary.minCount > 1
          ? ` A count under ${state.summary.minCount} is shown as hidden, with a neighbour hidden too.`
          : ""}
      </p>
      {state.kind === "loading" ? <p className="text-sm text-muted">Loading RSVP counts.</p> : null}
      {state.kind === "message" ? (
        <p className="text-fg" role="status">
          {state.text}
        </p>
      ) : null}
      {state.kind === "ready" ? <Tables summary={state.summary} /> : null}
    </section>
  );
}

function shown(count: SummaryCount): string {
  return count === null ? "hidden" : String(count);
}

function Tables({ summary }: { summary: RsvpSummary }) {
  if (summary.rooms.length === 0) return <p className="text-sm text-muted">No gatherings yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg">
        All rooms: going {shown(summary.totals.going)}, came {shown(summary.totals.came)}, write-ups{" "}
        {shown(summary.totals.writeUps)}.
      </p>
      {summary.rooms.map((room) => (
        <details key={room.roomId || "none"} className="flex flex-col gap-2">
          <summary className="min-h-[44px] cursor-pointer text-fg">
            {room.roomId || "No room"}: going {shown(room.going)}, came {shown(room.came)}, write-ups{" "}
            {shown(room.writeUps)}
          </summary>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Gatherings in {room.roomId || "no room"}</caption>
            <thead>
              <tr>
                <th scope="col">Gathering</th>
                <th scope="col">Going</th>
                <th scope="col">Came</th>
                <th scope="col">Write-ups</th>
              </tr>
            </thead>
            <tbody>
              {room.gatherings.map((g) => (
                <tr key={g.gatheringId}>
                  <th scope="row" className="font-normal">
                    {g.title}
                  </th>
                  <td>{shown(g.going)}</td>
                  <td>{shown(g.came)}</td>
                  <td>{shown(g.writeUps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {room.weeks.length > 0 ? (
            <table className="w-full text-left text-sm">
              <caption className="text-left text-muted">By week, from write-ups: how many came, and how many write-ups.</caption>
              <thead>
                <tr>
                  <th scope="col">Week of</th>
                  <th scope="col">Came</th>
                  <th scope="col">Write-ups</th>
                </tr>
              </thead>
              <tbody>
                {room.weeks.map((w) => (
                  <tr key={w.week}>
                    <th scope="row" className="font-normal">
                      {w.week}
                    </th>
                    <td>{shown(w.came)}</td>
                    <td>{shown(w.writeUps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </details>
      ))}
    </div>
  );
}
