import type { Section } from "./model.ts";

/** Sections that carry a plate. Martin is only the door. */
export type ArtSection = "week" | "rooms" | "messages" | "landing" | "signin";

export function artSection(input: {
  entered: boolean;
  section: Section;
  signingIn: boolean;
}): ArtSection | null {
  if (!input.entered) return input.signingIn ? "signin" : "landing";
  if (input.section === "week" || input.section === "rooms" || input.section === "messages") {
    return input.section;
  }
  return null;
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

export function showsHero(section: ArtSection | null): boolean {
  return section === "week" || section === "rooms" || section === "messages";
}

/** What the hero band is a picture of. Margin plates are decorative. */
export function heroLabel(section: ArtSection | null): string | null {
  if (section === "week") return "Gustave Doré, Jacob’s Dream, 1866";
  if (section === "rooms" || section === "messages") {
    return "Albrecht Dürer, Saint Jerome in His Study, 1514";
  }
  return null;
}
