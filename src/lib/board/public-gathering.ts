import { hasStreetAddress, isEnglish } from "./text.ts";

/** The only fields a public gathering page may show. */
export type PublicGathering = {
  title: string;
  date: string;
  town: string;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const GATHERING_ID = /^[A-Za-z0-9-]{1,64}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isGatheringId(id: string): boolean {
  return GATHERING_ID.test(id);
}

/** A calendar date, or an empty string when the card has no next date. */
export function publicDateLabel(iso: string): string {
  const match = ISO_DATE.exec(iso);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/**
 * Keep a title, a date, and a town. A street, another script, or any other
 * field is refused. Sharing stays off unless the caller asks for it.
 */
export function acceptPublicGathering(input: {
  title: unknown;
  date: unknown;
  town: unknown;
}): { ok: true; gathering: PublicGathering } | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const date = typeof input.date === "string" ? input.date.trim() : "";
  const town = typeof input.town === "string" ? input.town.trim() : "";
  if (!title || title.length > 140 || !isEnglish(title) || hasStreetAddress(title)) {
    return { ok: false, error: "Give the gathering a title, without a street address." };
  }
  if (date && (!ISO_DATE.test(date) || !publicDateLabel(date))) {
    return { ok: false, error: "Use the gathering date as YYYY-MM-DD." };
  }
  if (town.length > 80 || !isEnglish(town) || hasStreetAddress(town) || /\baddress\b/i.test(town)) {
    return { ok: false, error: "The public page can name the town, not the street." };
  }
  return { ok: true, gathering: { title, date, town } };
}

/** Read a response and keep only the three public fields. */
export function readPublicGathering(value: unknown): PublicGathering | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const accepted = acceptPublicGathering({
    title: row.title,
    date: row.date,
    town: row.town,
  });
  return accepted.ok ? accepted.gathering : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** HTML for /e/<id>. A missing or unshared gathering is a 404. Both carry noindex. */
export function publicGatheringHtml(gathering: PublicGathering | null): {
  status: 200 | 404;
  body: string;
} {
  const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${gathering ? escapeHtml(gathering.title) : "Not found"}</title>
</head>
<body>
<main>`;
  if (!gathering) {
    return {
      status: 404,
      body: `${head}
<h1>This gathering is not shared.</h1>
</main>
</body>
</html>
`,
    };
  }
  const date = publicDateLabel(gathering.date);
  const dateLine = date
    ? `\n<p><time datetime="${escapeHtml(gathering.date)}">${escapeHtml(date)}</time></p>`
    : "";
  const townLine = gathering.town ? `\n<p>${escapeHtml(gathering.town)}</p>` : "";
  return {
    status: 200,
    body: `${head}
<h1>${escapeHtml(gathering.title)}</h1>${dateLine}${townLine}
</main>
</body>
</html>
`,
  };
}

/** JSON for the page. Only the three public fields, or a 404. */
export function publicGatheringJson(gathering: PublicGathering | null): {
  status: 200 | 404;
  body: PublicGathering | { error: "Not found." };
} {
  if (!gathering) return { status: 404, body: { error: "Not found." } };
  return { status: 200, body: { title: gathering.title, date: gathering.date, town: gathering.town } };
}
