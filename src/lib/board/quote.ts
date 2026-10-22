import { hasHeadcount } from "./text.ts";

/** Long-press a quoted passage. A move past this, or a release, cancels it. */
export const QUOTE_HOLD_MS = 500;
export const QUOTE_MOVE_PX = 8;

export type PublicQuote = {
  text: string;
  author: string;
  work: string;
  words: number;
};

const QUOTED = /[“"]([^“”"]+)[”"]/;

function mentions(text: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function citation(value: string): { author: string; work: string } | null {
  const match = value.trim().match(/^([^,]+),\s+(.+)$/);
  if (!match) return null;
  const author = match[1].trim();
  const work = match[2].trim();
  if (author.length < 2 || work.length < 2) return null;
  if (author.split(/\s+/).length > 6) return null;
  return { author, work };
}

/**
 * A public-domain quotation: quoted words in the post, and "Author, Work"
 * in the other field. Nothing longer than about 30 words, and never the
 * member's own name.
 */
export function publicQuote(post: {
  claim: string;
  reason: string;
  author: string;
}): PublicQuote | null {
  const match = post.claim.match(QUOTED) ?? post.reason.match(QUOTED);
  if (!match) return null;
  const text = match[1].trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 30) return null;
  if (text.includes("#") || hasHeadcount(text)) return null;
  const quotedInClaim = post.claim.includes(match[0]);
  const cite = citation(quotedInClaim ? post.reason : post.claim);
  if (!cite) return null;
  if (cite.author.includes("#") || cite.work.includes("#")) return null;
  const painted = `${text} ${cite.author} ${cite.work}`;
  if (mentions(painted, post.author)) return null;
  return { text, author: cite.author, work: cite.work, words: words.length };
}

/** Square for a short line (Milton's eight words). Portrait when it is longer. */
export function quoteCardSize(words: number): { width: 1080; height: 1080 | 1350 } {
  return { width: 1080, height: words <= 16 ? 1080 : 1350 };
}

/** Every string the card paints. The member who posted it is not among them. */
export function quoteCardLines(quote: PublicQuote): readonly string[] {
  return [quote.text, quote.author, quote.work, "Avouch Social"];
}

export function quoteHoldKept(elapsedMs: number, movedPx: number, released: boolean): boolean {
  if (movedPx > QUOTE_MOVE_PX) return false;
  if (released) return false;
  return elapsedMs >= QUOTE_HOLD_MS;
}
