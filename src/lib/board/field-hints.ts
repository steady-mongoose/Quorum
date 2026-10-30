/**
 * Short hints shown below a field and tied to it with aria-describedby.
 * Josh, Oct 29 2026: no sample names or example values inside fields, so the
 * guidance a placeholder used to give lives here instead (Design, PR #122).
 */
export const FIELD_HINT = {
  meetingTime: "The day and hour, and how often it meets.",
  tradeWork: "The trade, and the kind of work they take.",
  needWhat: "What would help, and by when.",
  household: "Your family name, as neighbors would say it.",
  church: "The full name of the church you attend.",
  trade: "Your work, in a word or two. Leave it blank if you like.",
  pages: "Chapters or pages, as you would say them aloud.",
  roomAddress: "Lowercase letters, numbers and hyphens. This becomes the room's web address.",
  state: "Two letters, as on an envelope.",
  appeal: "Say plainly why you think the decision was wrong.",
  cityState: "Your city, then your state.",
  allyChannel: "Signal, WhatsApp, or text.",
  markReason: "Say plainly what the post gets wrong.",
  refusal: "One thing you will not give up in a deal. Add each one on its own.",
} as const;
