/** Counts an admin may see. A count under 5 is hidden. No member is named. */

export const SMALL_COUNT = 5;

export type ShownCount = number | "<5";

/** A published count, with whether a number was rounded to protect a small one. */
export type ProtectedCount = { value: ShownCount; approx: boolean };

export type StatsTile = {
  id: "members" | "invites" | "rooms" | "gatherings";
  label: string;
  value: ShownCount | null;
  /** True when value is a number rounded to protect a small count. */
  approx?: boolean;
  /** Displayed current minus displayed prior. Null when either side is hidden. */
  change: number | null;
};

export const STATS_DAYS = [7, 30, 90] as const;

export type StatsDays = (typeof STATS_DAYS)[number];

/** The seven browse categories. Uncategorized stays off this list until 0021. */
export const STATS_CATEGORIES = [
  { id: "churches", label: "Churches" },
  { id: "discussion", label: "Discussion" },
  { id: "men", label: "Men" },
  { id: "women", label: "Women" },
  { id: "business-trades", label: "Business & Trades" },
  { id: "civic", label: "Civic" },
  { id: "county", label: "County" },
] as const;

/** Rooms not yet given a category. Always listed last, under a plain label. */
export const UNSORTED_CATEGORY = { id: "uncategorized", label: "Not yet sorted" } as const;

export type CategoryCount = { id: string; label: string; count: ShownCount };

export type FunnelStep = {
  id: "sent" | "opened" | "accepted" | "first";
  label: string;
  count: ShownCount | null;
};

export type StatsAlerts = { reports: number; health: "ok" | "down" };

export type DayCount = { date: string; count: ShownCount };

export type ActiveDay = {
  date: string;
  dau: ShownCount;
  wau: ShownCount;
  mau: ShownCount;
};

export type RollDay = {
  date: string;
  roll: ShownCount;
  attendance: ShownCount;
};

export type TotalWeek = {
  week: string;
  posts: ShownCount;
  gatherings: ShownCount;
  /** True when that total is rounded to protect a small room count. */
  postsApprox?: boolean;
  gatheringsApprox?: boolean;
};

export type RoomWeek = {
  week: string;
  room: string;
  posts: ShownCount;
  gatherings: ShownCount;
};

export type FeatureUse = {
  group: string;
  label: string;
  count: ShownCount;
};

export type StatsPayload = {
  asOf: string | null;
  days: StatsDays;
  category: string;
  /** Every category the filter can name, including ones an admin added. */
  categories?: { id: string; label: string }[];
  tiles: [StatsTile, StatsTile, StatsTile, StatsTile];
  joins: DayCount[];
  active: ActiveDay[];
  roll: RollDay[];
  rooms: {
    weeks: TotalWeek[];
    rows: RoomWeek[];
    steady: ShownCount | null;
  };
  roomsByCategory: CategoryCount[];
  funnel: FunnelStep[];
  alerts: StatsAlerts;
  features: FeatureUse[];
  mostUsed: string | null;
  leastUsed: string | null;
  intent: {
    attendance: DayCount[];
    rsvpNote: string;
    inPersonCount: ShownCount | null;
    inPersonPercent: number | null;
    crossRoomMembers: ShownCount | null;
    crossRoomVouches: ShownCount | null;
  };
};

export const RSVP_NOTE =
  "The going list stays on each member's board. It is not collected, so there is no RSVP count. Attendance is the host's roll.";

export function showCount(count: number): ShownCount {
  if (!Number.isFinite(count) || count < SMALL_COUNT) return "<5";
  return Math.trunc(count);
}

/** Nearest 5. A published total then no longer equals the hidden part plus the visible ones. */
export function roundToFive(count: number): number {
  return Math.round(count / 5) * 5;
}

/**
 * Small-cell rules. By default every count under 5 is a small cell, zero
 * included. With `emptyShown`, an empty bucket (0) names no one: it is shown
 * as 0 and left out of suppression, so a "<5" cell is known to hold 1 to 4 and
 * the leak checks reason over that range. Category breakdowns use it, so an
 * empty no-category bucket does not hide a full total.
 */
export type BreakdownRule = { emptyShown?: boolean };

function isSmallCell(part: number, rule: BreakdownRule = {}): boolean {
  return part < SMALL_COUNT && !(rule.emptyShown && part <= 0);
}

export function protectBreakdown(
  parts: number[],
  rule: BreakdownRule = {},
): { parts: ShownCount[]; total: ShownCount; approx: boolean } {
  const total = parts.reduce((sum, part) => sum + part, 0);
  const shownParts = parts.map((part) => (rule.emptyShown && part === 0 ? 0 : showCount(part)));
  if (!parts.some((part) => isSmallCell(part, rule))) {
    return { parts: shownParts, total: showCount(total), approx: false };
  }
  if (!roundedTotalIsSafe(parts, rule)) return { parts: shownParts, total: "<5", approx: false };
  return { parts: shownParts, total: roundToFive(total), approx: true };
}

