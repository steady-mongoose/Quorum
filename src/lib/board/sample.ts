// Seed cards from the brief, and a sample week on The Board: one invite-only
// group around Brandon and Riverview. Every name in the week is invented, and
// every post obeys the composer rules, so loading it also exercises the sort
// tiers, the shelf, trade witnesses, the mark log, and the message gate.

import {
  DAY,
  HOUR,
  newPost,
  threadIdFor,
  todayIso,
  type CardKind,
  type DmMessage,
  type DmThread,
  type MarkRow,
  type MeetingCard,
  type Post,
  type RoomId,
} from "@/lib/board/model";

function card(
  id: string,
  room: RoomId,
  name: string,
  place: string,
  time: string,
  extra: Partial<MeetingCard> & { kind?: CardKind } = {},
): MeetingCard {
  return {
    id,
    room,
    kind: "meeting",
    name,
    place,
    time,
    host: "",
    next: "",
    lastFour: [],
    wentBy: [],
    pinned: false,
    unverified: false,
    firstTimer: false,
    ...extra,
  };
}

/** Checked once by the brief, still to be visited before they stay. */
const brief = { unverified: true, wentBy: ["brief"] };

export const SEED_CARDS: MeetingCard[] = [
  card("latin-epiphany", "latin", "Epiphany of Our Lord Shrine", "2510 E Hanna Ave, Tampa", "Sunday Low Mass 7 and 9, High Mass 11", { host: "Institute of Christ the King", ...brief }),
  card("orthodox-stjohn", "orthodox", "St. John the Baptist", "2418 W Swann Ave, Tampa", "Confirm in person", brief),
  card("reformed-redeemer", "reformed", "Redeemer Presbyterian", "Boyette Road, Riverview", "Confirm in person", brief),
  card("reformed-first", "reformed", "First Reformed", "W Hillsborough Ave, Tampa", "Confirm in person", brief),
  card("skills-ham", "skills", "Tampa Amateur Radio Club", "7801 N 22nd St, Tampa", "First Monday 7:30 p.m. Tuesday net 147.105 at 8 p.m.", brief),
  card("skills-garden", "skills", "Hillsborough Master Gardener desk", "(813) 744-5519 ext. 54102", "Office hours", brief),
  card("skills-stoics", "skills", "Tampa Stoics", "Tampa", "Confirm in person", brief),
  card("guilds-shapes", "guilds", "Shapes, women's gym hour", "731 W Lumsden, Brandon", "Confirm in person", brief),
];

