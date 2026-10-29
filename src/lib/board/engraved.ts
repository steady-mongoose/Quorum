import type { Section } from "./model.ts";

/** Sections that carry a plate. Martin is only the door. Every signed-in section has one. */
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

/** What each hero band is a picture of. Margin plates are decorative. */
const HERO_LABEL: Record<Section, string> = {
  week: "Gustave Doré, Jacob’s Dream, 1866",
  rooms: "Albrecht Dürer, Saint Jerome in His Study, 1514",
  messages: "Albrecht Dürer, Saint Jerome in His Study, 1514",
  find: "Rembrandt van Rijn, Christ Preaching (La Petite Tombe), about 1652",
  groups: "Jean-François Millet, The Diggers, about 1855–56",
  profile: "Rembrandt van Rijn, Self-Portrait Leaning on a Stone Sill, 1639",
  about: "Rembrandt van Rijn, The Three Trees, 1643",
  civic: "Asher B. Durand after John Trumbull, The Declaration of Independence, 1823",
};

export function showsHero(section: ArtSection | null): boolean {
  return section !== null && section !== "landing" && section !== "signin";
}

export function heroLabel(section: ArtSection | null): string | null {
  if (section === null || section === "landing" || section === "signin") return null;
  return HERO_LABEL[section];
}
