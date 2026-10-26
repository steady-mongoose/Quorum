/** Counts an admin may see. A count under 5 is hidden. No member is named. */

export const SMALL_COUNT = 5;

export type ShownCount = number | "<5";

export type StatsTile = {
  id: "dau" | "wau" | "mau" | "joins";
  label: string;
  value: ShownCount | null;
};

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
  tiles: [StatsTile, StatsTile, StatsTile, StatsTile];
  joins: DayCount[];
  active: ActiveDay[];
  roll: RollDay[];
  rooms: {
    weeks: TotalWeek[];
    rows: RoomWeek[];
    steady: ShownCount | null;
  };
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
  const record = value as { tiles?: unknown; intent?: unknown };
  if (!Array.isArray(record.tiles) || record.tiles.length !== 4) return false;
  const intent = record.intent;
  return Boolean(intent && typeof intent === "object" && "attendance" in intent);
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (/[",\n]/.test(guarded)) return `"${guarded.replaceAll('"', '""')}"`;
  return guarded;
}

function csvLine(cells: (string | number | null)[]): string {
  return cells.map(csvCell).join(",");
}

/** The same numbers the page shows, including hidden small counts. */
export function toStatsCsv(stats: StatsPayload): string {
  const lines = [csvLine(["section", "date", "metric", "dimension", "value"])];
  for (const tile of stats.tiles) {
    lines.push(csvLine(["summary", stats.asOf, tile.label, "", tile.value]));
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
    lines.push(csvLine(["rooms", row.week, "posts", "", row.posts]));
    lines.push(csvLine(["rooms", row.week, "gatherings", "", row.gatherings]));
  }
  lines.push(csvLine(["rooms", stats.asOf, "rooms_steady", "", stats.rooms.steady]));
  for (const row of stats.rooms.rows) {
    lines.push(csvLine(["rooms", row.week, "posts", row.room, row.posts]));
    lines.push(csvLine(["rooms", row.week, "gatherings", row.room, row.gatherings]));
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