/**
 * Whether a rounded total may be published. The answer uses only what is
 * already public: the shown cells and how many cells are hidden. It never
 * looks at the hidden values, so a "<5" total says nothing about them. It is
 * true only when every possible set of hidden values would round to a total of
 * 5 or more that pins no hidden cell. Then any published total leaves each
 * hidden cell at least two possible values.
 */
export function roundedTotalIsSafe(
  parts: number[],
  rule: BreakdownRule = {},
  knownExtra = 0,
): boolean {
  const hidden = parts.filter((part) => isSmallCell(part, rule)).length;
  if (hidden === 0) return true;
  const visible =
    knownExtra + parts.reduce((sum, part) => sum + (isSmallCell(part, rule) ? 0 : part), 0);
  const low = rule.emptyShown ? 1 : 0;
  for (let rest = hidden * low; rest <= hidden * (SMALL_COUNT - 1); rest += 1) {
    const rounded = roundToFive(visible + rest);
    if (rounded < SMALL_COUNT) return false;
    const ranges = rangesFor(visible, hidden, rounded, rule);
    if (ranges.length === 0 || ranges.some(([a, b]) => a >= b)) return false;
  }
  return true;
}

/**
 * A total published next to a table whose cells add up to part of it. Anything
 * in the total beyond the cells (`total - sum(cells)`) is treated as known to
 * the reader, the worst case. When any cell is hidden the total is rounded to
 * 5, or hidden when even a rounded total could pin a cell, so subtracting the
 * shown cells cannot recover a hidden one. An empty cell (0) names no one, as
 * with category buckets, so a total that only shows a cell was empty stays exact.
 */
export function protectTotalOverCells(total: number, cells: number[]): ProtectedCount {
  const rule = { emptyShown: true } as const;
  if (!cells.some((cell) => isSmallCell(cell, rule))) {
    return { value: showCount(total), approx: false };
  }
  const extra = Math.max(0, total - cells.reduce((sum, cell) => sum + cell, 0));
  if (!roundedTotalIsSafe(cells, rule, extra)) return { value: "<5", approx: false };
  const rounded = roundToFive(total);
  return rounded < SMALL_COUNT ? { value: "<5", approx: false } : { value: rounded, approx: true };
}

/**
 * True when the published total pins any hidden cell to one value. All hidden
 * cells are considered together: each lies in [low, 4] (low is 1 when zeros are
 * shown as 0, else 0), and their sum is whatever the rounded total allows once
 * the visible cells are taken out. A cell leaks when its feasible range is a
 * single value, or when no assignment fits at all.
 */
export function hiddenCellLeaks(
  parts: number[],
  publishedTotal: number,
  rule: BreakdownRule = {},
): boolean {
  const hidden = parts.filter((part) => isSmallCell(part, rule)).length;
  if (hidden === 0) return false;
  const ranges = hiddenCellRanges(parts, publishedTotal, rule);
  return ranges.length === 0 || ranges.some(([low, high]) => low >= high);
}

/**
 * The range each hidden cell can still take, given the published total and the
 * visible cells. Every hidden cell shares the same range. Empty when nothing fits.
 */
export function hiddenCellRanges(
  parts: number[],
  publishedTotal: number,
  rule: BreakdownRule = {},
): Array<[number, number]> {
  const hidden = parts.filter((part) => isSmallCell(part, rule)).length;
  if (hidden === 0) return [];
  const visible = parts.reduce((sum, part) => sum + (isSmallCell(part, rule) ? 0 : part), 0);
  return rangesFor(visible, hidden, publishedTotal, rule);
}

function rangesFor(
  visible: number,
  hidden: number,
  publishedTotal: number,
  rule: BreakdownRule,
): Array<[number, number]> {
  const low = rule.emptyShown ? 1 : 0;
  const high = SMALL_COUNT - 1;
  let sumLow = Number.POSITIVE_INFINITY;
  let sumHigh = Number.NEGATIVE_INFINITY;
  for (let total = Math.max(0, publishedTotal - 2); total <= publishedTotal + 2; total += 1) {
    if (roundToFive(total) !== publishedTotal) continue;
    const rest = total - visible;
    if (rest < hidden * low || rest > hidden * high) continue;
    sumLow = Math.min(sumLow, rest);
    sumHigh = Math.max(sumHigh, rest);
  }
  if (sumLow > sumHigh) return [];
  const cellLow = Math.max(low, sumLow - (hidden - 1) * high);
  const cellHigh = Math.min(high, sumHigh - (hidden - 1) * low);
  return Array.from({ length: hidden }, () => [cellLow, cellHigh] as [number, number]);
}

