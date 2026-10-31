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
  find: "John Bauer, Princess Tuvstarr Gazing Down into the Dark Waters of the Forest Tarn, 1913",
  groups: "Albrecht Dürer, The Feast of the Rose Garlands, 1506",
  profile: "Albrecht Dürer, Self-Portrait at Thirteen, 1484",
  about: "John Martin, The Creation of Light, 1824–27",
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
  groups: "Albrecht Dürer · The Feast of the Rose Garlands · 1506",
  group: "Gustave Doré · Ruth and Boaz · 1866",
  find: "John Bauer · Princess Tuvstarr Gazing Down into the Dark Waters of the Forest Tarn · 1913",
  messages: "Albrecht Dürer · Erasmus of Rotterdam · 1526",
  profile: "Albrecht Dürer · Self-Portrait at Thirteen · 1484",
  about: "John Martin · The Creation of Light · 1824–27",
  civic: "Gustave Doré · The Judgment of Solomon · 1866",
};

/** About's section plates, cut from the app's own art. Each is credited where it stands. */
export const SECTION_PLATE = {
  week: {
    alt: "Angels on the stair of Jacob’s ladder",
    caption: "Gustave Doré · Jacob’s Dream · 1866",
  },
  groups: {
    alt: "A crowd gathered around the Virgin and Child",
    caption: "Albrecht Dürer · The Feast of the Rose Garlands · 1506",
  },
  messages: {
    alt: "A hand writing at a small desk",
    caption: "Albrecht Dürer · Erasmus of Rotterdam · 1526",
  },
  civic: {
    alt: "Solomon on his throne with one hand raised",
    caption: "Gustave Doré · The Judgment of Solomon · 1866",
  },
  group: {
    alt: "Ruth and Boaz among the reapers, one carrying a sheaf of grain",
    caption: "Gustave Doré · Ruth and Boaz · 1866",
  },
  room: {
    alt: "Christ seated on a hillside with the listeners around him",
    caption: "Gustave Doré · The Sermon on the Mount · 1866",
  },
  rooms: {
    alt: "Saint Jerome writing at his desk",
    caption: "Albrecht Dürer · Saint Jerome in His Study · 1514",
  },
  hands: {
    alt: "A pair of hands in prayer",
    caption: "Albrecht Dürer · Praying Hands · 1508",
  },
} as const;

export type SectionPlateId = keyof typeof SECTION_PLATE;

/**
 * From 1600px the Messages and You plates put a second work on the right edge (art-two-sides.test.ts),
 * so their chip names both. Other pages show two parts of one work and keep the one-work chip.
 */
const WIDE_CAPTION: Partial<Record<Section | PlateView, string>> = {
  messages: "Albrecht Dürer · Praying Hands · 1508, and Erasmus of Rotterdam · 1526",
  profile: "Albrecht Dürer · Self-Portrait at Thirteen · 1484, and Self-Portrait · 1500",
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
