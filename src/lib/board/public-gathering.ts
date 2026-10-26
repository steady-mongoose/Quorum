import { heroLabel } from "./engraved.ts";
import { hasStreetAddress, isEnglish } from "./text.ts";

/** The only fields a public gathering page may show. */
export type PublicGathering = {
  title: string;
  date: string;
  time: string;
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

/** UUID, the id `crypto.randomUUID()` gives a card. Guessable ids are refused. */
const GATHERING_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PHONE = /\b(?:\+?1[-.\s]*)?\(?\d{3}\)?[-.\s]*\d{3}[-.\s]*\d{4}\b/;

export const INVITE_LINE =
  "Avouch is invite-only. Ask the person who shared this for an invite.";
export const PRIVACY_LINE =
  "This page shows the title, the date, the time, and the town. It does not show who is coming, a street, or what was written afterwards.";
export const PUBLIC_TIME_NOTE =
  "The time won't appear on the public page unless it's a plain clock time.";

const CLOCK_24 = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CLOCK_12 = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*([ap])\.?m\.?$/i;
const CLOCK_HOUR = /^(0?[1-9]|1[0-2])\s*([ap])\.?m\.?$/i;

/**
 * A plain clock, and nothing else. `07:00` stays `07:00`. `7 a.m.`, `7am`,
 * `7 AM`, and `9:00 AM` become `h:mm a.m.` or `h:mm p.m.`. A weekday or any
 * other words stay off the public page.
 */
export function publicClock(value: string): string {
  const time = value.trim().replace(/\s+/g, " ");
  if (CLOCK_24.test(time)) return time;
  const withMinutes = CLOCK_12.exec(time);
  if (withMinutes) return clockLabel(withMinutes[1], withMinutes[2], withMinutes[3]);
  const hourOnly = CLOCK_HOUR.exec(time);
  if (!hourOnly) return "";
  return clockLabel(hourOnly[1], "00", hourOnly[2]);
}

function clockLabel(hour: string | undefined, minute: string | undefined, meridiem: string | undefined): string {
  const suffix = meridiem?.toLowerCase() === "p" ? "p.m." : "a.m.";
  return `${String(Number(hour))}:${minute ?? "00"} ${suffix}`;
}

function forPublic(gathering: PublicGathering): PublicGathering {
  return { ...gathering, time: publicClock(gathering.time) };
}

export function isGatheringId(id: string): boolean {
  return GATHERING_ID.test(id);
}

export function gatheringPublicUrl(id: string): string {
  return `https://avouchsocial.com/e/${id.toLowerCase()}`;
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
 * Keep a title, a date, a time, and a town. A street, a phone number,
 * another script, or any other field is refused.
 */
export function acceptPublicGathering(input: {
  title: unknown;
  date: unknown;
  time: unknown;
  town: unknown;
}): { ok: true; gathering: PublicGathering } | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const date = typeof input.date === "string" ? input.date.trim() : "";
  const time = typeof input.time === "string" ? input.time.trim() : "";
  const town = typeof input.town === "string" ? input.town.trim() : "";
  if (!title || title.length > 140 || !isEnglish(title) || hasStreetAddress(title)) {
    return { ok: false, error: "Give the gathering a title, without a street address." };
  }
  if (date && (!ISO_DATE.test(date) || !publicDateLabel(date))) {
    return { ok: false, error: "Use the gathering date as YYYY-MM-DD." };
  }
  if (
    time.length > 120 ||
    !isEnglish(time) ||
    hasStreetAddress(time) ||
    /\baddress\b/i.test(time) ||
    PHONE.test(time)
  ) {
    return { ok: false, error: "The public page can show the time, not a phone number or a street." };
  }
  if (town.length > 80 || !isEnglish(town) || hasStreetAddress(town) || /\baddress\b/i.test(town)) {
    return { ok: false, error: "The public page can name the town, not the street." };
  }
  return { ok: true, gathering: { title, date, time, town } };
}

/** Read a response and keep only the four public fields. */
export function readPublicGathering(value: unknown): PublicGathering | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const accepted = acceptPublicGathering({
    title: row.title,
    date: row.date,
    time: row.time,
    town: row.town,
  });
  if (!accepted.ok) return null;
  return forPublic(accepted.gathering);
}

export function publicPreview(gathering: PublicGathering): { title: string; description: string } {
  const shown = forPublic(gathering);
  const description = [publicDateLabel(shown.date), shown.time, shown.town]
    .filter(Boolean)
    .join(" · ");
  return {
    title: gathering.title,
    description: description || "Avouch is invite-only.",
  };
}

export type PublicMeta =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

