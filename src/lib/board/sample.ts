// Seed cards from the brief, and a sample week at The Hall: one invite-only
// group around Brandon and Riverview. Every name in the week is invented.

import {
  DAY,
  HOUR,
  newCard,
  newPost,
  threadIdFor,
  todayIso,
  type DmMessage,
  type DmThread,
  type MarkRow,
  type MeetingCard,
  type Post,
  type Profile,
  type RoomId,
} from "@/lib/board/model";

function card(id: string, room: RoomId, name: string, place: string, time: string, extra: Partial<MeetingCard> = {}): MeetingCard {
  return newCard({ id, room, kind: "meeting", name, place, time, host: "", ...extra });
}

/** Checked once by the brief, still to be visited before they stay. */
const brief = { unverified: true, wentBy: ["brief"] };

export const SEED_CARDS: MeetingCard[] = [
  card("latin-epiphany", "latin", "Epiphany of Our Lord Shrine", "2510 E Hanna Ave, Tampa", "Sunday Low Mass 7 and 9, High Mass 11", { host: "Institute of Christ the King", ...brief }),
  card("orthodox-stjohn", "orthodox", "St. John the Baptist", "2418 W Swann Ave, Tampa", "Confirm in person", brief),
  card("baptist-gbcb", "baptist", "Grace Bible Church of Brandon", "1010 E Brandon Blvd, Brandon · (813) 662-9622", "Sunday school 9:00, worship 10:30. Reformed Baptist, 1689.", brief),
  card("presbyterian-redeemer", "presbyterian", "Redeemer Presbyterian", "Boyette Road, Riverview", "Confirm in person", brief),
  card("presbyterian-first", "presbyterian", "First Reformed", "W Hillsborough Ave, Tampa", "Confirm in person. Confession to confirm too.", brief),
  card("shop-ham", "shop", "Tampa Amateur Radio Club", "7801 N 22nd St, Tampa", "First Monday 7:30 p.m. Tuesday net 147.105 at 8 p.m.", brief),
  card("shop-garden", "shop", "Hillsborough Master Gardener desk", "(813) 744-5519 ext. 54102", "Office hours", brief),
  card("shelf-stoics", "shelf", "Tampa Stoics", "Tampa", "Confirm in person", brief),
  card("shop-shapes", "shop", "Shapes, women's gym hour", "731 W Lumsden, Brandon", "Confirm in person", brief),
];

/** Bump when the sample changes; a saved sample older than this is reloaded. */
export const SAMPLE_VERSION = 4;

export type SampleBoard = {
  me: string;
  profile: Profile;
  posts: Post[];
  cards: MeetingCard[];
  markLog: MarkRow[];
  threads: DmThread[];
  messages: DmMessage[];
};

