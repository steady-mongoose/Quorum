import { useState, type ReactNode } from "react";
import {
  STATS_CATEGORIES,
  STATS_DAYS,
  seriesSummary,
  type FunnelStep,
  type ShownCount,
  type StatsDays,
  type StatsPayload,
} from "@/lib/board/stats";

const GOLD = "#c9a45c";
const GRID = "#857c6f";
const AXIS = "#bcae94";
const ROOM_PAGE = 20;

type Bar = { label: string; count: ShownCount | null };

export function StatsView({
  stats,
  onCsv,
  csvError,
  days,
  category,
  onDays,
  onCategory,
}: {
  stats: StatsPayload;
  onCsv: () => void;
  csvError: string;
  days: StatsDays;
  category: string;
  onDays: (days: StatsDays) => void;
  onCategory: (category: string) => void;
}) {
  const roomRows = [...stats.rooms.rows].sort(
    (a, b) => a.room.localeCompare(b.room) || a.week.localeCompare(b.week),
  );
  return (
    <>
      <Alerts alerts={stats.alerts} />
      <div className="col-span-12 flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div role="group" aria-label="Range" className="flex flex-wrap gap-2">
          {STATS_DAYS.map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={days === choice}
              className={days === choice ? choiceOn : choiceOff}
              onClick={() => onDays(choice)}
            >
              {choice} days
            </button>
          ))}
        </div>
        <label className="flex min-w-0 flex-col gap-1 text-[0.85rem] text-muted">
          Category
          <select
            className="min-h-[44px] rounded-md border border-line bg-surface px-3 text-fg"
            value={category}
            aria-label="Category"
            onChange={(event) => onCategory(event.target.value)}
          >
            <option value="all">All</option>
            {STATS_CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p className="max-w-prose text-[0.85rem] text-muted">
          The category list does not narrow these counts yet.
        </p>
      </div>

      {stats.tiles.map((tile) => (
        <article
          key={tile.id}
          className="col-span-6 min-w-0 rounded-lg border border-line bg-surface p-6 lg:col-span-3"
        >
          <p className="text-[0.85rem] tracking-[.04em] text-muted">{tile.label}</p>
          <p className="mt-2 font-display text-[2.5rem] leading-none text-fg tabular-nums">
            {show(tile.value)}
          </p>
          <ChangeLine change={tile.change} />
        </article>
      ))}

      <ChartCard
        title="Rooms by category"
        chart={
          <HorizontalBars
            label="Active rooms by category"
            summary={seriesSummary(
              "Rooms",
              stats.roomsByCategory.map((row) => ({ label: row.label, count: row.count })),
            )}
            rows={stats.roomsByCategory.map((row) => ({ label: row.label, count: row.count }))}
          />
        }
        table={
          <CountTable
            caption="Active rooms by category"
            columns={["Category", "Rooms"]}
            rows={stats.roomsByCategory.map((row) => [row.label, show(row.count)])}
          />
        }
      />
      <ChartCard
        title="Invites"
        chart={
          <HorizontalBars
            label="Invites sent, opened, accepted, and a first gathering"
            summary={funnelSummary(stats.funnel)}
            rows={stats.funnel.map((step) => ({ label: step.label, count: step.count }))}
          />
        }
        table={
          <CountTable
            caption="Invite funnel"
            columns={["Step", "Count"]}
            rows={stats.funnel.map((step) => [
              step.label,
              step.count === null ? "Not collected" : show(step.count),
            ])}
          />
        }
      />

      <ActiveMembers stats={stats} />

      <ChartCard
        title="Joins"
        chart={
          <ColumnChart
            label="Joins over time"
            noun="Joins"
            rows={stats.joins.map((row) => ({ label: shortDay(row.date), count: row.count }))}
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
      <ChartCard
        title="Rolls"
        chart={
          <ColumnChart
            label="Rolls filed"
            noun="Rolls"
            rows={stats.roll.map((row) => ({ label: shortDay(row.date), count: row.roll }))}
          />
        }
        table={
          <CountTable
            caption="Rolls filed"
            columns={["Date", "Rolls"]}
            rows={stats.roll.map((row) => [formatDay(row.date), show(row.roll)])}
          />
        }
      />
      <ChartCard
        title="Attendance"
        chart={
          <ColumnChart
            label="Attendance"
            noun="Attendance"
            rows={stats.roll.map((row) => ({ label: shortDay(row.date), count: row.attendance }))}
          />
        }
        table={
          <CountTable
            caption="Attendance"
            columns={["Date", "Attendance"]}
            rows={stats.roll.map((row) => [formatDay(row.date), show(row.attendance)])}
          />
        }
      />
      <ChartCard
        title="Posts"
        note={`Rooms that met in at least 3 of the last 4 weeks: ${show(stats.rooms.steady)}`}
        chart={
          <ColumnChart
            label="Posts per week"
            noun="Posts"
            rows={stats.rooms.weeks.map((row) => ({ label: shortDay(row.week), count: row.posts }))}
          />
        }
        table={
          <RoomTable
            caption="Posts per room per week"
            columns={["Room", "Week", "Posts"]}
            rows={roomRows.map((row) => [row.room, formatDay(row.week), show(row.posts)])}
          />
        }
      />
      <ChartCard
        title="Gatherings"
        chart={
          <ColumnChart
            label="Gatherings per week"
            noun="Gatherings"
            rows={stats.rooms.weeks.map((row) => ({
              label: shortDay(row.week),
              count: row.gatherings,
            }))}
          />
        }
        table={
          <RoomTable
            caption="Gatherings per room per week"
            columns={["Room", "Week", "Gatherings"]}
            rows={roomRows.map((row) => [row.room, formatDay(row.week), show(row.gatherings)])}
          />
        }
      />

      <div className="col-span-12 mt-8">
        <h2 className="text-2xl text-fg">More counts</h2>
      </div>
      <ChartCard
        title="Features"
        note={featureNote(stats.mostUsed, stats.leastUsed)}
        chart={
          <ColumnChart
            label="Feature use by endpoint group"
            noun="Uses"
            rows={stats.features.map((row) => ({ label: row.label, count: row.count }))}
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
      <ChartCard
        title="Intent"
        note={stats.intent.rsvpNote}
        extra={<IntentFacts stats={stats} />}
        chart={
          <ColumnChart
            label="Attendance over time"
            noun="Attendance"
            rows={stats.intent.attendance.map((row) => ({
              label: shortDay(row.date),
              count: row.count,
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

      <div className="col-span-12 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center rounded-md bg-signal px-4 text-sm font-semibold text-signal-ink"
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
    </>
  );
}

function Alerts({ alerts }: { alerts: StatsPayload["alerts"] }) {
  if (alerts.reports === 0 && alerts.health === "ok") return null;
  const text =
    alerts.health === "down" ? "Stats health is down." : `${alerts.reports} reports waiting`;
  return (
    <section
      role="alert"
      className="col-span-12 flex min-w-0 items-center gap-3 rounded-lg border border-danger p-6 text-danger"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
        <path d="M12 3 2 21h20L12 3zm1 14h-2v-2h2v2zm0-4h-2V9h2v4z" fill="currentColor" />
      </svg>
      <p>{text}</p>
    </section>
  );
}

function ChangeLine({ change }: { change: number | null }) {
  if (change === null) {
    return <p className="mt-2 text-[0.85rem] text-muted tabular-nums">—</p>;
  }
  if (change === 0) {
    return <p className="mt-2 text-[0.85rem] text-muted tabular-nums">No change</p>;
  }
  const up = change > 0;
  const abs = Math.abs(change);
  return (
    <p
      className="mt-2 text-[0.85rem] text-muted tabular-nums"
      aria-label={`${up ? "up" : "down"} ${abs} versus prior 30 days`}
    >
      {up ? "▲" : "▼"} {abs} vs prior 30 days
    </p>
  );
}

function ActiveMembers({ stats }: { stats: StatsPayload }) {
  const [table, setTable] = useState(false);
  return (
    <section className="col-span-12 min-w-0 rounded-lg border border-line bg-surface p-6">
      <ChartHead title="Active members" table={table} setTable={setTable} />
      {table ? (
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
      ) : (
        <div className="grid gap-6">
          <LabeledSeries
            name="That day"
            noun="Members that day"
            rows={stats.active.map((row) => ({ label: shortDay(row.date), count: row.dau }))}
          />
          <LabeledSeries
            name="7 days"
            noun="Members in 7 days"
            rows={stats.active.map((row) => ({ label: shortDay(row.date), count: row.wau }))}
          />
          <LabeledSeries
            name="30 days"
            noun="Members in 30 days"
            rows={stats.active.map((row) => ({ label: shortDay(row.date), count: row.mau }))}
          />
        </div>
      )}
    </section>
  );
}

function LabeledSeries({ name, noun, rows }: { name: string; noun: string; rows: Bar[] }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-[0.85rem] text-muted">{name}</h3>
      <ColumnChart label={`${name} active members`} noun={noun} rows={rows} />
    </div>
  );
}

function ChartCard({
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
  const [open, setOpen] = useState(false);
  return (
    <section className="col-span-12 min-w-0 rounded-lg border border-line bg-surface p-6 lg:col-span-6">
      <ChartHead title={title} table={open} setTable={setOpen} />
      {note ? <p className="mb-3 max-w-prose text-sm text-muted">{note}</p> : null}
      {extra}
      {open ? table : chart}
    </section>
  );
}

function ChartHead({
  title,
  table,
  setTable,
}: {
  title: string;
  table: boolean;
  setTable: (value: boolean) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <h2 id={titleId(title)} className="text-2xl text-fg">
        {title}
      </h2>
      <button
        type="button"
        className="inline-flex min-h-[44px] items-center rounded-md border border-line px-3 text-sm font-semibold text-fg"
        aria-expanded={table}
        aria-controls={titleId(title)}
        onClick={() => setTable(!table)}
      >
        {table ? "View as chart" : "View as table"}
      </button>
    </div>
  );
}

function ColumnChart({ label, noun, rows }: { label: string; noun: string; rows: Bar[] }) {
  const plot = rows.flatMap((row) => (typeof row.count === "number" ? [row] : []));
  if (rows.length === 0) return <p className="text-sm text-muted">Nothing in this window.</p>;
  const max = Math.max(5, ...plot.map((row) => row.count as number));
  const width = 640;
  const height = 180;
  const left = 36;
  const bottom = 28;
  const plotWidth = width - left - 8;
  const plotHeight = height - bottom - 8;
  const group = plotWidth / rows.length;
  return (
    <figure className="min-w-0">
      <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} className="h-44 w-full">
        {[1, 2, 3, 4].map((step) => {
          const y = 8 + plotHeight - (plotHeight * step) / 4;
          return (
            <g key={step}>
              <rect
                x={left}
                y={y}
                width={plotWidth}
                height={1}
                fill="none"
                stroke={GRID}
                strokeWidth={1}
              />
              <text x={left - 6} y={y + 4} fill={AXIS} fontSize={12} textAnchor="end">
                {Math.round((max * step) / 4)}
              </text>
            </g>
          );
        })}
        {rows.map((row, index) => {
          const hidden = row.count === "<5" || row.count === null;
          const portion = hidden ? 0.12 : (row.count as number) / max;
          const barHeight = Math.max(2, portion * plotHeight);
          return (
            <rect
              key={`${row.label}-${index}`}
              data-count={hidden ? "hidden" : "shown"}
              x={left + index * group + 1}
              y={8 + plotHeight - barHeight}
              width={Math.max(1, group - 2)}
              height={barHeight}
              fill={GOLD}
            />
          );
        })}
        <text x={left} y={height - 6} fill={AXIS} fontSize={12}>
          {rows[0]?.label}
        </text>
        {rows.length > 1 ? (
          <text x={width - 8} y={height - 6} fill={AXIS} fontSize={12} textAnchor="end">
            {rows[rows.length - 1]?.label}
          </text>
        ) : null}
      </svg>
      <figcaption className="sr-only">{seriesSummary(noun, numericRows(rows))}</figcaption>
    </figure>
  );
}

function HorizontalBars({ label, summary, rows }: { label: string; summary: string; rows: Bar[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Nothing in this window.</p>;
  const max = Math.max(
    5,
    ...rows.flatMap((row) => (typeof row.count === "number" ? [row.count] : [])),
  );
  const width = 640;
  const labelWidth = 148;
  const valueWidth = 88;
  const rowHeight = 36;
  const height = rows.length * rowHeight + 8;
  const plotWidth = width - labelWidth - valueWidth;
  return (
    <figure className="min-w-0">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
      >
        {[1, 2, 3, 4].map((step) => {
          const x = labelWidth + (plotWidth * step) / 4;
          return (
            <g key={step}>
              <rect
                x={x}
                y={0}
                width={1}
                height={height}
                fill="none"
                stroke={GRID}
                strokeWidth={1}
              />
              <text x={x} y={12} fill={AXIS} fontSize={12} textAnchor="middle">
                {Math.round((max * step) / 4)}
              </text>
            </g>
          );
        })}
        {rows.map((row, index) => {
          const y = 16 + index * rowHeight;
          const missing = row.count === null;
          const hidden = row.count === "<5";
          const portion = missing || hidden ? 0.12 : (row.count as number) / max;
          const barWidth = missing ? 0 : Math.max(2, portion * (plotWidth - 8));
          return (
            <g key={row.label}>
              <text x={0} y={y + 12} fill={AXIS} fontSize={12}>
                {row.label}
              </text>
              {missing ? null : (
                <rect
                  data-count={hidden ? "hidden" : "shown"}
                  x={labelWidth}
                  y={y}
                  width={barWidth}
                  height={14}
                  fill={GOLD}
                />
              )}
              <text
                x={width}
                y={y + 12}
                fill={AXIS}
                fontSize={12}
                textAnchor="end"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {missing ? "Not collected" : show(row.count)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
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
                <td key={`${columns[cellIndex]}-${cell}-${index}`} className="px-2 py-2 text-fg">
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

function RoomTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: string[][];
}) {
  const [rest, setRest] = useState(false);
  const shown = rest ? rows : rows.slice(0, ROOM_PAGE);
  return (
    <div>
      <CountTable caption={caption} columns={columns} rows={shown} />
      {rows.length > ROOM_PAGE ? (
        <button
          type="button"
          className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-fg"
          onClick={() => setRest(!rest)}
        >
          {rest ? "Show fewer rooms" : `Show the rest (${rows.length - ROOM_PAGE})`}
        </button>
      ) : null}
    </div>
  );
}

function IntentFacts({ stats }: { stats: StatsPayload }) {
  return (
    <dl className="mb-3 grid gap-2 text-sm text-fg">
      <div className="flex justify-between gap-4">
        <dt>At an in-person gathering this month</dt>
        <dd className="font-semibold tabular-nums">{inPerson(stats)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt>Active in two or more rooms</dt>
        <dd className="font-semibold tabular-nums">{show(stats.intent.crossRoomMembers)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt>Vouches across rooms</dt>
        <dd className="font-semibold tabular-nums">{show(stats.intent.crossRoomVouches)}</dd>
      </div>
    </dl>
  );
}

function funnelSummary(steps: FunnelStep[]): string {
  return seriesSummary(
    "Invites",
    steps.flatMap((step) =>
      step.count === null ? [] : [{ label: step.label, count: step.count }],
    ),
  );
}

function numericRows(rows: Bar[]): { label: string; count: ShownCount }[] {
  return rows.flatMap((row) =>
    row.count === null ? [] : [{ label: row.label, count: row.count }],
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

const choiceOn =
  "inline-flex min-h-[44px] items-center rounded-md bg-signal px-3 text-sm font-semibold text-signal-ink";
const choiceOff =
  "inline-flex min-h-[44px] items-center rounded-md border border-line bg-surface px-3 text-sm font-semibold text-fg";

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