export type SampleBoard = {
  me: string;
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
    card("s-framing", "guilds", "Framing apprentice night", "Tom's shop, Riverview", "Thursdays 6:30 p.m.", { host: "Tom", next: iso(2), lastFour: [true, true, false, true], wentBy: ["Tom", "Josh", "Dale", "Luis"], firstTimer: true }),
    card("s-ham", "skills", "Tampa Amateur Radio Club", "7801 N 22nd St, Tampa", "First Monday 7:30 p.m. Tuesday net 147.105 at 8 p.m.", { host: "Dale", next: iso(5), lastFour: [true, true, true, true], wentBy: ["Dale", "Josh"], firstTimer: true }),
    card("s-hall", "hall", "One question: what do we owe the county?", "Brandon hall, back room", "Second Tuesday 7 p.m.", { host: "Maria", next: iso(9), lastFour: [true, true], wentBy: ["Maria", "Josh", "Tom"] }),
    card("s-school", "school", "Riverview classical co-op, Tuesday chapter", "[CHURCH HALL], Riverview", "Tuesdays 9 a.m., term time", { host: "Ruth", next: iso(4), lastFour: [true, true, true], wentBy: ["Ruth", "Maria"], firstTimer: true }),
    card("s-hearing", "civic", "County hearing: Lithia Pinecrest widening", "County Center, 601 E Kennedy, 2nd floor", "9 a.m.", { host: "Maria", next: iso(13), lastFour: [true], wentBy: ["Maria", "Josh"] }),
    card("s-lamb", "skills", "Lamb Electric", "Valrico", "Electrical, residential", { kind: "trade", host: "Luis" }),
    card("s-bakery", "skills", "Ruth's sourdough", "Brandon", "Bread, by the loaf, Saturdays", { kind: "trade", host: "Ruth" }),
    card("s-latin", "latin", "Epiphany of Our Lord Shrine", "2510 E Hanna Ave, Tampa", "Sunday Low Mass 7 and 9, High Mass 11", { host: "Institute of Christ the King", next: iso(3), lastFour: [true, true, true, true], wentBy: ["Luis", "Maria"] }),
  ];

  const p = (fields: Parameters<typeof newPost>[0] & { id: string }) => newPost(fields);

  const posts: Post[] = [
    // Guilds: the host closed last Thursday, two people filed around it.
    p({ id: "p1", room: "guilds", type: "hosted", author: "Tom", at: ago(5, 3), cardId: "s-framing", on: iso(-5), next: iso(2), claim: "Full bench. Walked the two new ones through a header and a jack stud. Next week we cut rafters." }),
    p({ id: "p2", room: "guilds", type: "did", author: "Josh", at: ago(5, 4), cardId: "s-framing", on: iso(-5), claim: "Framed my first header. Tom checked it twice before it went in.", reason: "Photo on my phone, Tom and Luis were there." }),
    p({ id: "p3", room: "guilds", type: "asked", author: "Dale", at: ago(3), closed: true, claim: "Is there a Saturday slot for someone who works Thursday nights?", reason: "Asked Tom in person, he said to put it on the board and see who else wants one." }),
    p({ id: "p3r", room: "guilds", type: "asked", author: "Tom", at: ago(3, 2), parentId: "p3", claim: "Two of us would come. If a third says so here, I will open the shop at 8." }),

    // Skills: a trade gets its two witnesses; a Noted gets marked.
    p({ id: "p4", room: "skills", type: "did", author: "Tom", at: ago(6), tradeId: "s-lamb", on: iso(-6), claim: "Luis replaced the panel in the shop. Inspector passed it first visit.", reason: "Permit number on the shop wall, Dale saw the inspector sign." }),
    p({ id: "p5", room: "skills", type: "did", author: "Dale", at: ago(4, 1), tradeId: "s-lamb", on: iso(-4), claim: "Luis ran a 240 line to the garage for the welder. Clean work, one afternoon.", reason: "Receipt dated last Tuesday, my wife was home for it." }),
    p({ id: "p6", room: "skills", type: "did", author: "Josh", at: ago(2), tradeId: "s-bakery", on: iso(-2), claim: "Two loaves from Ruth, Saturday. Second one went to the Nelsons.", reason: "Paid cash at her door, Maria was with me." }),
    p({ id: "p7", room: "skills", type: "hosted", author: "Dale", at: ago(1, 1), cardId: "s-ham", on: iso(-1), next: iso(5), claim: "Net ran clean. Three check-ins from Riverview this time, which is new." }),
    p({ id: "p8", room: "skills", type: "noted", author: "Luis", at: ago(0, -20), mark: "unsupported", claim: "The club's repeater is moving frequencies next month.", reason: "heard it at the net" }),
    p({ id: "p9", room: "skills", type: "noted", author: "Maria", at: ago(2, 5), claim: "Hillsborough Master Gardener desk takes soil samples Wednesdays, (813) 744-5519 ext. 54102.", reason: "Called them Monday, the woman on the desk confirmed it." }),

    // Public hall
    p({ id: "p10", room: "hall", type: "hosted", author: "Maria", at: ago(20), cardId: "s-hall", on: iso(-20), next: iso(9), claim: "Nine chairs, all full, two we had never met. The question held for an hour and we did not agree. Same question next month." }),
    p({ id: "p11", room: "hall", type: "did", author: "Josh", at: ago(20, 1), cardId: "s-hall", on: iso(-20), claim: "Brought the Wimauma couple from church. They stayed after.", reason: "Maria can say so." }),

    // School
    p({ id: "p12", room: "school", type: "hosted", author: "Ruth", at: ago(3, 4), cardId: "s-school", on: iso(-3), next: iso(4), claim: "Finished the Aeneid book two. Three families read aloud. The little ones built a horse out of chairs." }),
    p({ id: "p13", room: "school", type: "noted", author: "Maria", at: ago(3, 6), claim: "The co-op's spring term starts the second Tuesday of January. Chapter list goes up after Thanksgiving.", reason: "Ruth said so at Tuesday chapter." }),

    // Civic
    p({ id: "p14", room: "civic", type: "did", author: "Josh", at: ago(1, 2), campaignId: "county-agenda", on: iso(-1), claim: "Board office: Ken Hagan, Chair, Hillsborough County Commission. Put the ordinance on the commission agenda.", reason: "Logged on the Quorum desk by Josh. Window 9am–11am local." }),
    p({ id: "p15", room: "civic", type: "asked", author: "Dale", at: ago(2, 3), closed: true, cardId: "s-hearing", claim: "Does the Lithia Pinecrest hearing still happen on the date on the card?", reason: "Called District 4 twice, voicemail both times. The agenda page still shows the old date." }),
    p({ id: "p15r", room: "civic", type: "asked", author: "Maria", at: ago(2, 5), parentId: "p15", claim: "Yes. Clerk's office confirmed by phone this morning, 9:10 a.m. Same date, 9 a.m., second floor." }),
    p({ id: "p16", room: "civic", type: "noted", author: "Maria", at: ago(4), claim: "The county posts the full agenda packet the Friday before. Public comment cards are at the door, three minutes each.", reason: "hcfl.gov agenda page, and I did it in March." }),

    // Latin Mass
    p({ id: "p17", room: "latin", type: "noted", author: "Luis", at: ago(6, 10), claim: "High Mass moves to 10:30 on the first Sunday of the month for the next three months.", reason: "Printed in the bulletin, Luis has a copy." }),

    // Dispatch: two clean Saws and one sloppy one.
    p({ id: "p18", room: "dispatch", type: "saw", author: "Dale", at: ago(0, -2), on: iso(0), claim: "Sheriff's cruiser and a tow on the shoulder, I-75 southbound past Gibsonton. Traffic down to one lane.", reason: "3:55 p.m., I-75 SB near mile 250" }),
    p({ id: "p19", room: "dispatch", type: "saw", author: "Josh", at: ago(0, -1), on: iso(0), claim: "Two lanes closed on Bloomingdale at Lithia Pinecrest, crews on the median.", reason: "4:40 p.m., Bloomingdale and Lithia Pinecrest, eastbound side" }),
    p({ id: "p20", room: "dispatch", type: "saw", author: "Rick", at: ago(1), on: iso(-1), mark: "sloppy", claim: "https://example.com/some-video", reason: "around noon somewhere on 301" }),
  ];

  const markLog: MarkRow[] = [
    { id: "m1", room: "skills", postId: "p8", author: "Luis", by: "Maria", mark: "unsupported", at: ago(0, -18) },
    { id: "m2", room: "dispatch", postId: "p20", author: "Rick", by: "Maria", mark: "sloppy", at: ago(0, -22) },
  ];

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

  return { me: "Josh", posts, cards, markLog, threads, messages };
}
