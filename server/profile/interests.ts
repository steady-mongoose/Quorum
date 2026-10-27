/** Fixed interests. A member picks from this list. It is not a score or a badge. */

export const INTERESTS = [
  { id: "woodworking", label: "Woodworking" },
  { id: "gardening", label: "Gardening" },
  { id: "brewing", label: "Brewing" },
  { id: "distilling", label: "Distilling" },
  { id: "books", label: "Books" },
  { id: "radio", label: "Radio" },
  { id: "lifting", label: "Lifting" },
  { id: "cooking", label: "Cooking" },
  { id: "hunting", label: "Hunting" },
  { id: "fishing", label: "Fishing" },
  { id: "trades", label: "Trades" },
  { id: "history", label: "History" },
  { id: "music", label: "Music" },
  { id: "homeschool", label: "Homeschool" },
] as const;

export type InterestId = (typeof INTERESTS)[number]["id"];

export const MAX_INTERESTS = 12;

const IDS = new Set<string>(INTERESTS.map((item) => item.id));

export function interestLabel(id: string): string {
  return INTERESTS.find((item) => item.id === id)?.label ?? id;
}

export function parseInterests(
  value: unknown,
): { ok: true; ids: InterestId[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "Choose interests from the list." };
  if (value.length > MAX_INTERESTS) return { ok: false, error: "Choose at most 12 interests." };
  const ids: InterestId[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !IDS.has(item)) {
      return { ok: false, error: "Choose interests from the list." };
    }
    const id = item as InterestId;
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, ids };
}