/** One public-domain Doré plate. The same file for every gathering, with no card text on it. */
export const GATHERING_OG_IMAGE = "https://avouchsocial.com/art/dore-og.jpg";
const HERO = heroLabel("week") ?? "Gustave Doré, Jacob’s Dream, 1866";

/** Head tags for one gathering. A missing gathering stays noindex and unnamed. */
export function publicGatheringMeta(gathering: PublicGathering | null, id: string): PublicMeta[] {
  const robots = { name: "robots", content: "noindex" };
  if (!gathering || !isGatheringId(id)) return [robots, { title: "Not found" }];
  const preview = publicPreview(forPublic(gathering));
  const url = gatheringPublicUrl(id);
  return [
    robots,
    { title: preview.title },
    { property: "og:title", content: preview.title },
    { property: "og:description", content: preview.description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: url },
    { property: "og:image", content: GATHERING_OG_IMAGE },
    { property: "og:image:alt", content: HERO },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: preview.title },
    { name: "twitter:description", content: preview.description },
    { name: "twitter:image", content: GATHERING_OG_IMAGE },
    { name: "twitter:image:alt", content: HERO },
  ];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function metaTags(gathering: PublicGathering | null, id: string): string {
  return publicGatheringMeta(gathering, id)
    .filter((tag): tag is Exclude<PublicMeta, { title: string }> => !("title" in tag))
    .map((tag) => {
      if ("property" in tag) {
        return `<meta property="${tag.property}" content="${escapeHtml(tag.content)}">`;
      }
      return `<meta name="${tag.name}" content="${escapeHtml(tag.content)}">`;
    })
    .join("\n");
}

function documentShell(title: string, gathering: PublicGathering | null, id: string, main: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${metaTags(gathering, id)}
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/backgrounds.css">
<link rel="stylesheet" href="/fluid.css">
<link rel="stylesheet" href="/gathering.css">
<link rel="preload" href="/fonts/EBGaramond-latin.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
<div class="shell gathering-page" data-section="week">
<div class="hero-band" role="img" aria-label="${escapeHtml(HERO)}"></div>
<div class="shell-body">
<main>
<article class="plate gathering-plate">
${main}
</article>
</main>
</div>
</div>
</body>
</html>
`;
}

/** HTML for /e/<id>. A missing or unshared gathering is a 404. Both carry noindex. */
export function publicGatheringHtml(
  gathering: PublicGathering | null,
  id = "",
): { status: 200 | 404; body: string } {
  if (!gathering) {
    return {
      status: 404,
      body: documentShell(
        "Not found",
        null,
        id,
        `<p class="gathering-kicker">Avouch Social</p>
<h1 class="gathering-title illum">This gathering is not shared.</h1>
<p class="gathering-copy">${escapeHtml(INVITE_LINE)}</p>
<p class="gathering-links"><a href="/">The door</a></p>`,
      ),
    };
  }
  const shown = forPublic(gathering);
  const date = publicDateLabel(shown.date);
  const dateLine = date
    ? `\n<p class="gathering-line"><time datetime="${escapeHtml(shown.date)}">${escapeHtml(date)}</time></p>`
    : "";
  const timeLine = shown.time ? `\n<p class="gathering-line">${escapeHtml(shown.time)}</p>` : "";
  const townLine = shown.town ? `\n<p class="gathering-town">${escapeHtml(shown.town)}</p>` : "";
  return {
    status: 200,
    body: documentShell(
      shown.title,
      shown,
      id,
      `<p class="gathering-kicker">Avouch Social</p>
<h1 class="gathering-title illum">${escapeHtml(gathering.title)}</h1>${dateLine}${timeLine}${townLine}
<p class="gathering-copy">${escapeHtml(INVITE_LINE)}</p>
<p class="gathering-links"><a href="/">The door</a> <a href="#privacy">Privacy</a></p>
<section id="privacy">
<h2 class="gathering-kicker">Privacy</h2>
<p class="gathering-copy">${escapeHtml(PRIVACY_LINE)}</p>
</section>`,
    ),
  };
}

/** JSON for the page. Title, date, and town, plus a clock when the time is one. */
export function publicGatheringJson(gathering: PublicGathering | null): {
  status: 200 | 404;
  body: { title: string; date: string; town: string; time?: string } | { error: "Not found." };
} {
  if (!gathering) return { status: 404, body: { error: "Not found." } };
  const shown = forPublic(gathering);
  const body: { title: string; date: string; town: string; time?: string } = {
    title: shown.title,
    date: shown.date,
    town: shown.town,
  };
  if (shown.time) body.time = shown.time;
  return { status: 200, body };
}
