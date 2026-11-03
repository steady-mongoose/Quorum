import type { Section } from "./model.ts";

/** Sections that carry a plate. Martin is the door, and the public About and 404 pages that share its plate.
 *  Every signed-in section has one. */
export type ArtSection = Section | "landing" | "signin";

export function artSection(input: {
  entered: boolean;
  section: Section;
  signingIn: boolean;
}): ArtSection | null {
  if (!input.entered) return input.signingIn ? "signin" : "landing";
  return input.section;
}

/** Local clock, 18:00 through 05:00. No animation. */
export function isEveningHour(hour: number): boolean {
  return hour >= 18 || hour < 5;
}

/**
 * The hero is applied only after first paint, and never when the reader asked
 * for less data. That keeps the plate out of the largest contentful paint.
 */
export function artAttribute(input: {
  painted: boolean;
  reducedData: boolean;
  section: ArtSection | null;
}): ArtSection | null {
  if (!input.painted || input.reducedData) return null;
  return input.section;
}

/**
 * The public About, Privacy and Terms pages and the shared gathering page still carry a band.
 * The signed-in shell no longer does: every signed-in page has one full-bleed plate instead.
 */
const HERO_LABEL: Record<Section, string> = {
  week: "Gustave Doré, Jacob’s Dream, 1866",
  rooms: "Albrecht Dürer, Saint Jerome in His Study, 1514",
  messages: "Albrecht Dürer, Saint Jerome in His Study, 1514",
  find: "Gustave Doré, A Friendly Tournament, 1877",
  groups: "Gustave Doré, The Crusaders’ War Machinery, 1877",
  profile: "Gustave Doré, The Battle of Antioch, 1877",
  about: "John Martin, Joshua Commanding the Sun to Stand Still, 1827",
  civic: "Gustave Doré, The Judgment of Solomon, 1866",
};

export function heroLabel(section: ArtSection | null): string | null {
  if (section === null || section === "landing" || section === "signin") return null;
  return HERO_LABEL[section];
}

/** A room or a group open inside its section. page-craft.css gives each its own plate. */
export type PlateView = "room" | "group";

export function plateView(input: {
  section: ArtSection | null;
  browsing: boolean;
  groupOpen: boolean;
}): PlateView | null {
  if (input.section === "rooms" && !input.browsing) return "room";
  if (input.section === "groups" && input.groupOpen) return "group";
  return null;
}

/**
 * The credit chip under each signed-in page: artist · title · year, worded as spec v3 words it.
 * A page with no entry here draws no chip.
 */
const PLATE_CAPTION: Partial<Record<Section | PlateView, string>> = {
  week: "Gustave Doré · Jacob’s Dream · 1866",
  rooms: "Albrecht Dürer · Saint Jerome in His Study · 1514",
  room: "Gustave Doré · The Sermon on the Mount · 1866",
  groups: "Gustave Doré · The Crusaders’ War Machinery · 1877",
  group: "Gustave Doré · Ruth and Boaz · 1866",
  find: "Gustave Doré · A Friendly Tournament · 1877",
  messages: "Albrecht Dürer · Erasmus of Rotterdam · 1526",
  profile: "Gustave Doré · The Battle of Antioch · 1877",
  about: "John Martin · Joshua Commanding the Sun to Stand Still · 1827",
  civic: "Gustave Doré · The Judgment of Solomon · 1866",
};

/**
 * About's section plates, each chosen for what its section says and credited where it stands. Josh's rules:
 * Jesus is never featured, no crop cuts off a head, and no work appears twice on the page.
 * Every file is a square, the shape of a social post, so a figure keeps its body, and the page never crops it.
 */
export const SECTION_PLATE = {
  crusader: {
    alt: "A crusader on a rearing horse with his sword raised, a rider behind him carrying a tall cross",
    caption: "Gustave Doré · The Count of Anjou at the Battle of Mansourah · 1877",
  },
  gathering: {
    alt: "Knights, ladies and children gathered under the trees to hear two singers and a harper",
    caption: "Gustave Doré · Troubadours Sing the Glories of the Crusades · 1877",
  },
  study: {
    alt: "Saint Jerome writing in his room",
    caption: "Albrecht Dürer · Saint Jerome in His Study · 1514",
  },
  judgment: {
    alt: "Solomon standing with one hand raised",
    caption: "Gustave Doré · The Judgment of Solomon · 1866",
  },
  writing: {
    alt: "Erasmus writing at his desk",
    caption: "Albrecht Dürer · Erasmus of Rotterdam · 1526",
  },
} as const;

export type SectionPlateId = keyof typeof SECTION_PLATE;

/**
 * From 1600px the Messages, You, Groups and Find plates show a different work on each edge (art-two-sides.test.ts),
 * so their chip names both. Other pages show two parts of one work and keep the one-work chip.
 */
const WIDE_CAPTION: Partial<Record<Section | PlateView, string>> = {
  messages: "Albrecht Dürer · Praying Hands · 1508, and Erasmus of Rotterdam · 1526",
  profile: "Gustave Doré · Bohemond Alone Mounts the Rampart of Antioch, and The Battle of Antioch · 1877",
  groups: "Gustave Doré · Troubadours Sing the Glories of the Crusades, and The Crusaders’ War Machinery · 1877",
  find: "Gustave Doré · The Crusaders Cross Mount Taurus, and A Friendly Tournament · 1877",
};

export function plateCaptionWide(section: ArtSection | null, view: PlateView | null): string | null {
  if (section === null || section === "landing" || section === "signin" || view) return null;
  return WIDE_CAPTION[section] ?? null;
}

export function plateCaption(section: ArtSection | null, view: PlateView | null): string | null {
  if (section === null || section === "landing" || section === "signin") return null;
  if (view) return PLATE_CAPTION[view] ?? null;
  return PLATE_CAPTION[section] ?? null;
}
