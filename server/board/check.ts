import {
  hasClock,
  hasHeadcount,
  hasStreetAddress,
  isEnglish,
  looksLikeBlasphemy,
  looksLikeDoxxing,
  looksLikePorn,
  looksLikeThreat,
  oneSentence,
  SENTENCE_ERROR,
} from "../../src/lib/board/text.ts";

const POST_TYPES = new Set(["did", "asked", "noted", "saw", "hosted"]);
const REASON_TYPES = new Set(["did", "asked", "noted", "saw"]);
const DATE_TYPES = new Set(["did", "saw", "hosted"]);

export type RoomRules = {
  name: string;
  takes: string[];
  stewardTakes: string[];
};

export function contentStops(input: {
  type: string;
  claim: string;
  reason: string;
  on: string;
  next: string;
  came: string[];
  named: string;
  author: string;
  attested: boolean;
  mediaCount: number;
  steward: boolean;
  room: RoomRules;
}): string[] {
  const stops: string[] = [];
  if (!POST_TYPES.has(input.type)) {
    stops.push("Choose what kind of post this is.");
    return stops;
  }
  const allowed = input.steward
    ? [...input.room.takes, ...input.room.stewardTakes]
    : input.room.takes;
  if (!allowed.includes(input.type)) {
    stops.push(
      input.room.stewardTakes.includes(input.type)
        ? "Only a steward can post that."
        : `${input.room.name} does not take that kind of post.`,
    );
  }
  const claim = input.claim.trim();
  const reason = input.reason.trim();
  if (!claim) stops.push("Write the post.");
  if (claim.length > 600) stops.push("Keep it under 600 characters.");
  if (REASON_TYPES.has(input.type) && !reason) stops.push("Add the reason.");
  if (reason.length > 600) stops.push("Keep the reason under 600 characters.");
  if ((claim && !isEnglish(claim)) || (reason && !isEnglish(reason)))
    stops.push("Write it in English.");
  if (DATE_TYPES.has(input.type) && !/^\d{4}-\d{2}-\d{2}$/.test(input.on))
    stops.push("Add the date.");
  if (input.next && !/^\d{4}-\d{2}-\d{2}$/.test(input.next))
    stops.push("The next date is not a valid date.");
  if (input.type === "asked" && (claim.match(/\?/g) ?? []).length > 1) {
    stops.push("One question per post. Ask the second one separately.");
  }
  if (input.type === "hosted" && hasHeadcount(claim)) {
    stops.push("Leave out the headcount. Say how it went, not how many came.");
  }
  if (input.named) {
    if (input.named === input.author) stops.push("You cannot mention yourself.");
    else if (!input.came.includes(input.named))
      stops.push("You can only mention someone who was there.");
  }
  if (input.type === "saw") {
    if (!hasClock(reason) && !hasClock(claim)) stops.push("Include the time.");
    if (hasStreetAddress(claim) || hasStreetAddress(reason)) {
      stops.push(
        "That looks like a home address. Give the block or the corner, not the house number.",
      );
    }
    if (!input.attested)
      stops.push("Tick the box to confirm: no children's faces, no private person named.");
  }
  const text = `${claim}\n${reason}`;
  if (looksLikeThreat(text)) stops.push("That reads as a threat and will not post.");
  if (looksLikePorn(text)) stops.push("That will not post.");
  if (looksLikeDoxxing(text)) stops.push("That reads as doxxing and will not post.");
  if (looksLikeBlasphemy(text)) stops.push("That mocks God or Christ and will not post.");
  if (input.mediaCount > 1) stops.push("One picture per post.");
  return stops;
}

export function replyStops(claim: string): string[] {
  const text = claim.trim();
  const stops: string[] = [];
  if (!text) stops.push("Write the reply.");
  if (text.length > 600) stops.push("Keep it under 600 characters.");
  if (text && !isEnglish(text)) stops.push("Write it in English.");
  if (looksLikeThreat(text)) stops.push("That reads as a threat and will not post.");
  if (looksLikePorn(text)) stops.push("That will not post.");
  if (looksLikeDoxxing(text)) stops.push("That reads as doxxing and will not post.");
  if (looksLikeBlasphemy(text)) stops.push("That mocks God or Christ and will not post.");
  return stops;
}

export function sentenceOrStop(
  value: string,
): { ok: true; text: string } | { ok: false; error: string } {
  const text = oneSentence(value);
  if (!text) return { ok: false, error: SENTENCE_ERROR };
  return { ok: true, text };
}
