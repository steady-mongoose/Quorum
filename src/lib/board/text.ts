/** Shared wording rules. The server and the composer both use these. */

const CLOCK = /\b(\d{1,2}:\d{2}|\d{1,2}\s?(a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i;
const STREET_ADDRESS =
  /\b\d{2,6}\s+[A-Za-z0-9.'-]+(\s+[A-Za-z0-9.'-]+){0,3}\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|way|pl|place|cir|circle|ter|terrace)\b\.?/i;
const THREAT =
  /\b(i('| wi)ll|we('| wi)ll|gonna|going to|should|let's|lets)\s+(kill|shoot|stab|hang|burn|beat|hurt|bomb|lynch)\b|\b(kill|shoot|hang|burn)\s+(him|her|them|you|that)\b/i;
const PORN = /\b(porn|pornograph|xxx|onlyfans|nsfw)\b/i;
const HEADCOUNT =
  /\b\d+\s*(people|folks|came|showed|attended|turned out|of us|guys|men|women)\b|\b(turnout|headcount|attendance)\b/i;

/** Latin letters, digits, and ordinary punctuation. Other scripts are refused. */
const ENGLISH =
  /^[\t\n\r\u0020-\u007E\u00A0-\u00FF\u0100-\u024F\u1E00-\u1EFF\u2018\u2019\u201C\u201D\u2013\u2014\u2026]*$/;

export function isEnglish(value: string): boolean {
  return ENGLISH.test(value);
}

export function looksLikeThreat(value: string): boolean {
  return THREAT.test(value);
}

export function looksLikePorn(value: string): boolean {
  return PORN.test(value);
}

export function hasHeadcount(value: string): boolean {
  return HEADCOUNT.test(value);
}

export function hasClock(value: string): boolean {
  return CLOCK.test(value);
}

export function hasStreetAddress(value: string): boolean {
  return STREET_ADDRESS.test(value);
}

/**
 * One English sentence, 8 to 200 characters, ending with . ! or ?
 * A second sentence (a stop, then more words) is refused.
 */
export function oneSentence(value: string): string | null {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < 8 || text.length > 200) return null;
  if (!isEnglish(text)) return null;
  if (/[.!?]["']?\s+\p{L}/u.test(text)) return null;
  if (!/[.!?]$/.test(text)) return null;
  if (!/\p{Script=Latin}/u.test(text)) return null;
  return text;
}

export const SENTENCE_ERROR = "Write one sentence, ending with a period.";
