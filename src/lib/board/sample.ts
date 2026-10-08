// A sample week on The Board: one invite-only group around Brandon and
// Riverview, Hillsborough County. Every name is invented. Every post obeys
// the composer rules, so the sample is also a test of the sort tiers,
// the shelf, trade witnesses, the mark log, and the message gate.

import {
  threadIdFor,
  todayIso,
  type DmMessage,
  type DmThread,
  type MarkRow,
  type MeetingCard,
  type Post,
} from "@/lib/board/model";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function iso(daysFromNow: number): string {
  return todayIso(new Date(Date.now() + daysFromNow * DAY));
}

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
  const me = "Josh";

  const cards: MeetingCard[] = [
    {
      id: "s-framing",
      room: "guilds",
      kind: "meeting",
      name: "Framing apprentice night",
      place: "Tom's shop, Riverview",
      time: "Thursdays 6:30 p.m.",
      host: "Tom",
      next: iso(2),
      lastFour: [true, true, false, true],
      visits: 6,
      pinned: false,
      unverified: false,
      addedBy: "Tom",
      wentBy: ["Tom", "Josh", "Dale", "Luis"],
      firstTimer: true,
    },
    {
      id: "s-ham",
      room: "skills",
      kind: "meeting",
      name: "Tampa Amateur Radio Club",
      place: "7801 N 22nd St, Tampa",
      time: "First Monday 7:30 p.m. Tuesday net 147.105 at 8 p.m.",
      host: "Dale",
      next: iso(5),
      lastFour: [true, true, true, true],
      visits: 9,
      pinned: false,
      unverified: false,
      addedBy: "Dale",
      wentBy: ["Dale", "Josh"],
      firstTimer: true,
    },
    {
      id: "s-hall",
      room: "hall",
      kind: "meeting",
      name: "One question: what do we owe the county?",
      place: "Brandon hall, back room",
      time: "Second Tuesday 7 p.m.",
      host: "Maria",
      next: iso(9),
      lastFour: [true, true],
      visits: 3,
      pinned: false,
      unverified: false,
      addedBy: "Maria",
      wentBy: ["Maria", "Josh", "Tom"],
      firstTimer: false,
    },
    {
      id: "s-school",
      room: "school",
      kind: "meeting",
      name: "Riverview classical co-op, Tuesday chapter",
      place: "[CHURCH HALL], Riverview",
      time: "Tuesdays 9 a.m., term time",
      host: "Ruth",
      next: iso(4),
      lastFour: [true, true, true],
      visits: 4,
      pinned: false,
      unverified: false,
      addedBy: "Ruth",
      wentBy: ["Ruth", "Maria"],
      firstTimer: true,
    },
    {
      id: "s-hearing",
      room: "civic",
      kind: "meeting",
      name: "County hearing: Lithia Pinecrest widening",
      place: "County Center, 601 E Kennedy, 2nd floor",
      time: "9 a.m.",
      host: "Maria",
      next: iso(13),
      lastFour: [true],
      visits: 2,
      pinned: false,
      unverified: false,
      addedBy: "Maria",
      wentBy: ["Maria", "Josh"],
      firstTimer: false,
    },
    {
      id: "s-lamb",
      room: "skills",
      kind: "trade",
      name: "Lamb Electric",
      place: "Valrico",
      time: "Electrical, residential",
      host: "Luis",
      next: "",
      lastFour: [],
      visits: 0,
      pinned: false,
      unverified: false,
      addedBy: "Dale",
      wentBy: [],
      firstTimer: false,
    },
    {
      id: "s-bakery",
      room: "skills",
      kind: "trade",
      name: "Ruth's sourdough",
      place: "Brandon",
      time: "Bread, by the loaf, Saturdays",
      host: "Ruth",
      next: "",
      lastFour: [],
      visits: 0,
      pinned: false,
      unverified: false,
      addedBy: "Ruth",
      wentBy: [],
      firstTimer: false,
    },
    {
      id: "s-latin",
      room: "latin",
      kind: "meeting",
      name: "Epiphany of Our Lord Shrine",
      place: "2510 E Hanna Ave, Tampa",
      time: "Sunday Low Mass 7 and 9, High Mass 11",
      host: "Institute of Christ the King",
      next: iso(3),
      lastFour: [true, true, true, true],
      visits: 3,
      pinned: false,
      unverified: false,
      addedBy: "Luis",
      wentBy: ["Luis", "Maria"],
      firstTimer: false,
    },
  ];

  const base = (overrides: Partial<Post> & Pick<Post, "id" | "room" | "type" | "claim" | "author" | "at">): Post => ({
    reason: "",
    on: "",
    parentId: null,
    closed: false,
    mark: null,
    removed: false,
    ...overrides,
  });

  const posts: Post[] = [
    // Guilds: the host closed last Thursday, two people filed Dids.
    base({
      id: "p1",
      room: "guilds",
      type: "hosted",
      claim: "Full bench. Walked the two new ones through a header and a jack stud. Next week we cut rafters.",
      reason: iso(2),
      on: iso(-5),
      author: "Tom",
      at: now - 5 * DAY + 3 * HOUR,
      cardId: "s-framing",
    }),
    base({
      id: "p2",
      room: "guilds",
      type: "did",
      claim: "Framed my first header. Tom checked it twice before it went in.",
      reason: "Photo on my phone, Tom and Luis were there.",
      on: iso(-5),
      author: "Josh",
      at: now - 5 * DAY + 4 * HOUR,
      cardId: "s-framing",
    }),
    base({
      id: "p3",
      room: "guilds",
      type: "asked",
      claim: "Is there a Saturday slot for someone who works Thursday nights?",
      reason: "Asked Tom in person, he said to put it on the board and see who else wants one.",
      author: "Dale",
      at: now - 3 * DAY,
      closed: true,
    }),
    base({
      id: "p3r",
      room: "guilds",
      type: "asked",
      claim: "Two of us would come. If a third says so here, I will open the shop at 8.",
      author: "Tom",
      at: now - 3 * DAY + 2 * HOUR,
      parentId: "p3",
    }),

    // Skills: a trade card gets its two witnesses; a Noted gets marked.
    base({
      id: "p4",
      room: "skills",
      type: "did",
      claim: "Luis replaced the panel in the shop. Inspector passed it first visit.",
      reason: "Permit number on the shop wall, Dale saw the inspector sign.",
      on: iso(-6),
      author: "Tom",
      at: now - 6 * DAY,
      tradeId: "s-lamb",
    }),
    base({
      id: "p5",
      room: "skills",
      type: "did",
      claim: "Luis ran a 240 line to the garage for the welder. Clean work, one afternoon.",
      reason: "Receipt dated last Tuesday, my wife was home for it.",
      on: iso(-4),
      author: "Dale",
      at: now - 4 * DAY + HOUR,
      tradeId: "s-lamb",
    }),
    base({
      id: "p6",
      room: "skills",
      type: "did",
      claim: "Two loaves from Ruth, Saturday. Second one went to the Nelsons.",
      reason: "Paid cash at her door, Maria was with me.",
      on: iso(-2),
      author: "Josh",
      at: now - 2 * DAY,
      tradeId: "s-bakery",
    }),
    base({
      id: "p7",
      room: "skills",
      type: "hosted",
      claim: "Net ran clean. Three check-ins from Riverview this time, which is new.",
      reason: iso(5),
      on: iso(-1),
      author: "Dale",
      at: now - DAY + HOUR,
      cardId: "s-ham",
    }),
    base({
      id: "p8",
      room: "skills",
      type: "noted",
      claim: "The club's repeater is moving frequencies next month.",
      reason: "heard it at the net",
      author: "Luis",
      at: now - 20 * HOUR,
      mark: "unsupported",
    }),
    base({
      id: "p9",
      room: "skills",
      type: "noted",
      claim: "Hillsborough Master Gardener desk takes soil samples Wednesdays, (813) 744-5519 ext. 54102.",
      reason: "Called them Monday, the woman on the desk confirmed it.",
      author: "Maria",
      at: now - 2 * DAY + 5 * HOUR,
    }),

    // Public hall: the question, the Hosted, and one Did.
    base({
      id: "p10",
      room: "hall",
      type: "hosted",
      claim: "Nine chairs, all full, two we had never met. The question held for an hour and we did not agree. Same question next month.",
      reason: iso(9),
      on: iso(-20),
      author: "Maria",
      at: now - 20 * DAY,
      cardId: "s-hall",
    }),
    base({
      id: "p11",
      room: "hall",
      type: "did",
      claim: "Brought the Wimauma couple from church. They stayed after.",
      reason: "Maria can say so.",
      on: iso(-20),
      author: "Josh",
      at: now - 20 * DAY + HOUR,
      cardId: "s-hall",
    }),

    // School
    base({
      id: "p12",
      room: "school",
      type: "hosted",
      claim: "Finished the Aeneid book two. Three families read aloud. The little ones built a horse out of chairs.",
      reason: iso(4),
      on: iso(-3),
      author: "Ruth",
      at: now - 3 * DAY + 4 * HOUR,
      cardId: "s-school",
    }),
    base({
      id: "p13",
      room: "school",
      type: "noted",
      claim: "The co-op's spring term starts the second Tuesday of January. Chapter list goes up after Thanksgiving.",
      reason: "Ruth said so at Tuesday chapter.",
      author: "Maria",
      at: now - 3 * DAY + 6 * HOUR,
    }),

    // Civic: a desk call, a hearing question, an answered reply.
    base({
      id: "p14",
      room: "civic",
      type: "did",
      claim: "Board office: Ken Hagan, Chair, Hillsborough County Commission. Put the ordinance on the commission agenda.",
      reason: "Logged on the Quorum desk by Josh. Window 9am–11am local.",
      on: iso(-1),
      author: "Josh",
      at: now - DAY + 2 * HOUR,
      campaignId: "county-agenda",
    }),
    base({
      id: "p15",
      room: "civic",
      type: "asked",
      claim: "Does the Lithia Pinecrest hearing still happen on the date on the card?",
      reason: "Called District 4 twice, voicemail both times. The agenda page still shows the old date.",
      author: "Dale",
      at: now - 2 * DAY + 3 * HOUR,
      closed: true,
      cardId: "s-hearing",
    }),
    base({
      id: "p15r",
      room: "civic",
      type: "asked",
      claim: "Yes. Clerk's office confirmed by phone this morning, 9:10 a.m. Same date, 9 a.m., second floor.",
      author: "Maria",
      at: now - 2 * DAY + 5 * HOUR,
      parentId: "p15",
    }),
    base({
      id: "p16",
      room: "civic",
      type: "noted",
      claim: "The county posts the full agenda packet the Friday before. Public comment cards are at the door, three minutes each.",
      reason: "hcfl.gov agenda page, and I did it in March.",
      author: "Maria",
      at: now - 4 * DAY,
    }),

    // Latin Mass: service time only.
    base({
      id: "p17",
      room: "latin",
      type: "noted",
      claim: "High Mass moves to 10:30 on the first Sunday of the month for the next three months.",
      reason: "Printed in the bulletin, Luis has a copy.",
      author: "Luis",
      at: now - 6 * DAY + 10 * HOUR,
    }),

    // Dispatch: two clean Saws and one sloppy one.
    base({
      id: "p18",
      room: "dispatch",
      type: "saw",
      claim: "Sheriff's cruiser and a tow on the shoulder, I-75 southbound past Gibsonton. Traffic down to one lane.",
      reason: "3:55 p.m., I-75 SB near mile 250",
      on: iso(0),
      author: "Dale",
      at: now - 2 * HOUR,
    }),
    base({
      id: "p19",
      room: "dispatch",
      type: "saw",
      claim: "Two lanes closed on Bloomingdale at Lithia Pinecrest, crews on the median.",
      reason: "4:40 p.m., Bloomingdale and Lithia Pinecrest, eastbound side",
      on: iso(0),
      author: "Josh",
      at: now - HOUR,
    }),
    base({
      id: "p20",
      room: "dispatch",
      type: "saw",
      claim: "https://example.com/some-video",
      reason: "around noon somewhere on 301",
      on: iso(-1),
      author: "Rick",
      at: now - DAY,
      mark: "sloppy",
    }),
  ];

  const markLog: MarkRow[] = [
    { id: "m1", room: "skills", postId: "p8", author: "Luis", by: "Maria", mark: "unsupported", at: now - 18 * HOUR },
    { id: "m2", room: "dispatch", postId: "p20", author: "Rick", by: "Maria", mark: "sloppy", at: now - 22 * HOUR },
  ];

  const t1 = threadIdFor("Josh", "Dale");
  const t2 = threadIdFor("Josh", "Tom");
  const threads: DmThread[] = [
    { id: t1, between: ["Dale", "Josh"] },
    { id: t2, between: ["Josh", "Tom"] },
  ];
  const messages: DmMessage[] = [
    { id: "d1", threadId: t1, from: "Dale", text: "Can I bring my nephew Thursday? He has never held a saw.", at: now - 26 * HOUR },
    { id: "d2", threadId: t1, from: "Josh", text: "Ask Tom, he said yes to first-timers on the card. I can drive you both.", at: now - 25 * HOUR },
    { id: "d3", threadId: t1, from: "Dale", text: "Done. 6:15 at mine.", at: now - 24 * HOUR },
    { id: "d4", threadId: t2, from: "Josh", text: "Dale's nephew is coming Thursday. Sixteen, never held a saw.", at: now - 23 * HOUR },
    { id: "d5", threadId: t2, from: "Tom", text: "Good. Put him on the chop saw with Luis first.", at: now - 22 * HOUR },
  ];

  return { me, posts, cards, markLog, threads, messages };
}
