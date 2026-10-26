import { useState, type ReactNode } from "react";
import type { ShownCount, StatsPayload } from "@/lib/board/stats";

const GOLD = "#c9a45c";

type ChartRow = { label: string; series: { name: string; opacity: number; value: ShownCount }[] };

export function StatsView({
  stats,
  onCsv,
  csvError,
}: {
  stats: StatsPayload;
  onCsv: () => void;
  csvError: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.tiles.map((tile) => (
          <article key={tile.id} className="rounded-lg border border-line bg-surface px-4 py-3">
            <p className="text-sm text-muted">{tile.label}</p>
            <p className="mt-1 font-display text-3xl text-fg">{show(tile.value)}</p>
          </article>
        ))}
      </section>

      <Panel
        title="Joins"
        chart={
          <GoldChart
            label="Joins over time"
            rows={stats.joins.map((row) => ({
              label: shortDay(row.date),
              series: [{ name: "Joins", opacity: 1, value: row.count }],
            }))}
          />
        }
        table={
          <CountTable
            caption="Joins over time"
            columns={["Date", "Joins"]}
            rows={stats.joins.map((row) => [formatDay(row.date), show(row.count)])}
          />
        }
      />

      <Panel
        title="Active members"
        chart={
          <GoldChart
            label="Daily, weekly, and monthly active members"
            rows={stats.active.map((row) => ({
              label: shortDay(row.date),
              series: [
                { name: "That day", opacity: 1, value: row.dau },
                { name: "7 days", opacity: 0.62, value: row.wau },
                { name: "30 days", opacity: 0.38, value: row.mau },
              ],
            }))}
          />
        }
        table={
          <CountTable
            caption="Active members"
            columns={["Date", "That day", "7 days", "30 days"]}
            rows={stats.active.map((row) => [
              formatDay(row.date),
              show(row.dau),
              show(row.wau),
              show(row.mau),
            ])}
          />
        }
      />

      <Panel
        title="Roll and attendance"
        chart={
          <GoldChart
            label="Rolls filed and attendance"
            rows={stats.roll.map((row) => ({
              label: shortDay(row.date),
              series: [
                { name: "Rolls", opacity: 1, value: row.roll },
                { name: "Attendance", opacity: 0.55, value: row.attendance },
              ],
            }))}
          />
        }
        table={
          <CountTable
            caption="Roll and attendance"
            columns={["Date", "Rolls", "Attendance"]}
            rows={stats.roll.map((row) => [
              formatDay(row.date),
              show(row.roll),
              show(row.attendance),
            ])}
          />
        }
      />

      <Panel
        title="Rooms"
        note="A room met in a week when it had a gathering, or a host filed the roll. The chart is the total across rooms."
        extra={
          <p className="text-sm text-fg">
            Rooms that met in at least 3 of the last 4 weeks:{" "}
            <span className="font-semibold">{show(stats.rooms.steady)}</span>
          </p>
        }
        chart={
          <GoldChart
            label="Posts and gatherings per week"
            rows={stats.rooms.weeks.map((row) => ({
              label: shortDay(row.week),
              series: [
                { name: "Posts", opacity: 1, value: row.posts },
                { name: "Gatherings", opacity: 0.55, value: row.gatherings },
              ],
            }))}
          />
        }
        table={
          <CountTable
            caption="Posts and gatherings per room per week"
            columns={["Week", "Room", "Posts", "Gatherings"]}
            rows={stats.rooms.rows.map((row) => [
              formatDay(row.week),
              row.room,
              show(row.posts),
              show(row.gatherings),
            ])}
          />
        }
      />

      <Panel
        title="Features"
        note={featureNote(stats.mostUsed, stats.leastUsed)}
        chart={
          <GoldChart
            label="Feature use by endpoint group"
            rows={stats.features.map((row) => ({
              label: row.label,
              series: [{ name: "Uses", opacity: 1, value: row.count }],
            }))}
          />
        }
        table={
          <CountTable
            caption="Feature use"
            columns={["Feature", "Uses"]}
            rows={stats.features.map((row) => [row.label, show(row.count)])}
          />
        }
      />

      <Panel
        title="Intent"
        note={stats.intent.rsvpNote}
        extra={
          <dl className="grid gap-2 text-sm text-fg">
            <div className="flex justify-between gap-4">
              <dt>At an in-person gathering this month</dt>
              <dd className="font-semibold">{inPerson(stats)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Active in two or more rooms</dt>
              <dd className="font-semibold">{show(stats.intent.crossRoomMembers)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Vouches across rooms</dt>
              <dd className="font-semibold">{show(stats.intent.crossRoomVouches)}</dd>
            </div>
          </dl>
        }
        chart={
          <GoldChart
            label="Attendance over time"
            rows={stats.intent.attendance.map((row) => ({
              label: shortDay(row.date),
              series: [{ name: "Attendance", opacity: 1, value: row.count }],
            }))}
          />
        }
        table={
          <CountTable
            caption="Attendance"
            columns={["Date", "Attendance"]}
            rows={stats.intent.attendance.map((row) => [formatDay(row.date), show(row.count)])}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary inline-flex min-h-[44px] items-center rounded-md bg-signal px-4 text-sm font-semibold text-signal-ink"
          onClick={onCsv}
        >
          Download CSV
        </button>
        {csvError ? (
          <p role="alert" className="text-sm text-danger">
            {csvError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Panel({
  title,
  note,
  extra,
  chart,
  table,
}: {
  title: string;
  note?: string;
  extra?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [mode, setMode] = useState<"chart" | "table">("chart");
  return (
    <section className="flex flex-col gap-3" aria-labelledby={titleId(title)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id={titleId(title)} className="text-2xl text-fg">
          {title}
        </h2>
        <div className="flex gap-2" role="group" aria-label={`${title} view`}>
          <button
            type="button"
            className={modeButton(mode === "chart")}
            aria-pressed={mode === "chart"}
            onClick={() => setMode("chart")}
          >
            Chart
          </button>
          <button
            type="button"
            className={modeButton(mode === "table")}
            aria-pressed={mode === "table"}
            onClick={() => setMode("table")}
          >
            Table
          </button>
        </div>
      </div>
      {note ? <p className="max-w-prose text-sm text-muted">{note}</p> : null}
      {extra}
      <div hidden={mode !== "chart"}>{chart}</div>
      <div hidden={mode !== "table"}>{table}</div>
    </section>
  );
}

function GoldChart({ label, rows }: { label: string; rows: ChartRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Nothing in this window.</p>;
  const names = rows[0]?.series.map((item) => item.name) ?? [];
  const numeric = rows.flatMap((row) =>
    row.series.map((item) => (item.value === "<5" ? 0 : item.value)),
  );
  const max = Math.max(5, ...numeric);
  const width = 640;
  const height = 180;
  const pad = 16;
  const group = (width - pad * 2) / rows.length;
  const bar = Math.max(2, (group - 6) / Math.max(names.length, 1));
  return (
    <figure className="flex flex-col gap-2">
      <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} className="h-44 w-full">
        {rows.map((row, index) =>
          row.series.map((item, seriesIndex) => {
            const suppressed = item.value === "<5";
            const portion = suppressed ? 0.12 : (item.value as number) / max;
            const barHeight = Math.max(2, portion * (height - 36));
            const x = pad + index * group + seriesIndex * bar;
            return (
              <rect
                key={`${row.label}-${item.name}`}
                x={x}
                y={height - 22 - barHeight}
                width={Math.max(1, bar - 1)}
                height={barHeight}
                fill={GOLD}
                opacity={suppressed ? 0.45 : item.opacity}
              />
            );
          }),
        )}
        <text x={pad} y={height - 4} fill="#bcae94" fontSize="11">
          {rows[0]?.label}
        </text>
        {rows.length > 1 ? (
          <text x={width - pad} y={height - 4} fill="#bcae94" fontSize="11" textAnchor="end">
            {rows[rows.length - 1]?.label}
          </text>
        ) : null}
      </svg>
      {names.length > 1 ? (
        <ul className="flex flex-wrap gap-4 text-sm text-muted">
          {names.map((name, index) => (
            <li key={name} className="inline-flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: GOLD, opacity: rows[0]?.series[index]?.opacity ?? 1 }}
              />
              {name}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

function CountTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: string[][];
}) {
  if (rows.length === 0) return <p className="text-sm text-muted">Nothing in this window.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-muted">
            {columns.map((column) => (
              <th key={column} scope="col" className="px-2 py-2 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.join("-")}-${index}`} className="border-b border-line">
              {row.map((cell, cellIndex) => (
                <td key={`${columns[cellIndex]}-${cell}`} className="px-2 py-2 text-fg">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function show(value: ShownCount | number | null): string {
  if (value === null) return "—";
  return String(value);
}

function inPerson(stats: StatsPayload): string {
  if (stats.intent.inPersonPercent !== null) return `${stats.intent.inPersonPercent}%`;
  return show(stats.intent.inPersonCount);
}

function featureNote(most: string | null, least: string | null): string {
  if (most && least) return `Most used: ${most}. Least used: ${least}.`;
  if (most) return `Most used: ${most}.`;
  return "Too few uses to name a most or least.";
}

function modeButton(active: boolean): string {
  return active
    ? "inline-flex min-h-[44px] items-center rounded-md bg-signal px-3 text-sm font-semibold text-signal-ink"
    : "inline-flex min-h-[44px] items-center rounded-md border border-line bg-surface px-3 text-sm font-semibold text-muted";
}

function titleId(title: string): string {
  return `stats-${title.toLowerCase().replaceAll(" ", "-")}`;
}

function formatDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function shortDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}
