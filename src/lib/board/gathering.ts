import { hasStreetAddress } from "./text.ts";
import { formatDate } from "./model.ts";

const DROP_WORD =
  /^(room|rooms|porch|garage|hall|yard|library|shop|floor|address|addresses)$/i;

/**
 * The town, or a short locality, from a card's place line.
 * Street numbers, the word "address", and room words are left out.
 */
export function townOf(place: string): string {
  const parts = place
    .split(/[,;·]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter(
      (part) =>
        !hasStreetAddress(part) && !/\baddress\b/i.test(part) && !/^\d{2,6}\b/.test(part),
    );
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const words = parts[index]
      .replace(/[.’']/g, "")
      .split(/\s+/)
      .filter((word) => word && !DROP_WORD.test(word) && !/^\d/.test(word));
    if (words.length >= 1 && words.length <= 3) return words.join(" ");
  }
  return "";
}

export type GatheringShare = {
  title: string;
  text: string;
  url: string;
};

/**
 * What may leave the app once the organizer has turned sharing on.
 * Title, date, time, and town. No street, host, attendee, or invite code.
 * The public page itself shows only the title, the date, and the town.
 */
export function gatheringShare(card: {
  id: string;
  name: string;
  place: string;
  time: string;
  next: string;
}): GatheringShare {
  const date = card.next ? formatDate(card.next) : "";
  const town = townOf(card.place);
  const when = [date, card.time, town].filter(Boolean).join(", ");
  return {
    title: card.name,
    text: `${card.name} · ${when}`,
    url: `https://avouchsocial.com/e/${card.id}`,
  };
}