export function sampleBoard(): SampleBoard {
  const now = Date.now();
  const iso = (days: number) => todayIso(new Date(now + days * DAY));
  const ago = (days: number, hours = 0) => now - days * DAY + hours * HOUR;

  const cards: MeetingCard[] = [
    card("s-framing", "shop", "Framing apprentice night", "Tom's shop, Riverview", "Thursdays 6:30 p.m.", { host: "Tom", next: iso(2), lastFour: [true, true, false, true], wentBy: ["Tom", "Josh", "Dale", "Luis"], going: ["Josh", "Dale", "Luis"], firstTimer: true }),
    card("s-ham", "shop", "Tampa Amateur Radio Club", "7801 N 22nd St, Tampa", "First Monday 7:30 p.m. Tuesday net 147.105 at 8 p.m.", { host: "Dale", next: iso(5), lastFour: [true, true, true, true], wentBy: ["Dale", "Josh"], going: ["Josh"], firstTimer: true }),
    card("s-question", "question", "Should the county cap new subdivisions?", "Brandon Brewing, back room", "Second Tuesday 7 p.m.", { host: "Maria", next: iso(9), lastFour: [true, true], wentBy: ["Maria", "Josh", "Tom"], going: ["Josh"], firstTimer: true }),
    card("s-coop", "coop", "Riverview classical co-op, Tuesday chapter", "[CHURCH HALL], Riverview", "Tuesdays 9 a.m., term time", { host: "Ruth", next: iso(4), lastFour: [true, true, true], wentBy: ["Ruth", "Maria"], going: ["Maria"], firstTimer: true }),
    card("s-hearing", "county", "County hearing: Lithia Pinecrest widening", "County Center, 601 E Kennedy, 2nd floor", "9 a.m.", { host: "Maria", next: iso(13), lastFour: [true], wentBy: ["Maria", "Josh"] }),
    card("s-stoics", "shelf", "Tampa Stoics", "Back room, Brandon hall", "Second and fourth Wednesday, 7 p.m.", { host: "Luis", next: iso(6), lastFour: [true, true, true], wentBy: ["Luis", "Josh", "Dale", "Maria"], going: ["Josh", "Maria"], firstTimer: true, book: "Meditations, Marcus Aurelius", pages: "book five" }),
    card("s-lamb", "shop", "Lamb Electric", "Valrico", "Electrical, residential", { kind: "trade", host: "Luis" }),
    card("s-bakery", "shop", "Ruth's sourdough", "Brandon", "Bread, by the loaf, Saturdays", { kind: "trade", host: "Ruth" }),
    card("s-baptist", "baptist", "Grace Bible Church of Brandon", "1010 E Brandon Blvd, Brandon", "Sunday school 9:00, worship 10:30", { host: "Dale", next: iso(3), lastFour: [true, true, true], wentBy: ["Dale", "Tom", "Josh"], going: ["Josh"], firstTimer: true }),
    card("s-baptist-lunch", "baptist", "Lunch after church", "The Hendersons' back yard, Valrico", "Sunday 12:30, after the service", { host: "Tom", next: iso(3), lastFour: [true, true], wentBy: ["Tom", "Dale", "Josh"], going: ["Josh", "Dale"] }),
    card("s-baptist-need", "baptist", "The Carters, after surgery", "Leave it in the cooler on the porch; Dale has the address", "Dinners this week", {
      kind: "need",
      host: "Dale",
      slots: [
        { day: "Monday", by: "Tom" },
        { day: "Wednesday", by: "" },
        { day: "Friday", by: "" },
      ],
    }),
    card("s-presby", "presbyterian", "Redeemer Presbyterian", "Boyette Road, Riverview", "Sunday 9:30 and 11", { host: "Ruth", next: iso(3), lastFour: [true, true, true], wentBy: ["Ruth", "Maria"] }),
    card("s-latin", "latin", "Epiphany of Our Lord Shrine", "2510 E Hanna Ave, Tampa", "Sunday Low Mass 7 and 9, High Mass 11", { host: "Institute of Christ the King", next: iso(3), lastFour: [true, true, true, true], wentBy: ["Luis", "Maria"] }),
    card("s-meal", "latin", "Meal after High Mass", "Parish hall", "Sunday 12:15, after the 11", { host: "Luis", next: iso(3), lastFour: [true, true], wentBy: ["Luis", "Maria", "Josh"], going: ["Josh", "Maria"] }),
    card("s-need", "latin", "The Nelsons, new baby", "Leave it on the porch, Luis has the address", "Dinners this week", {
      kind: "need",
      host: "Luis",
      slots: [
        { day: "Monday", by: "Maria" },
        { day: "Tuesday", by: "" },
        { day: "Wednesday", by: "Ruth" },
        { day: "Thursday", by: "" },
        { day: "Friday", by: "" },
      ],
    }),
  ];

  const p = (fields: Parameters<typeof newPost>[0] & { id: string }) => newPost(fields);

  const posts: Post[] = [
    p({ id: "p1", room: "shop", type: "hosted", author: "Tom", at: ago(5, 3), cardId: "s-framing", on: iso(-5), next: iso(2), came: ["Josh", "Dale", "Luis"], named: "Luis", claim: "Good night. 6 of us. Got the two new guys through a header and a jack stud, nobody lost a finger. Thanks Luis for sweeping up after. Next Thursday we do rafters, bring ear protection." }),
    p({ id: "p2", room: "shop", type: "did", author: "Josh", at: ago(5, 4), cardId: "s-framing", on: iso(-5), claim: "Framed my first header last night. Tom checked it twice before it went in.", reason: "Pic on my phone. Tom and Luis were there." }),
    p({ id: "p3", room: "shop", type: "asked", author: "Dale", at: ago(3), closed: true, claim: "Any chance of a Saturday morning session? I work Thursday nights.", reason: "Asked Tom, he said put it on here and see who else wants one." }),
    p({ id: "p3r", room: "shop", type: "asked", author: "Tom", at: ago(3, 2), parentId: "p3", claim: "If we get 3 I'll open the shop at 8. That's 2 so far." }),
    p({ id: "p4", room: "shop", type: "did", author: "Tom", at: ago(6), tradeId: "s-lamb", on: iso(-6), claim: "Luis put a new panel in the shop. Inspector signed off first visit.", reason: "Permit's on the wall. Dale watched him sign it." }),
    p({ id: "p5", room: "shop", type: "did", author: "Dale", at: ago(4, 1), tradeId: "s-lamb", on: iso(-4), claim: "Luis ran a 240 line to my garage for the welder. In and out in an afternoon, cleaned up after himself.", reason: "Got the receipt. Wife was home for it." }),
    p({ id: "p6", room: "shop", type: "did", author: "Josh", at: ago(2), tradeId: "s-bakery", on: iso(-2), claim: "Picked up 2 loaves from Ruth Saturday. Took one to the Nelsons.", reason: "Paid cash at her door, Maria was with me." }),
    p({ id: "p7", room: "shop", type: "hosted", author: "Dale", at: ago(1, 1), cardId: "s-ham", on: iso(-1), next: iso(5), came: ["Josh"], claim: "Tuesday net: 11 check-ins, 3 from Riverview which is new. Thanks everyone. Same time next week, 147.105." }),
    p({ id: "p8", room: "shop", type: "noted", author: "Maria", at: ago(0, -20), mark: "unsupported", claim: "Heard the repeater's moving frequencies next month.", reason: "somebody said it on the net" }),
    p({ id: "p9", room: "shelf", type: "hosted", author: "Luis", at: ago(8, 2), cardId: "s-stoics", on: iso(-8), next: iso(6), came: ["Josh", "Dale", "Maria"], named: "Dale", claim: "Book 4 last night. Dale read 4.3 out loud and we sat with it a while. Good turnout for a Wednesday. Book 5 for next time, it's short." }),
    p({ id: "p9b", room: "shelf", type: "did", author: "Josh", at: ago(8, 3), cardId: "s-stoics", on: iso(-8), claim: "Read book 4 on the porch Sunday. Brought the Hays translation if anyone wants to borrow it.", reason: "Luis and Dale saw it. Maria's got it now." }),
    p({ id: "p10", room: "question", type: "hosted", author: "Maria", at: ago(20), cardId: "s-question", on: iso(-20), next: iso(9), came: ["Josh", "Tom"], claim: "Full room, 9 chairs and 2 standing. Couple of new faces, hope they come back. Tom argued yes, Josh argued no, nobody changed their mind. Next month same question since we didn't get through it. Thanks Brandon Brewing for the room." }),
    p({ id: "p11", room: "question", type: "did", author: "Josh", at: ago(20, 1), cardId: "s-question", on: iso(-20), claim: "Took the no side against Tom. Brought the Wimauma couple from church, they stayed for round two.", reason: "Maria was hosting." }),
    p({ id: "p12", room: "coop", type: "hosted", author: "Ruth", at: ago(3, 4), cardId: "s-coop", on: iso(-3), next: iso(4), came: ["Maria"], named: "Maria", claim: "Finished Aeneid book 2 this morning. 3 families read out loud. Little ones built a horse out of the folding chairs. Book 3 next Tuesday. Thanks Maria for the extra chairs." }),
    p({ id: "p14", room: "county", type: "did", author: "Josh", at: ago(1, 2), campaignId: "county-agenda", on: iso(-1), claim: "Board office: Ken Hagan, Chair, Hillsborough County Commission. Put the ordinance on the commission agenda.", reason: "Logged on the Quorum desk by Josh. Window 9am–11am local." }),
    p({ id: "p15", room: "county", type: "asked", author: "Dale", at: ago(2, 3), closed: true, cardId: "s-hearing", claim: "Is the Lithia Pinecrest hearing still on the date on the card? County site still shows the old one.", reason: "Called District 4 twice, voicemail both times." }),
    p({ id: "p15r", room: "county", type: "asked", author: "Maria", at: ago(2, 5), parentId: "p15", claim: "Yes. Called the clerk's office this morning, 9:10. Same date, 9am, 2nd floor." }),
    p({ id: "p16", room: "county", type: "noted", author: "Maria", at: ago(4), claim: "FYI the county posts the full agenda packet the Friday before. Public comment cards are at the door, you get 3 minutes.", reason: "hcfl.gov agenda page, and I did it in March." }),
    p({ id: "p20", room: "baptist", type: "hosted", author: "Dale", at: ago(4, 6), cardId: "s-baptist", on: iso(-4), next: iso(3), came: ["Tom", "Josh"], claim: "Pastor Rosano wrapped up Hebrews 11 this morning. Lunch moved to the Hendersons' because of the rain. Thanks Tom for hosting on short notice. Same time next Sunday." }),
    p({ id: "p21", room: "baptist", type: "hosted", author: "Tom", at: ago(4, 7), cardId: "s-baptist-lunch", on: iso(-4), next: iso(3), came: ["Dale", "Josh"], named: "Josh", claim: "14 chairs under the carport and it held off raining until we were done. Thanks Josh for bringing the smoker and staying to clean it. Next Sunday at ours again unless somebody else wants it." }),
    p({ id: "p22", room: "baptist", type: "noted", author: "Maria", at: ago(2, 3), claim: "Men's breakfast is the 2nd Saturday this month instead of the 1st. 7:30 at the church.", reason: "It's in the bulletin. Dale has a copy." }),
    p({ id: "p17", room: "latin", type: "noted", author: "Luis", at: ago(6, 10), claim: "High Mass moves to 10:30 on first Sundays for the next 3 months.", reason: "It's in the bulletin, Luis has one." }),
    p({ id: "p18", room: "dispatch", type: "saw", author: "Maria", at: ago(0, -2), on: iso(0), claim: "Sheriff and a tow truck on the shoulder, I-75 south just past Gibsonton. Down to one lane.", reason: "3:55pm, I-75 SB around mile 250" }),
    p({ id: "p19", room: "dispatch", type: "saw", author: "Maria", at: ago(0, -1), on: iso(0), claim: "2 lanes closed on Bloomingdale at Lithia Pinecrest, crew on the median.", reason: "4:40pm, Bloomingdale and Lithia Pinecrest, eastbound" }),
  ];

  const markLog: MarkRow[] = [{ id: "m1", room: "shop", postId: "p8", author: "Maria", by: "Tom", mark: "unsupported", at: ago(0, -18) }];

  const t1 = threadIdFor("Josh", "Dale");
  const t2 = threadIdFor("Josh", "Tom");
  const threads: DmThread[] = [
    { id: t1, between: ["Dale", "Josh"] },
    { id: t2, between: ["Josh", "Tom"] },
  ];
  const messages: DmMessage[] = [
    { id: "d1", threadId: t1, from: "Dale", text: "hey can I bring my nephew thursday? he's 16, never used a saw", at: ago(1, -2) },
    { id: "d2", threadId: t1, from: "Josh", text: "ask Tom, it's his shop. card says new people welcome so probably yes. I can drive if you want", at: ago(1, -1) },
    { id: "d3", threadId: t1, from: "Dale", text: "he said yes. 6:15 at mine?", at: ago(1) },
    { id: "d4", threadId: t2, from: "Josh", text: "heads up, Dale's bringing his nephew thurs. 16, never used a saw", at: ago(0, -23) },
    { id: "d5", threadId: t2, from: "Tom", text: "good. I'll put him on the chop saw with Luis first", at: ago(0, -22) },
  ];

  return {
    me: "Josh",
    profile: { household: "the McMullins", parish: "Epiphany of Our Lord", trade: "" },
    posts,
    cards,
    markLog,
    threads,
    messages,
  };
}
