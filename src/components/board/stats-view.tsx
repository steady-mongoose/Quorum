import { useState, type ReactNode } from "react";
import {
  STATS_CATEGORIES,
  UNSORTED_CATEGORY,
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
const CHART_IDS = [
  "stats-rooms",
  "stats-invites",
  "stats-joins",
  "stats-rolls",
  "stats-attendance",
  "stats-posts",
  "stats-gatherings",
  "stats-active-members",
  "stats-features",
  "stats-intent",
].join(" ");

type Bar = { label: string; count: ShownCount | null; approx?: boolean };

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
  const [table, setTable] = useState(false);
  const categories = stats.categories?.length ? stats.categories : STATS_CATEGORIES;
  const selectedLabel =
    category === "all" ? "All" : (categories.find((item) => item.id === category)?.label ?? "All");
  const roomRows = [...stats.rooms.rows].sort(
    (a, b) => a.room.localeCompare(b.room) || a.week.localeCompare(b.week),
  );
  return (
    <>
      <Alerts alerts={stats.alerts} />
      <div className="col-span-12 flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
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
              className="min-h-[44px] w-full max-w-full truncate rounded-md border border-line bg-surface px-3 text-fg sm:w-auto sm:max-w-[20rem]"
              value={category}
              title={selectedLabel}
              aria-label="Category"
              onChange={(event) => onCategory(event.target.value)}
            >
              <option value="all">All</option>
              {categories
                .filter((item) => item.id !== UNSORTED_CATEGORY.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              {categories.some((item) => item.id === UNSORTED_CATEGORY.id) ? (
                <>
                  <hr />
                  <option value={UNSORTED_CATEGORY.id}>{UNSORTED_CATEGORY.label}</option>
                </>
              ) : null}
            </select>
          </label>
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center rounded-md border border-line px-3 text-sm font-semibold text-fg"
            aria-expanded={table}
            aria-controls={CHART_IDS}
            onClick={() => setTable(!table)}
          >
            {table ? "View as chart" : "View as table"}
          </button>
        </div>
        <p className="max-w-prose text-[0.85rem] text-muted">
          Category shows only rooms in that category and their gatherings. A room in more than one
          category appears under each, but totals count it once.
        </p>
        {anyProtected(stats) ? (
          <p className="max-w-prose text-[0.85rem] text-muted">
            Small counts are rounded to protect privacy.
          </p>
        ) : null}
      </div>

      {stats.tiles.map((tile) => (
        <article
          key={tile.id}
          className="col-span-6 min-w-0 rounded-lg border border-line bg-surface p-6 lg:col-span-3"
        >
          <p className="text-[0.85rem] tracking-[.04em] text-muted">{tile.label}</p>
          <p className="mt-2 font-display text-[2.5rem] leading-none text-fg tabular-nums">
            <ShownValue value={tile.value} approx={tile.approx} />
          </p>
          <ChangeLine change={tile.change} approx={tile.changeApprox} days={days} />
        </article>
      ))}

      <ChartCard
        id="stats-rooms"
        showTable={table}
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
            rows={stats.roomsByCategory.map((row) => [row.label, cell(row.count)])}
          />
        }
      />
      <ChartCard
        id="stats-invites"
        showTable={table}
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
              step.count === null ? "Not collected" : cell(step.count),
            ])}
          />
        }
      />

      <ChartCard
        id="stats-joins"
        showTable={table}
        title="Joins"
        chart={
          <LineChart
            label="Joins over time"
            noun="Joins"
            rows={stats.joins.map((row) => ({ label: shortDay(row.date), count: row.count }))}
          />
        }
        table={
          <CountTable
            caption="Joins over time"
            columns={["Date", "Joins"]}
            rows={stats.joins.map((row) => [formatDay(row.date), cell(row.count)])}
          />
        }
      />
      <ChartCard
        id="stats-rolls"
        showTable={table}
        title="Rolls"
        chart={
          <LineChart
            label="Rolls filed"
            noun="Rolls"
            rows={stats.roll.map((row) => ({ label: shortDay(row.date), count: row.roll }))}
          />
        }
        table={
          <CountTable
            caption="Rolls filed"
            columns={["Date", "Rolls"]}
            rows={stats.roll.map((row) => [formatDay(row.date), cell(row.roll)])}
          />
        }
      />
      <ChartCard
        id="stats-attendance"
        showTable={table}
        title="Attendance"
        chart={
          <LineChart
            label="Attendance"
            noun="Attendance"
            rows={stats.roll.map((row) => ({ label: shortDay(row.date), count: row.attendance }))}
          />
        }
        table={
          <CountTable
            caption="Attendance"
            columns={["Date", "Attendance"]}
            rows={stats.roll.map((row) => [formatDay(row.date), cell(row.attendance)])}
          />
        }
      />
      <ChartCard
        id="stats-posts"
        showTable={table}
        title="Posts"
        note={`Rooms that met in at least 3 of the last 4 weeks: ${words(stats.rooms.steady)}`}
        chart={
          <LineChart
            label="Posts per week"
            noun="Posts"
            rows={stats.rooms.weeks.map((row) => ({
              label: shortDay(row.week),
              count: row.posts,
              approx: row.postsApprox,
            }))}
          />
        }
        table={
          <RoomTable
            caption="Posts per room per week"
            columns={["Room", "Week", "Posts"]}
            rows={roomRows.map((row) => [row.room, formatDay(row.week), cell(row.posts)])}
          />
        }
      />
      <ChartCard
        id="stats-gatherings"
        showTable={table}
        title="Gatherings"
        chart={
          <LineChart
            label="Gatherings per week"
            noun="Gatherings"
            rows={stats.rooms.weeks.map((row) => ({
              label: shortDay(row.week),
              count: row.gatherings,
              approx: row.gatheringsApprox,
            }))}
          />
        }
        table={
          <RoomTable
            caption="Gatherings per room per week"
            columns={["Room", "Week", "Gatherings"]}
            rows={roomRows.map((row) => [row.room, formatDay(row.week), cell(row.gatherings)])}
          />
        }
      />

      <div className="col-span-12 mt-8">
        <h2 className="text-2xl text-fg">More counts</h2>
      </div>
      <ActiveMembers stats={stats} showTable={table} />
      <ChartCard
        id="stats-features"
        showTable={table}
        title="Features"
        note={featureNote(stats.mostUsed, stats.leastUsed)}
        chart={
          <HorizontalBars
            label="Feature use by endpoint group"
            summary={seriesSummary(
              "Uses",
              stats.features.map((row) => ({ label: row.label, count: row.count })),
            )}
            rows={stats.features.map((row) => ({ label: row.label, count: row.count }))}
          />
        }
        table={
          <CountTable
            caption="Feature use"
            columns={["Feature", "Uses"]}
            rows={stats.features.map((row) => [row.label, cell(row.count)])}
          />
        }
      />
      <ChartCard
        id="stats-intent"
        showTable={table}
        title="Intent"
        note={stats.intent.rsvpNote}
        extra={<IntentFacts stats={stats} />}
        chart={
          <LineChart
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
            rows={stats.intent.attendance.map((row) => [formatDay(row.date), cell(row.count)])}
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

function ChangeLine({
  change,
  approx,
  days,
}: {
  change: number | null;
  approx?: boolean;
  days: StatsDays;
}) {
  if (change === null) {
    return (
      <p className="mt-2 text-[0.85rem] text-muted tabular-nums">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Change not shown</span>
      </p>
    );
  }
  if (change === 0) {
    return (
      <p className="mt-2 text-[0.85rem] text-muted tabular-nums">
        {approx ? "About the same" : "No change"}
      </p>
    );
  }
  const up = change > 0;
  const abs = Math.abs(change);
  return (
    <p className="mt-2 text-[0.85rem] text-muted tabular-nums">
      <span aria-hidden="true">
        {up ? "▲" : "▼"} {approx ? "~" : ""}
        {abs} vs prior {days} days
      </span>
      <span className="sr-only">
        {up ? "Up" : "Down"} {approx ? "about " : ""}
        {abs} versus prior {days} days
      </span>
    </p>
  );
}

function ActiveMembers({ stats, showTable }: { stats: StatsPayload; showTable: boolean }) {
  const series = [
    {
      name: "That day",
      noun: "Members that day",
      rows: stats.active.map((row) => ({ label: shortDay(row.date), count: row.dau })),
    },
    {
      name: "7 days",
      noun: "Members in 7 days",
      rows: stats.active.map((row) => ({ label: shortDay(row.date), count: row.wau })),
    },
    {
      name: "30 days",
      noun: "Members in 30 days",
      rows: stats.active.map((row) => ({ label: shortDay(row.date), count: row.mau })),
    },
  ];
  return (
    <section
      id="stats-active-members"
      className="col-span-12 min-w-0 rounded-lg border border-line bg-surface p-6 lg:col-span-6"
    >
      <h2 id={titleId("Active members")} className="mb-3 text-2xl text-fg">
        Active members
      </h2>
      {showTable ? (
        <CountTable
          caption="Active members"
          columns={["Date", "That day", "7 days", "30 days"]}
          rows={stats.active.map((row) => [
            formatDay(row.date),
            cell(row.dau),
            cell(row.wau),
            cell(row.mau),
          ])}
        />
      ) : (
        <LabelledLines label="Active members" series={series} />
      )}
    </section>
  );
}

function ChartCard({
  id,
  title,
  note,
  extra,
  chart,
  table,
  showTable,
}: {
  id: string;
  title: string;
  note?: string;
  extra?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  showTable: boolean;
}) {
  return (
    <section
      id={id}
      className="col-span-12 min-w-0 rounded-lg border border-line bg-surface p-6 lg:col-span-6"
    >
      <h2 id={titleId(title)} className="mb-3 text-2xl text-fg">
        {title}
      </h2>
      {note ? <p className="mb-3 max-w-prose text-sm text-muted">{note}</p> : null}
      {extra}
      {showTable ? table : chart}
    </section>
  );
}

type PlotPoint = { x: number; y: number; hidden: boolean; label: string };

function plotPoints(rows: Bar[], max: number, geometry: PlotGeometry): PlotPoint[] {
  return rows.map((row, index) => {
    const hidden = row.count === "<5" || row.count === null;
    const portion = hidden ? 0.12 : (row.count as number) / max;
    const y = 8 + geometry.plotHeight - Math.max(2, portion * geometry.plotHeight);
    const x = geometry.left + index * geometry.group + geometry.group / 2;
    return { x, y, hidden, label: row.label };
  });
}

type PlotGeometry = {
  width: number;
  height: number;
  left: number;
  plotWidth: number;
  plotHeight: number;
  group: number;
};

function plotGeometry(count: number, right = 8): PlotGeometry {
  const width = 640;
  const height = 180;
  const left = 36;
  const bottom = 28;
  const plotWidth = width - left - right;
  const plotHeight = height - bottom - 8;
  return { width, height, left, plotWidth, plotHeight, group: plotWidth / Math.max(count, 1) };
}

function GridLines({ max, geometry }: { max: number; geometry: PlotGeometry }) {
  return (
    <>
      {[1, 2, 3, 4].map((step) => {
        const y = 8 + geometry.plotHeight - (geometry.plotHeight * step) / 4;
        return (
          <g key={step}>
            <rect
              x={geometry.left}
              y={y}
              width={geometry.plotWidth}
              height={1}
              fill="none"
              stroke={GRID}
              strokeWidth={1}
            />
            <text x={geometry.left - 6} y={y + 4} fill={AXIS} fontSize={12} textAnchor="end">
              {Math.round((max * step) / 4)}
            </text>
          </g>
        );
      })}
    </>
  );
}

function AxisDates({ rows, geometry }: { rows: Bar[]; geometry: PlotGeometry }) {
  return (
    <>
      <text x={geometry.left} y={geometry.height - 6} fill={AXIS} fontSize={12}>
        {rows[0]?.label}
      </text>
      {rows.length > 1 ? (
        <text
          x={geometry.left + geometry.plotWidth}
          y={geometry.height - 6}
          fill={AXIS}
          fontSize={12}
          textAnchor="end"
        >
          {rows[rows.length - 1]?.label}
        </text>
      ) : null}
    </>
  );
}

function LineChart({ label, noun, rows }: { label: string; noun: string; rows: Bar[] }) {
  const plot = rows.flatMap((row) => (typeof row.count === "number" ? [row] : []));
  if (rows.length === 0) return <p className="text-sm text-muted">Nothing in this window.</p>;
  const max = Math.max(5, ...plot.map((row) => row.count as number));
  const geometry = plotGeometry(rows.length);
  const points = plotPoints(rows, max, geometry);
  return (
    <figure className="min-w-0">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        className="h-44 w-full"
      >
        <GridLines max={max} geometry={geometry} />
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={GOLD}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {points.map((point, index) => (
          <circle
            key={`${point.label}-${index}`}
            data-count={point.hidden ? "hidden" : "shown"}
            cx={point.x}
            cy={point.y}
            r={2.5}
            fill={GOLD}
          />
        ))}
        <AxisDates rows={rows} geometry={geometry} />
      </svg>
      <figcaption className="sr-only">{seriesSummary(noun, numericRows(rows))}</figcaption>
    </figure>
  );
}

function LabelledLines({
  label,
  series,
}: {
  label: string;
  series: { name: string; noun: string; rows: Bar[] }[];
}) {
  const rows = series[0]?.rows ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted">Nothing in this window.</p>;
  const max = Math.max(
    5,
    ...series.flatMap((item) =>
      item.rows.flatMap((row) => (typeof row.count === "number" ? [row.count] : [])),
    ),
  );
  const geometry = plotGeometry(rows.length, 88);
  return (
    <figure className="min-w-0">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        className="h-44 w-full"
      >
        <GridLines max={max} geometry={geometry} />
        {series.map((item) => {
          const points = plotPoints(item.rows, max, geometry);
          const last = points[points.length - 1];
          return (
            <g key={item.name}>
              <polyline
                points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke={GOLD}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              >
                <title>{item.name}</title>
              </polyline>
              {last ? (
                <text
                  x={geometry.left + geometry.plotWidth + 8}
                  y={last.y + 4}
                  fill={AXIS}
                  fontSize={12}
                >
                  {item.name}
                </text>
              ) : null}
            </g>
          );
        })}
        <AxisDates rows={rows} geometry={geometry} />
      </svg>
      <figcaption className="sr-only">
        {series.map((item) => seriesSummary(item.noun, numericRows(item.rows))).join(" ")}
      </figcaption>
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
                className="tabular-nums"
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
  rows: ReactNode[][];
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
            <tr key={`${String(row[0])}-${index}`} className="border-b border-line">
              {row.map((value, cellIndex) => (
                <td key={`${columns[cellIndex]}-${index}`} className="px-2 py-2 text-fg">
                  {value}
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
  rows: ReactNode[][];
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
        <dd className="font-semibold tabular-nums">
          <ShownValue value={stats.intent.crossRoomMembers} />
        </dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt>Vouches across rooms</dt>
        <dd className="font-semibold tabular-nums">
          <ShownValue value={stats.intent.crossRoomVouches} />
        </dd>
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

function numericRows(rows: Bar[]): { label: string; count: ShownCount; approx?: boolean }[] {
  return rows.flatMap((row) =>
    row.count === null ? [] : [{ label: row.label, count: row.count, approx: row.approx }],
  );
}

function show(value: ShownCount | number | null): string {
  if (value === null) return "—";
  return String(value);
}

/** A count in words, for sentences: "<5" reads as "fewer than 5". */
function words(value: ShownCount | number | null): string {
  if (value === "<5") return "fewer than 5";
  return show(value);
}

/**
 * A shown count. "<5" and a rounded "~20" keep their symbol on screen, but a
 * screen reader hears "fewer than 5" and "about 20".
 */
export function ShownValue({
  value,
  approx,
}: {
  value: ShownCount | number | null;
  approx?: boolean;
}) {
  if (value === null) return <>—</>;
  if (value === "<5") {
    return (
      <>
        <span aria-hidden="true">&lt;5</span>
        <span className="sr-only">fewer than 5</span>
      </>
    );
  }
  if (approx) {
    return (
      <>
        <span aria-hidden="true">~{value}</span>
        <span className="sr-only">about {value}</span>
      </>
    );
  }
  return <>{value}</>;
}

function cell(value: ShownCount | number | null, approx?: boolean): ReactNode {
  return <ShownValue value={value} approx={approx} />;
}

/** Whether any count on the page is rounded or hidden as "<5". */
function anyProtected(stats: StatsPayload): boolean {
  if (stats.tiles.some((tile) => tile.approx || tile.changeApprox)) return true;
  if (stats.rooms.weeks.some((row) => row.postsApprox || row.gatheringsApprox)) return true;
  return JSON.stringify(stats).includes('"<5"');
}

function inPerson(stats: StatsPayload): ReactNode {
  if (stats.intent.inPersonPercent !== null) return `${stats.intent.inPersonPercent}%`;
  return <ShownValue value={stats.intent.inPersonCount} />;
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
