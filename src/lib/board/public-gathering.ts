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
  return accepted.ok ? accepted.gathering : null;
}

export function publicPreview(gathering: PublicGathering): { title: string; description: string } {
  const description = [publicDateLabel(gathering.date), gathering.time, gathering.town]
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

/** Head tags for one gathering. A missing gathering stays noindex and unnamed. */
export function publicGatheringMeta(gathering: PublicGathering | null, id: string): PublicMeta[] {
  const robots = { name: "robots", content: "noindex" };
  if (!gathering || !isGatheringId(id)) return [robots, { title: "Not found" }];
  const preview = publicPreview(gathering);
  const url = gatheringPublicUrl(id);
  return [
    robots,
    { title: preview.title },
    { property: "og:title", content: preview.title },
    { property: "og:description", content: preview.description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: url },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: preview.title },
    { name: "twitter:description", content: preview.description },
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

const HERO = heroLabel("week") ?? "Gustave Doré, Jacob’s Dream, 1866";

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
  const date = publicDateLabel(gathering.date);
  const dateLine = date
    ? `\n<p class="gathering-line"><time datetime="${escapeHtml(gathering.date)}">${escapeHtml(date)}</time></p>`
    : "";
  const timeLine = gathering.time ? `\n<p class="gathering-line">${escapeHtml(gathering.time)}</p>` : "";
  const townLine = gathering.town ? `\n<p class="gathering-town">${escapeHtml(gathering.town)}</p>` : "";
  return {
    status: 200,
    body: documentShell(
      gathering.title,
      gathering,
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

/** JSON for the page. Only the four public fields, or a 404. */
export function publicGatheringJson(gathering: PublicGathering | null): {
  status: 200 | 404;
  body: PublicGathering | { error: "Not found." };
} {
  if (!gathering) return { status: 404, body: { error: "Not found." } };
  return {
    status: 200,
    body: {
      title: gathering.title,
      date: gathering.date,
      time: gathering.time,
      town: gathering.town,
    },
  };
}
