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
  card("presbyterian-redeemer", "presbyterian", "Redeemer Presbyterian", "Boyette Road, Riverview", "Confirm in person", brief),
  card("presbyterian-first", "presbyterian", "First Reformed", "W Hillsborough Ave, Tampa", "Confirm in person. Confession to confirm too.", brief),
  card("shop-ham", "shop", "Tampa Amateur Radio Club", "7801 N 22nd St, Tampa", "First Monday 7:30 p.m. Tuesday net 147.105 at 8 p.m.", brief),
  card("shop-garden", "shop", "Hillsborough Master Gardener desk", "(813) 744-5519 ext. 54102", "Office hours", brief),
  card("shelf-stoics", "shelf", "Tampa Stoics", "Tampa", "Confirm in person", brief),
  card("shop-shapes", "shop", "Shapes, women's gym hour", "731 W Lumsden, Brandon", "Confirm in person", brief),
];

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
    card("s-question", "question", "What do we owe the county?", "Brandon hall, back room", "Second Tuesday 7 p.m.", { host: "Maria", next: iso(9), lastFour: [true, true], wentBy: ["Maria", "Josh", "Tom"] }),
    card("s-coop", "coop", "Riverview classical co-op, Tuesday chapter", "[CHURCH HALL], Riverview", "Tuesdays 9 a.m., term time", { host: "Ruth", next: iso(4), lastFour: [true, true, true], wentBy: ["Ruth", "Maria"], going: ["Maria"], firstTimer: true }),
    card("s-hearing", "county", "County hearing: Lithia Pinecrest widening", "County Center, 601 E Kennedy, 2nd floor", "9 a.m.", { host: "Maria", next: iso(13), lastFour: [true], wentBy: ["Maria", "Josh"] }),
    card("s-stoics", "shelf", "Tampa Stoics, the table", "Back room, Brandon hall", "Second and fourth Wednesday, 7 p.m.", { host: "Luis", next: iso(6), lastFour: [true, true, true], wentBy: ["Luis", "Josh", "Dale", "Maria"], going: ["Josh", "Maria"], firstTimer: true, book: "Meditations, Marcus Aurelius", pages: "book five" }),
    card("s-lamb", "shop", "Lamb Electric", "Valrico", "Electrical, residential", { kind: "trade", host: "Luis" }),
    card("s-bakery", "shop", "Ruth's sourdough", "Brandon", "Bread, by the loaf, Saturdays", { kind: "trade", host: "Ruth" }),
    card("s-baptist", "baptist", "[1689 CHURCH NEAR BRANDON]", "[ADDRESS]", "Sunday 10:30, Lord's Supper first Sunday", { host: "Dale", next: iso(3), lastFour: [true, true], wentBy: ["Dale", "Tom"] }),
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
    p({ id: "p1", room: "shop", type: "hosted", author: "Tom", at: ago(5, 3), cardId: "s-framing", on: iso(-5), next: iso(2), came: ["Josh", "Dale", "Luis"], named: "Luis", claim: "Full bench. Walked the two new ones through a header and a jack stud. Luis stayed to sweep the shop. Next week we cut rafters." }),
    p({ id: "p2", room: "shop", type: "did", author: "Josh", at: ago(5, 4), cardId: "s-framing", on: iso(-5), claim: "Framed my first header. Tom checked it twice before it went in.", reason: "Photo on my phone, Tom and Luis were there." }),
    p({ id: "p3", room: "shop", type: "asked", author: "Dale", at: ago(3), closed: true, claim: "Is there a Saturday slot for someone who works Thursday nights?", reason: "Asked Tom in person, he said to put it on the board and see who else wants one." }),
    p({ id: "p3r", room: "shop", type: "asked", author: "Tom", at: ago(3, 2), parentId: "p3", claim: "Two of us would come. If a third says so here, I will open the shop at 8." }),
    p({ id: "p4", room: "shop", type: "did", author: "Tom", at: ago(6), tradeId: "s-lamb", on: iso(-6), claim: "Luis replaced the panel in the shop. Inspector passed it first visit.", reason: "Permit number on the shop wall, Dale saw the inspector sign." }),
    p({ id: "p5", room: "shop", type: "did", author: "Dale", at: ago(4, 1), tradeId: "s-lamb", on: iso(-4), claim: "Luis ran a 240 line to the garage for the welder. Clean work, one afternoon.", reason: "Receipt dated last Tuesday, my wife was home for it." }),
    p({ id: "p6", room: "shop", type: "did", author: "Josh", at: ago(2), tradeId: "s-bakery", on: iso(-2), claim: "Two loaves from Ruth, Saturday. Second one went to the Nelsons.", reason: "Paid cash at her door, Maria was with me." }),
    p({ id: "p7", room: "shop", type: "hosted", author: "Dale", at: ago(1, 1), cardId: "s-ham", on: iso(-1), next: iso(5), came: ["Josh"], claim: "Net ran clean. Three check-ins from Riverview this time, which is new." }),
    p({ id: "p8", room: "shop", type: "noted", author: "Maria", at: ago(0, -20), mark: "unsupported", claim: "The club's repeater is moving frequencies next month.", reason: "heard it at the net" }),
    p({ id: "p9", room: "shelf", type: "hosted", author: "Luis", at: ago(8, 2), cardId: "s-stoics", on: iso(-8), next: iso(6), came: ["Josh", "Dale", "Maria"], named: "Dale", claim: "Book four. Dale read 4.3 aloud and nobody said anything for a minute, which is the point of it. Book five next, the opening on getting out of bed." }),
    p({ id: "p9b", room: "shelf", type: "did", author: "Josh", at: ago(8, 3), cardId: "s-stoics", on: iso(-8), claim: "Read book four on the porch Sunday, brought the Hays translation to the table.", reason: "Luis and Dale were there; Maria has my copy now." }),
    p({ id: "p10", room: "question", type: "hosted", author: "Maria", at: ago(20), cardId: "s-question", on: iso(-20), next: iso(9), came: ["Josh", "Tom"], claim: "Nine chairs, all full, two we had never met. The question held for an hour and we did not agree. Same question next month." }),
    p({ id: "p11", room: "question", type: "did", author: "Josh", at: ago(20, 1), cardId: "s-question", on: iso(-20), claim: "Brought the Wimauma couple from church. They stayed after.", reason: "Maria can say so." }),
    p({ id: "p12", room: "coop", type: "hosted", author: "Ruth", at: ago(3, 4), cardId: "s-coop", on: iso(-3), next: iso(4), came: ["Maria"], named: "Maria", claim: "Finished the Aeneid book two. Three families read aloud. Maria brought the chairs." }),
    p({ id: "p14", room: "county", type: "did", author: "Josh", at: ago(1, 2), campaignId: "county-agenda", on: iso(-1), claim: "Board office: Ken Hagan, Chair, Hillsborough County Commission. Put the ordinance on the commission agenda.", reason: "Logged on the Quorum desk by Josh. Window 9am–11am local." }),
    p({ id: "p15", room: "county", type: "asked", author: "Dale", at: ago(2, 3), closed: true, cardId: "s-hearing", claim: "Does the Lithia Pinecrest hearing still happen on the date on the card?", reason: "Called District 4 twice, voicemail both times. The agenda page still shows the old date." }),
    p({ id: "p15r", room: "county", type: "asked", author: "Maria", at: ago(2, 5), parentId: "p15", claim: "Yes. Clerk's office confirmed by phone this morning, 9:10 a.m. Same date, 9 a.m., second floor." }),
    p({ id: "p16", room: "county", type: "noted", author: "Maria", at: ago(4), claim: "The county posts the full agenda packet the Friday before. Public comment cards are at the door, three minutes each.", reason: "hcfl.gov agenda page, and I did it in March." }),
    p({ id: "p17", room: "latin", type: "noted", author: "Luis", at: ago(6, 10), claim: "High Mass moves to 10:30 on the first Sunday of the month for the next three months.", reason: "Printed in the bulletin, Luis has a copy." }),
    p({ id: "p18", room: "dispatch", type: "saw", author: "Maria", at: ago(0, -2), on: iso(0), claim: "Sheriff's cruiser and a tow on the shoulder, I-75 southbound past Gibsonton. One lane.", reason: "3:55 p.m., I-75 SB near mile 250" }),
    p({ id: "p19", room: "dispatch", type: "saw", author: "Maria", at: ago(0, -1), on: iso(0), claim: "Two lanes closed on Bloomingdale at Lithia Pinecrest, crews on the median.", reason: "4:40 p.m., Bloomingdale and Lithia Pinecrest, eastbound side" }),
  ];

  const markLog: MarkRow[] = [{ id: "m1", room: "shop", postId: "p8", author: "Maria", by: "Tom", mark: "unsupported", at: ago(0, -18) }];

  const t1 = threadIdFor("Josh", "Dale");
  const t2 = threadIdFor("Josh", "Tom");
  const threads: DmThread[] = [
    { id: t1, between: ["Dale", "Josh"] },
    { id: t2, between: ["Josh", "Tom"] },
  ];
  const messages: DmMessage[] = [
    { id: "d1", threadId: t1, from: "Dale", text: "Can I bring my nephew Thursday? He has never held a saw.", at: ago(1, -2) },
    { id: "d2", threadId: t1, from: "Josh", text: "Ask Tom, he said yes to first-timers on the card. I can drive you both.", at: ago(1, -1) },
    { id: "d3", threadId: t1, from: "Dale", text: "Done. 6:15 at mine.", at: ago(1) },
    { id: "d4", threadId: t2, from: "Josh", text: "Dale's nephew is coming Thursday. Sixteen, never held a saw.", at: ago(0, -23) },
    { id: "d5", threadId: t2, from: "Tom", text: "Good. Put him on the chop saw with Luis first.", at: ago(0, -22) },
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