/**
 * Values an attacker can still assign to the one hidden cell.
 * An empty set means the published total does not give that cell away.
 */
export function recoverableHidden(
  parts: number[],
  publishedTotal: ShownCount,
  rule: BreakdownRule = {},
): number[] {
  const hidden = parts.filter((part) => isSmallCell(part, rule));
  if (hidden.length !== 1 || typeof publishedTotal !== "number") return [];
  const visible = parts.reduce((sum, part) => sum + (isSmallCell(part, rule) ? 0 : part), 0);
  const possible: number[] = [];
  const lowest = rule.emptyShown ? 1 : 0;
  for (let total = Math.max(0, publishedTotal - 2); total <= publishedTotal + 2; total += 1) {
    if (roundToFive(total) !== publishedTotal) continue;
    const rest = total - visible;
    if (rest >= lowest && rest < SMALL_COUNT) possible.push(rest);
  }
  return possible;
}

export function shownChange(current: ShownCount | null, prior: ShownCount | null): number | null {
  if (typeof current !== "number" || typeof prior !== "number") return null;
  return current - prior;
}

export function parseStatsQuery(params: URLSearchParams): { days: StatsDays; category: string } {
  const daysRaw = Number(params.get("days"));
  const days: StatsDays = daysRaw === 7 || daysRaw === 30 || daysRaw === 90 ? daysRaw : 30;
  const raw = params.get("category")?.trim() || "all";
  const category = raw === "all" || STATS_CATEGORIES.some((item) => item.id === raw) ? raw : "all";
  return { days, category };
}

export function seriesSummary(noun: string, rows: { label: string; count: ShownCount }[]): string {
  const numbers = rows.flatMap((row) =>
    typeof row.count === "number" ? [{ label: row.label, count: row.count }] : [],
  );
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  if (!first || !last) return `${noun} in this window are under 5.`;
  const peak = numbers.reduce((best, row) => (row.count > best.count ? row : best));
  const verb = last.count >= first.count ? "rose" : "fell";
  return `${noun} ${verb} from ${first.count} to ${last.count} over ${first.label}–${last.label}; peak ${peak.count} on ${peak.label}.`;
}

/** Whole percent, only when the people counted are at least 5. */
export function showPercent(part: number, whole: number): number | null {
  if (part < SMALL_COUNT || whole < SMALL_COUNT || whole < part) return null;
  return Math.round((part / whole) * 100);
}

export function endpointLabel(group: string): string {
  switch (group) {
    case "board":
      return "Board";
    case "gatherings":
      return "Gatherings";
    case "groups":
      return "Groups";
    case "chat":
      return "Room chat";
    case "messages":
      return "Messages";
    case "media":
      return "Pictures";
    case "calls":
      return "Calls";
    case "invites":
      return "Invites";
    case "admin":
      return "Stats";
    default:
      return "Other";
  }
}

/**
 * Which product surface an API path belongs to.
 * Session checks are not a surface. Anything else under /api is "other".
 */
export function endpointGroup(pathname: string): string | null {
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return null;
  if (/^\/api\/rooms\/[^/]+\/chat(?:\/|$)/.test(pathname)) return "chat";
  if (
    pathname === "/api/board" ||
    pathname.startsWith("/api/board/") ||
    pathname === "/api/rooms" ||
    pathname.startsWith("/api/rooms/") ||
    pathname === "/api/posts" ||
    pathname.startsWith("/api/posts/") ||
    pathname === "/api/appeals" ||
    pathname.startsWith("/api/appeals/") ||
    pathname === "/api/home" ||
    pathname === "/api/place" ||
    pathname === "/api/room-requests" ||
    pathname.startsWith("/api/room-requests/") ||
    pathname === "/api/zips" ||
    pathname === "/api/access" ||
    pathname === "/api/bans" ||
    pathname === "/api/csam-holds" ||
    pathname.startsWith("/api/csam-holds/")
  ) {
    return "board";
  }
  if (
    pathname === "/api/gatherings" ||
    pathname.startsWith("/api/gatherings/") ||
    pathname === "/api/e" ||
    pathname.startsWith("/api/e/") ||
    pathname.startsWith("/e/")
  ) {
    return "gatherings";
  }
  if (
    pathname === "/api/groups" ||
    pathname.startsWith("/api/groups/") ||
    pathname === "/api/group-requests" ||
    pathname.startsWith("/api/group-requests/") ||
    pathname === "/api/group-appeals" ||
    pathname.startsWith("/api/group-appeals/")
  ) {
    return "groups";
  }
  if (pathname === "/api/dm" || pathname.startsWith("/api/dm/")) return "messages";
  if (pathname === "/api/media" || pathname.startsWith("/api/media/")) return "media";
  if (pathname === "/api/calls" || pathname.startsWith("/api/calls/")) return "calls";
  if (pathname === "/api/invites" || pathname === "/api/invite-log" || pathname === "/api/signup") {
    return "invites";
  }
  if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) return "admin";
  if (pathname.startsWith("/api/")) return "other";
  return null;
}

