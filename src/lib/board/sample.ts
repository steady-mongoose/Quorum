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
export const SAMPLE_VERSION = 5;

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
    // The Shop: hands and hobbies
    card("s-brew", "shop", "Homebrew night", "Luis's garage, Valrico", "First Saturday, 2 p.m. Bring a growler.", { host: "Luis", next: iso(8), lastFour: [true, true, true], wentBy: ["Luis", "Josh", "Tom", "Pete"], going: ["Josh", "Pete"], firstTimer: true }),
    card("s-whiskey", "shop", "Whiskey tasting, bourbon vs rye", "Brandon Brewing, back room", "Last Friday of the month, 8 p.m. $10 covers the pours.", { host: "Tom", next: iso(11), lastFour: [true, true], wentBy: ["Tom", "Dale", "Luis"], going: ["Dale"] }),
    card("s-lifts", "shop", "Saturday lifts, garage gym", "Dale's garage, Riverview", "Saturdays 7 a.m. Squat, press, deadlift. Coffee after.", { host: "Dale", next: iso(1), lastFour: [true, true, true, true], wentBy: ["Dale", "Josh", "Pete"], going: ["Josh", "Pete"], firstTimer: true }),
    // Literary Society: a second table
    card("s-federalist", "shelf", "The Federalist Papers, Tuesdays", "Tom's front room, Riverview", "Every other Tuesday, 7:30 p.m. Two papers a meeting.", { host: "Tom", next: iso(4), lastFour: [true, true, true], wentBy: ["Tom", "Josh", "Maria", "Pete"], going: ["Josh", "Maria"], book: "The Federalist Papers, Hamilton, Madison, Jay", pages: "Federalist 10 and 51" }),
    // Church rooms: the thinking parts
    card("s-thomist", "latin", "Summa after the 11", "Parish library, Epiphany", "Sundays 12:45, after coffee. One question of the Summa a week.", { host: "Luis", next: iso(3), lastFour: [true, true, true], wentBy: ["Luis", "Maria", "Josh"], going: ["Josh"], book: "Summa Theologiae, Prima Pars, Aquinas", pages: "Question 2, the five ways" }),
    card("s-catechism", "presbyterian", "Shorter Catechism class", "Redeemer, room 4", "Wednesdays 7 p.m. Q&A 1 through 107, one a week.", { host: "Ruth", next: iso(5), lastFour: [true, true, true, true], wentBy: ["Ruth", "Maria", "Tom"], going: ["Maria"], firstTimer: true }),
    card("s-vespers", "orthodox", "Vespers and coffee hour", "St. John the Baptist, 2418 W Swann Ave", "Saturdays 5 p.m., coffee after.", { host: "Pete", next: iso(1), lastFour: [true, true], wentBy: ["Pete", "Luis"], going: ["Luis"], book: "For the Life of the World, Schmemann", pages: "chapter 2" }),
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
    // The Shop: brewing, whiskey, lifting, hands
    p({ id: "p30", room: "shop", type: "hosted", author: "Luis", at: ago(22, 5), cardId: "s-brew", on: iso(-22), next: iso(8), came: ["Josh", "Tom", "Pete"], named: "Pete", claim: "Brewed a 5 gallon batch of the brown ale. Pete did the whole mash by himself first time out. Bottling day in 2 weeks, same garage, bring bottles. Thanks Tom for the propane." }),
    p({ id: "p31", room: "shop", type: "did", author: "Pete", at: ago(21), cardId: "s-brew", on: iso(-22), claim: "First time brewing. Ran the mash while Luis talked me through the temps. Didn't scorch it.", reason: "Luis and Josh were there, there's a photo of the mash tun." }),
    p({ id: "p32", room: "shop", type: "asked", author: "Josh", at: ago(9), claim: "Anybody have a spare carboy I can borrow for 3 weeks?", reason: "Mine cracked. Asked Luis, he's using both of his." }),
    p({ id: "p32r", room: "shop", type: "asked", author: "Tom", at: ago(9, 3), parentId: "p32", claim: "I've got one in the shed. Grab it Thursday." }),
    p({ id: "p33", room: "shop", type: "hosted", author: "Tom", at: ago(13, 2), cardId: "s-whiskey", on: iso(-13), next: iso(11), came: ["Dale", "Luis"], claim: "Bourbon vs rye night. 4 pours each side, blind. Rye won 5 to 2, Dale still says the bourbon was better. Next month we do wheated vs high rye. $10 at the door covers it." }),
    p({ id: "p34", room: "shop", type: "did", author: "Dale", at: ago(1, 4), cardId: "s-lifts", on: iso(-1), claim: "Saturday lifts. Pete pulled 315 for the first time. Josh hit a 5 lb press PR.", reason: "4 of us there, Josh filmed the pull." }),
    p({ id: "p35", room: "shop", type: "did", author: "Josh", at: ago(6, 2), claim: "Sharpened all 6 of the shop chisels on the water stones and stropped them. Took 2 hours.", reason: "Tom checked them Thursday. Shaving sharp." }),
    p({ id: "p36", room: "shop", type: "noted", author: "Tom", at: ago(3, 1), claim: "Welding class at HCC Brandon starts Jan 12, Tuesday nights, 8 weeks, about $300. 3 of us are signing up if anyone wants in.", reason: "hccfl.edu continuing ed page" }),

    // Literary Society: the Federalist table
    p({ id: "p40", room: "shelf", type: "hosted", author: "Tom", at: ago(10, 3), cardId: "s-federalist", on: iso(-10), next: iso(4), came: ["Josh", "Maria", "Pete"], named: "Maria", claim: "Federalist 1 and 2 done. Maria had read Brutus 1 too and made the anti-federalist case better than the book does. Next time 10 and 51, the two everybody quotes. Read them twice." }),
    p({ id: "p41", room: "shelf", type: "did", author: "Pete", at: ago(9, 2), cardId: "s-federalist", on: iso(-10), claim: "First Federalist night. Didn't know Publius was 3 guys. Reading 10 this week.", reason: "Tom hosted, Josh gave me a ride." }),
    p({ id: "p42", room: "shelf", type: "asked", author: "Josh", at: ago(5), claim: "Anyone got a copy of Reno's Return of the Strong Gods I can borrow before his talk?", reason: "Library has a 6 week hold on it." }),
    p({ id: "p42r", room: "shelf", type: "asked", author: "Luis", at: ago(5, 1), parentId: "p42", claim: "I do. Bring it Sunday." }),
    p({ id: "p43", room: "shelf", type: "noted", author: "Maria", at: ago(7), claim: "Hillsdale's free online course on the Federalist Papers is 10 lectures, about 30 min each, if you want background before Tuesday.", reason: "online.hillsdale.edu, I did 4 of them" }),

    // Latin Mass: the Summa group
    p({ id: "p50", room: "latin", type: "hosted", author: "Luis", at: ago(4, 7), cardId: "s-thomist", on: iso(-4), next: iso(3), came: ["Maria", "Josh"], claim: "Question 1 of the Summa, whether theology is a science. 7 of us in the library, Father stopped in for 10 minutes. Next week question 2, the five ways. Read the objections first, that's where the argument is." }),
    p({ id: "p51", room: "latin", type: "did", author: "Josh", at: ago(4, 9), cardId: "s-thomist", on: iso(-4), claim: "Sat in on the Summa group. Understood maybe half. Going back.", reason: "Luis ran it, Maria was there." }),

    // Reformed Presbyterian: catechism and a lecture
    p({ id: "p60", room: "presbyterian", type: "hosted", author: "Ruth", at: ago(2, 1), cardId: "s-catechism", on: iso(-2), next: iso(5), came: ["Maria", "Tom"], claim: "Q&A 4, what is God. Spent the whole hour on it and could have spent two. Q5 next Wednesday. Tom brought the Vos commentary which helped." }),
    p({ id: "p61", room: "presbyterian", type: "noted", author: "Maria", at: ago(3, 4), claim: "RTS Orlando is doing a Saturday lecture on covenant theology at Redeemer, Nov 8, 9 to noon, free. Sign up at the church office.", reason: "Bulletin insert, Ruth has it." }),

    // Greek Orthodox: vespers and Schmemann
    p({ id: "p70", room: "orthodox", type: "hosted", author: "Pete", at: ago(6, 2), cardId: "s-vespers", on: iso(-6), next: iso(1), came: ["Luis"], claim: "Vespers then coffee. We're reading Schmemann's For the Life of the World a chapter a week over coffee, chapter 2 this Saturday. Luis came from the Latin Mass side, glad to have him." }),

    // The County: the Reno talk
    p({ id: "p80", room: "county", type: "noted", author: "Tom", at: ago(2, 6), claim: "R.R. Reno is speaking on Return of the Strong Gods, Thursday the 23rd, 7 p.m., at [VENUE, TAMPA]. Free, registration required. A few of us are going, say so if you want a seat in the truck.", reason: "First Things events page, firstthings.com/events" }),
    p({ id: "p80r", room: "county", type: "noted", author: "Pete", at: ago(2, 5), parentId: "p80", claim: "I'm in." }),

    p({ id: "p17", room: "latin", type: "noted", author: "Luis", at: ago(6, 10), claim: "High Mass moves to 10:30 on first Sundays for the next 3 months.", reason: "It's in the bulletin, Luis has one." }),
    p({ id: "p18", room: "dispatch", type: "saw", author: "Maria", at: ago(0, -2), on: iso(0), claim: "Sheriff and a tow truck on the shoulder, I-75 south just past Gibsonton. Down to one lane.", reason: "3:55pm, I-75 SB around mile 250" }),
    p({ id: "p19", room: "dispatch", type: "saw", author: "Maria", at: ago(0, -1), on: iso(0), claim: "2 lanes closed on Bloomingdale at Lithia Pinecrest, crew on the median.", reason: "4:40pm, Bloomingdale and Lithia Pinecrest, eastbound" }),
  ];

  const markLog: MarkRow[] = [{ id: "m1", room: "shop", postId: "p8", author: "Maria", by: "Tom", mark: "unsupported", at: ago(0, -18) }];

  const t1 = threadIdFor("Josh", "Dale");
  const t2 = threadIdFor("Josh", "Tom");
  const t3 = threadIdFor("Josh", "Pete");
  const threads: DmThread[] = [
    { id: t1, between: ["Dale", "Josh"] },
    { id: t2, between: ["Josh", "Tom"] },
    { id: t3, between: ["Josh", "Pete"] },
  ];
  const messages: DmMessage[] = [
    { id: "d6", threadId: t3, from: "Pete", text: "you going to lifts saturday? can you grab me, truck's in the shop", at: ago(0, -5) },
    { id: "d7", threadId: t3, from: "Josh", text: "yeah. 6:40 at yours. bring the federalist book back, Tom wants it", at: ago(0, -4) },
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