export function isStatsPayload(value: unknown): value is StatsPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as { tiles?: unknown; funnel?: unknown; alerts?: unknown };
  if (!Array.isArray(record.tiles) || record.tiles.length !== 4) return false;
  if (!Array.isArray(record.funnel)) return false;
  return Boolean(record.alerts && typeof record.alerts === "object");
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (/[",\n]/.test(guarded)) return `"${guarded.replaceAll('"', '""')}"`;
  return guarded;
}

/** A rounded count keeps its "~" in the csv, so it is not read as exact. */
function approxCell(value: ShownCount | null, approx: boolean | undefined): string | number | null {
  return approx && typeof value === "number" ? `~${value}` : value;
}

function csvLine(cells: (string | number | null)[]): string {
  return cells.map(csvCell).join(",");
}

/** The same numbers the page shows, including hidden small counts. */
export function toStatsCsv(stats: StatsPayload): string {
  const lines = [csvLine(["section", "date", "metric", "dimension", "value"])];
  lines.push(csvLine(["filter", "", "days", String(stats.days), ""]));
  lines.push(csvLine(["filter", "", "category", stats.category, ""]));
  for (const tile of stats.tiles) {
    lines.push(
      csvLine(["summary", stats.asOf, tile.label, "", approxCell(tile.value, tile.approx)]),
    );
    lines.push(csvLine(["summary", stats.asOf, `${tile.label} change`, "", tile.change]));
  }
  for (const row of stats.joins) lines.push(csvLine(["joins", row.date, "joins", "", row.count]));
  for (const row of stats.active) {
    lines.push(csvLine(["active", row.date, "dau", "", row.dau]));
    lines.push(csvLine(["active", row.date, "wau", "", row.wau]));
    lines.push(csvLine(["active", row.date, "mau", "", row.mau]));
  }
  for (const row of stats.roll) {
    lines.push(csvLine(["roll", row.date, "roll", "", row.roll]));
    lines.push(csvLine(["roll", row.date, "attendance", "", row.attendance]));
  }
  for (const row of stats.rooms.weeks) {
    lines.push(csvLine(["rooms", row.week, "posts", "", approxCell(row.posts, row.postsApprox)]));
    lines.push(
      csvLine([
        "rooms",
        row.week,
        "gatherings",
        "",
        approxCell(row.gatherings, row.gatheringsApprox),
      ]),
    );
  }
  lines.push(csvLine(["rooms", stats.asOf, "rooms_steady", "", stats.rooms.steady]));
  for (const row of stats.rooms.rows) {
    lines.push(csvLine(["rooms", row.week, "posts", row.room, row.posts]));
    lines.push(csvLine(["rooms", row.week, "gatherings", row.room, row.gatherings]));
  }
  for (const row of stats.roomsByCategory) {
    lines.push(csvLine(["categories", "", "rooms", row.label, row.count]));
  }
  for (const step of stats.funnel) {
    lines.push(csvLine(["funnel", "", step.id, step.label, step.count]));
  }
  for (const row of stats.features) {
    lines.push(csvLine(["features", "", row.group, row.label, row.count]));
  }
  lines.push(csvLine(["features", "", "most", stats.mostUsed, ""]));
  lines.push(csvLine(["features", "", "least", stats.leastUsed, ""]));
  for (const row of stats.intent.attendance) {
    lines.push(csvLine(["intent", row.date, "attendance", "", row.count]));
  }
  lines.push(csvLine(["intent", stats.asOf, "in_person", "", stats.intent.inPersonCount]));
  lines.push(
    csvLine(["intent", stats.asOf, "in_person_percent", "", stats.intent.inPersonPercent]),
  );
  lines.push(
    csvLine(["intent", stats.asOf, "cross_room_members", "", stats.intent.crossRoomMembers]),
  );
  lines.push(
    csvLine(["intent", stats.asOf, "cross_room_vouches", "", stats.intent.crossRoomVouches]),
  );
  return `${lines.join("\n")}\n`;
}
