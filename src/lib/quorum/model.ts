export type Level = "federal" | "state" | "county";
export type Chamber = "house" | "senate" | "switchboard" | "executive" | "commission";
export type Posture = "absolute" | "partial";
export type Wave = "dc" | "district" | "letter" | "visit";
export type View = "load" | "desk" | "doctrine" | "offices" | "cell";

export type Office = {
  id: string;
  name: string;
  role: string;
  party: string;
  state: string;
  level: Level;
  chamber: Chamber;
  dcPhone: string;
  phoneNote?: string;
  districtPhone?: string;
  districtLabel?: string;
  address: string;
  contactUrl: string;
  holds: string;
  homeMatch?: string[];
};

export type Campaign = {
  id: string;
  title: string;
  demand: string;
  principle: string;
  refuses: string[];
  officeId: string;
  threshold: number;
  posture: Posture;
  surgeStart: number;
  surgeEnd: number;
  seeded: boolean;
};

export type LogEntry = {
  id: string;
  campaignId: string;
  wave: Wave;
  who: string;
  at: number;
};

export type Ally = {
  id: string;
  campaignId: string;
  name: string;
  pledged: number;
  channel: string;
};

export type CellMember = {
  id: string;
  name: string;
  place: string;
};

export type Profile = {
  name: string;
  place: string;
};

export function wavesFor(level: Level): { id: Wave; label: string; hint: string }[] {
  const primary =
    level === "federal" ? "DC office" : level === "state" ? "Capitol office" : "Board office";
  const primaryHint =
    level === "county"
      ? "The line that logs a hearing request before the agenda closes."
      : "The line leadership staff actually watches during the window.";
  const local = level === "county" ? "District commissioner" : "District office";
  const localHint =
    level === "county"
      ? "Your district commissioner, if the chair is not your only call."
      : "Local staff record pressure the capitol desk cannot shrug off.";
  return [
    { id: "dc", label: primary, hint: primaryHint },
    { id: "district", label: local, hint: localHint },
    {
      id: "letter",
      label: "Written record",
      hint: "Paste the same sentence into the official contact form.",
    },
    {
      id: "visit",
      label: "Office visit",
      hint: "Log this only after a real visit, not a plan to go.",
    },
  ];
}

const STATE_NAMES: Record<string, string> = {
  LA: "louisiana",
  SD: "south dakota",
  NY: "new york",
  WY: "wyoming",
  IL: "illinois",
  FL: "florida",
};

export const LEVELS: {
  id: Level;
  label: string;
  scatterAcross: number;
  scatterTitle: string;
  scatterNoun: string;
}[] = [
  {
    id: "federal",
    label: "Federal",
    scatterAcross: 435,
    scatterTitle: "Across Congress",
    scatterNoun: "House offices",
  },
  {
    id: "state",
    label: "State",
    scatterAcross: 120,
    scatterTitle: "Across the Florida House",
    scatterNoun: "state House offices",
  },
  {
    id: "county",
    label: "County",
    scatterAcross: 7,
    scatterTitle: "Across the commission",
    scatterNoun: "commissioners",
  },
];

export function levelMeta(level: Level) {
  return LEVELS.find((item) => item.id === level) ?? LEVELS[0];
}

const WEASEL =
  /\b(reasonable regulation|common[- ]sense exception|phase[- ]in|grandfather|exceptions for|except when|except for|limited exceptions|balanced approach|compromise bill|up to \d|no more than|cap of \d)\b/i;

export const OFFICES: Office[] = [
  {
    id: "switchboard",
    name: "Capitol Switchboard",
    role: "Any member, by name",
    party: "",
    state: "US",
    chamber: "switchboard",
    level: "federal",
    dcPhone: "(202) 224-3121",
    phoneNote: "Ask for the member or the committee chair by name.",
    address: "U.S. Capitol, Washington, DC",
    contactUrl: "https://www.congress.gov/members",
    holds: "The one public number that reaches every office. Use it when the person killing the bill is a chair who is not listed here.",
  },
  {
    id: "johnson",
    name: "Mike Johnson",
    role: "Speaker of the House",
    party: "R",
    state: "LA-4",
    level: "federal",
    chamber: "house",
    dcPhone: "(202) 225-2777",
    address: "568 Cannon House Office Building, Washington, DC 20515",
    contactUrl: "https://mikejohnson.house.gov/contact/",
    holds: "Nothing reaches the House floor without this office. A committee can report a bill that dies here, unscheduled.",
  },
  {
    id: "scalise",
    name: "Steve Scalise",
    role: "House Majority Leader",
    party: "R",
    state: "LA-1",
    level: "federal",
    chamber: "house",
    dcPhone: "(202) 225-3015",
    address: "U.S. House of Representatives, Washington, DC 20515",
    contactUrl: "https://scalise.house.gov/",
    holds: "Sets the House floor schedule. If the pure text is not on this calendar, it is not coming up.",
  },
  {
    id: "rules",
    name: "House Committee on Rules",
    role: "The gate before the floor",
    party: "",
    state: "US",
    level: "federal",
    chamber: "house",
    dcPhone: "(202) 224-3121",
    phoneNote: "Capitol switchboard — ask for the Chair of the House Committee on Rules.",
    address: "House Committee on Rules, Washington, DC",
    contactUrl: "https://rules.house.gov/",
    holds: "Major bills need a rule. This committee decides whether the unamended text survives, and whether amendments are even allowed.",
  },
  {
    id: "jeffries",
    name: "Hakeem Jeffries",
    role: "House Minority Leader",
    party: "D",
    state: "NY-8",
    level: "federal",
    chamber: "house",
    dcPhone: "(202) 225-5936",
    address: "2433 Rayburn House Office Building, Washington, DC 20515",
    contactUrl: "https://jeffries.house.gov/contact/",
    holds: "Decides whether the minority forces a procedural fight or lets a substitute pass quietly.",
  },
  {
    id: "thune",
    name: "John Thune",
    role: "Senate Majority Leader",
    party: "R",
    state: "SD",
    level: "federal",
    chamber: "senate",
    dcPhone: "(202) 224-2321",
    districtPhone: "(605) 334-9596",
    districtLabel: "Sioux Falls",
    address: "511 Dirksen Senate Office Building, Washington, DC 20510",
    contactUrl: "https://www.thune.senate.gov/public/index.cfm/contact",
    holds: "The Senate floor is this office. Holds, consent agreements, and what receives a vote run through it.",
  },
  {
    id: "schumer",
    name: "Chuck Schumer",
    role: "Senate Minority Leader",
    party: "D",
    state: "NY",
    level: "federal",
    chamber: "senate",
    dcPhone: "(202) 224-6542",
    address: "322 Hart Senate Office Building, Washington, DC 20510",
    contactUrl: "https://www.schumer.senate.gov/contact/",
    holds: "Controls whether the minority spends floor time. A bill can be alive on paper and dead in practice here.",
  },
  {
    id: "barrasso",
    name: "John Barrasso",
    role: "Senate Majority Whip",
    party: "R",
    state: "WY",
    level: "federal",
    chamber: "senate",
    dcPhone: "(202) 224-6441",
    districtPhone: "(307) 261-6413",
    districtLabel: "Casper",
    address: "U.S. Senate, Washington, DC 20510",
    contactUrl: "https://www.barrasso.senate.gov/",
    holds: "Counts votes before a vote exists. If the whip sheet says the pure bill is short, leadership reaches for a weaker draft.",
  },
  {
    id: "durbin",
    name: "Dick Durbin",
    role: "Senate Minority Whip",
    party: "D",
    state: "IL",
    level: "federal",
    chamber: "senate",
    dcPhone: "(202) 224-2152",
    districtPhone: "(217) 492-4062",
    districtLabel: "Springfield",
    address: "U.S. Senate, Washington, DC 20510",
    contactUrl: "https://www.durbin.senate.gov/",
    holds: "Whips the minority. Matters when the fight is whether they hold together against a substitute.",
  },
  {
    id: "desantis",
    name: "Ron DeSantis",
    role: "Governor of Florida",
    party: "R",
    state: "FL",
    level: "state",
    chamber: "executive",
    dcPhone: "(850) 717-9337",
    phoneNote: "Office of Citizen Services. A bill can pass the legislature and still die on this desk.",
    address: "The Capitol, 400 South Monroe Street, Tallahassee, FL 32399",
    contactUrl: "https://www.flgov.com/",
    holds: "Signs, vetoes, or lets a bill become law. If the fight is whether the clean text survives the desk, this is the choke point.",
    homeMatch: ["florida"],
  },
  {
    id: "duggan",
    name: "Wyman Duggan",
    role: "Acting Speaker, Florida House",
    party: "R",
    state: "FL",
    level: "state",
    chamber: "house",
    dcPhone: "(850) 717-5000",
    phoneNote: "Florida House line. Ask for the Speaker's office. Duggan has been acting Speaker since August 21, 2026.",
    address: "420 The Capitol, 402 South Monroe Street, Tallahassee, FL 32399",
    contactUrl: "https://www.flhouse.gov/",
    holds: "Nothing reaches the Florida House floor without this office. A committee can report a bill that dies here, unscheduled.",
    homeMatch: ["florida"],
  },
  {
    id: "albritton",
    name: "Ben Albritton",
    role: "President, Florida Senate",
    party: "R",
    state: "FL",
    level: "state",
    chamber: "senate",
    dcPhone: "(850) 487-5229",
    address: "409 The Capitol, 404 South Monroe Street, Tallahassee, FL 32399",
    contactUrl: "https://www.flsenate.gov/",
    holds: "The Senate calendar is this office. A House bill still dies here if the president never calls it.",
    homeMatch: ["florida"],
  },
  {
    id: "boyd",
    name: "Jim Boyd",
    role: "Majority Leader, Florida Senate",
    party: "R",
    state: "FL",
    level: "state",
    chamber: "senate",
    dcPhone: "(850) 487-5020",
    districtPhone: "(941) 742-6445",
    districtLabel: "Bradenton",
    address: "318 Senate Building, 404 South Monroe Street, Tallahassee, FL 32399",
    contactUrl: "https://www.flsenate.gov/Senators/S20",
    holds: "Counts the Senate majority. If the pure bill is short on his sheet, leadership reaches for a substitute.",
    homeMatch: ["florida"],
  },
  {
    id: "hagan",
    name: "Ken Hagan",
    role: "Chair, Hillsborough County Commission",
    party: "R",
    state: "FL",
    level: "county",
    chamber: "commission",
    dcPhone: "(813) 272-5452",
    phoneNote: "District 2. The board kept him as chair for 2025–2026 at the November 18, 2025 organizational meeting.",
    address: "Hillsborough County Commission, Tampa, FL",
    contactUrl: "https://hcfl.gov/government/board-of-county-commissioners/contact-your-commissioner",
    holds: "The chair sets what the commission hears. An ordinance that never makes the agenda never gets a vote. Seven commissioners, one agenda.",
    homeMatch: [
      "hillsborough",
      "tampa",
      "wimauma",
      "brandon",
      "plant city",
      "riverview",
      "ruskin",
      "sun city",
      "lutz",
      "valrico",
    ],
  },
  {
    id: "miller",
    name: "Christine Miller",
    role: "Vice Chair, District 4, Hillsborough",
    party: "R",
    state: "FL",
    level: "county",
    chamber: "commission",
    dcPhone: "(813) 272-5740",
    phoneNote:
      "South county. Wimauma, Ruskin, and Riverview sit in District 4. Confirm your district if you are near the line.",
    address: "Hillsborough County Commission, District 4",
    contactUrl: "https://hcfl.gov/government/board-of-county-commissioners/contact-your-commissioner",
    holds: "Your commissioner if you live in south Hillsborough. Call the chair to open the agenda, and this office so the vote is not free.",
    homeMatch: ["hillsborough", "wimauma", "riverview", "ruskin", "sun city", "gibsonton", "apollo beach", "balm"],
  },
];

export const SEED_CAMPAIGNS: Campaign[] = [
  {
    id: "hearing",
    title: "Force a hearing on the unamended bill",
    demand:
      "Schedule a hearing and a recorded vote on the clean bill. Do not replace it with a draft that regulates the harm, delays it, or licenses it.",
    principle:
      "The law tutors. A compromise statute teaches the public that the carve-out is the moral baseline.",
    refuses: [
      "Exceptions that immunize a favored group",
      "A study commission in place of a vote",
      "A sunset that restarts the fight from zero",
      "A numeric cap that sets a legal quota",
    ],
    officeId: "johnson",
    threshold: 200,
    posture: "absolute",
    surgeStart: 9 * 60,
    surgeEnd: 11 * 60,
    seeded: true,
  },
  {
    id: "floor",
    title: "Put the pure text on the Senate floor",
    demand:
      "Give the unamended bill a recorded vote. Do not trade it for a substitute that accepts the other side's premise.",
    principle:
      "Partial progress that codifies the opposing premise is not progress. It is how a quota becomes normal.",
    refuses: [
      "A manager's amendment that adds immunities",
      "Unanimous consent to pass a weaker bill",
      "Language that balances a non-negotiable standard",
    ],
    officeId: "thune",
    threshold: 150,
    posture: "absolute",
    surgeStart: 19 * 60,
    surgeEnd: 20 * 60 + 30,
    seeded: true,
  },
  {
    id: "rules-desk",
    title: "Make Rules report the clean text",
    demand:
      "Report a rule that brings the unamended bill to the floor. Do not strip the standard in the rule itself.",
    principle:
      "If the rule rewrites the bill, the floor vote is theater. The decision already happened in Rules.",
    refuses: [
      "A closed rule built around a substitute",
      "Amendment restrictions that protect carve-outs",
      "A waiver that lets the weaker text skip the fight",
    ],
    officeId: "rules",
    threshold: 120,
    posture: "absolute",
    surgeStart: 10 * 60,
    surgeEnd: 12 * 60,
    seeded: true,
  },
  {
    id: "florida-calendar",
    title: "Put the clean bill on the Florida calendar",
    demand:
      "Schedule the unamended bill for a recorded vote in the Florida House. Do not let it die in messages or come back as a committee substitute.",
    principle:
      "A state statute tutors the same way a federal one does. The compromise you pass in Tallahassee becomes the baseline.",
    refuses: [
      "A committee substitute that adds exceptions",
      "A study instead of a hearing",
      "A bill that licenses the harm it claims to limit",
    ],
    officeId: "duggan",
    threshold: 80,
    posture: "absolute",
    surgeStart: 9 * 60,
    surgeEnd: 11 * 60,
    seeded: true,
  },
  {
    id: "county-agenda",
    title: "Put the ordinance on the commission agenda",
    demand:
      "Place the unamended ordinance on the next Hillsborough County Commission agenda for a public hearing and a recorded vote.",
    principle:
      "County law teaches the county. A delayed hearing or a softened substitute tells people the carve-out is acceptable here.",
    refuses: [
      "A workshop in place of a vote",
      "A substitute that exempts part of the county",
      "Language that sets a numeric quota",
    ],
    officeId: "hagan",
    threshold: 40,
    posture: "absolute",
    surgeStart: 9 * 60,
    surgeEnd: 11 * 60,
    seeded: true,
  },
];

export const DOCTRINE: { id: string; kicker: string; title: string; body: string }[] = [
  {
    id: "stances",
    kicker: "The conflict",
    title: "Absolutism against incrementalism",
    body: "An absolute demand says the standard is the bill: immediate, equal, and unamended. An incremental demand accepts a partial statute because something passed is better than nothing. Quorum is built for the first posture. Partial bills can still be run — they are marked, so the cell knows what it would be teaching the public to accept.",
  },
  {
    id: "tutor",
    kicker: "The law as tutor",
    title: "A statute teaches",
    body: "Civil law does more than regulate. It tells the country what amount of a thing is acceptable. Write the compromise into the code and the compromise becomes the baseline the next legislature starts from. The call script says this out loud so staff cannot log you as support for the substitute.",
  },
  {
    id: "immunity",
    kicker: "Immunities",
    title: "Regulation can shelter what it claims to limit",
    body: "Bills that 'do something' often pass by adding exceptions, immunities, and loopholes. The practice is then licensed under conditions. The office gets credit for acting. The harm continues, now with a legal shelter. Put each immunity on the refuses list before anyone dials.",
  },
  {
    id: "equal",
    kicker: "Equal weights",
    title: "The same measure for every person",
    body: "Justice does not change by category, status, or whose donor is in the room. A carve-out is partiality written as law. On the phone, refuse it by name. Do not let a staffer trade your support for an exemption that keeps a favored group outside the standard.",
  },
  {
    id: "quota",
    kicker: "Quotas",
    title: "A legal cap is a quota for the wrong",
    body: "Allowing a restricted amount of something you hold to be wrong sets an official quota. The number becomes the argument, and the argument is already a loss. Quorum flags demand text that talks in caps, phase-ins, and 'balanced' exceptions so you see the quota before the window opens.",
  },
  {
    id: "bottleneck",
    kicker: "Where pressure goes",
    title: "Hit the choke point, not the crowd",
    body: "Bills and ordinances die in specific hands: a chair, the Rules Committee, a speaker, a floor leader, a governor's desk, a county agenda. Five hundred people spread across every office is a normal day. The same five hundred, in one window, on the one desk that can schedule the hearing, is a briefing that official cannot skip. PAC money buys access. A filled switchboard buys the meeting they did not schedule.",
  },
  {
    id: "account",
    kicker: "Direct accountability",
    title: "Take away the procedural hiding place",
    body: "The ask is a hearing or a recorded vote on the unamended text. Not concern. Not a conversation. Staff can file a mood. They have to log a procedural demand. Your cell logs only contacts that actually happened, so the count is a record, not a fantasy.",
  },
  {
    id: "parallel",
    kicker: "Parallel organization",
    title: "Keep the list on your own channel",
    body: "Establishments and PACs already own the access channel. A parallel cell is people you can actually reach: a precinct, a congregation, a group text. Quorum keeps that list on this device and hands you one script to paste into your channel. It does not dial, spoof, or pretend to be a crowd.",
  },
];

export function officesAt(level: Level, extra: Office[] = []): Office[] {
  return [...OFFICES, ...extra].filter((office) => office.level === level);
}

export function officeById(id: string, extra: Office[] = []): Office {
  return [...extra, ...OFFICES].find((office) => office.id === id) ?? OFFICES[0];
}

export function telHref(display: string): string {
  const digits = display.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return `tel:${digits}`;
}

export function formatClock(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const suffix = h24 >= 12 ? "pm" : "am";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  if (m === 0) return `${h12}${suffix}`;
  return `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

export function formatWindow(start: number, end: number): string {
  return `${formatClock(start)}–${formatClock(end)} local`;
}

export type WindowStatus = {
  live: boolean;
  minutes: number;
  label: string;
};

export function windowStatus(start: number, end: number, now: Date): WindowStatus {
  const mins = now.getHours() * 60 + now.getMinutes();
  const overnight = start > end;
  const live = overnight ? mins >= start || mins < end : mins >= start && mins < end;
  if (live) {
    const left = overnight
      ? mins >= start
        ? end + 24 * 60 - mins
        : end - mins
      : end - mins;
    return { live: true, minutes: left, label: `Live · ${left}m left` };
  }
  let until = start - mins;
  if (until <= 0) until += 24 * 60;
  const hours = Math.floor(until / 60);
  const rem = until % 60;
  const label = hours > 0 ? `Opens in ${hours}h ${rem}m` : `Opens in ${rem}m`;
  return { live: false, minutes: until, label };
}

export function windowKind(start: number): string {
  return start < 17 * 60
    ? "Morning window. The desk is staffed. Calls land with a person, not a mailbox."
    : "Evening window. Voicemails stack into one morning brief if the sentence is the same.";
}

export function weaselHit(demand: string): boolean {
  return WEASEL.test(demand);
}

export function livesInOfficeState(office: Office, place: string): boolean {
  if (office.level === "federal" && (office.chamber === "switchboard" || office.state === "US")) {
    return true;
  }
  if (office.homeMatch) {
    if (office.homeMatch.length === 0) return true;
    if (office.homeMatch.some((hint) => place.toLowerCase().includes(hint))) return true;
    if (office.level !== "federal") return false;
  }
  const abbr = office.state.slice(0, 2).toUpperCase();
  const full = STATE_NAMES[abbr];
  if (full && place.toLowerCase().includes(full)) return true;
  return new RegExp(`\\b${abbr}\\b`, "i").test(place);
}

export function outsideNote(office: Office, place: string): string | null {
  if (livesInOfficeState(office, place)) return null;
  if (office.level === "county") {
    return "You may not live in this county. Ordinances are decided by the people who do. If this is your county, put Hillsborough in your place line so the script is honest. If it is not, add your own commission chair under Offices.";
  }
  if (office.level === "state") {
    return "You may not live in this state. Say so, or call your own capitol. These lines are Florida. Another state is an office you add yourself.";
  }
  return "You may not live in this member's state. Say that. You are calling because this office controls the bill. Then use the Capitol switchboard, (202) 224-3121, and put the same sentence on file with your own member.";
}

export function callerLine(profile: Profile, shared = false): string {
  if (shared) return "My name is [your name]. I live in [your city].";
  const place = profile.place.trim() || "my community";
  if (profile.name.trim()) {
    return `My name is ${profile.name.trim()}. I live in ${place}.`;
  }
  return `I am a constituent calling from ${place}.`;
}

export function callScript(
  campaign: Campaign,
  office: Office,
  profile: Profile,
  shared = false,
): string {
  const refuses = campaign.refuses.map((item) => item.trim()).filter(Boolean);
  const refuseLine = refuses.length
    ? `I will not accept a substitute that does any of the following: ${refuses.join("; ")}.`
    : "I will not accept a substitute bill.";
  const ask =
    campaign.demand.trim() ||
    "I am asking for a hearing and a recorded vote on the unamended bill.";
  return [
    `Hello. ${callerLine(profile, shared)}`,
    "",
    `I am calling about ${office.name}, ${office.role}.`,
    "",
    ask,
    "",
    refuseLine,
    "",
    "Please log this call as support for that unamended standard only. A partial bill teaches the public that the compromise is the acceptable baseline. I do not consent to being counted for a weaker draft.",
    "",
    "I will send the same sentence in writing. Thank you.",
  ].join("\n");
}

export function letterBody(campaign: Campaign, office: Office, profile: Profile): string {
  const refuses = campaign.refuses.map((item) => item.trim()).filter(Boolean);
  const lines = [
    office.name,
    office.role,
    office.address,
    "",
    callerLine(profile),
    "",
    campaign.demand.trim() ||
      "I am writing to require a hearing and a recorded vote on the unamended bill.",
    "",
    refuses.length
      ? `I oppose any draft that includes: ${refuses.join("; ")}.`
      : "I oppose any substitute.",
    "",
    "Do not record me as support for a compromise. The statute teaches whatever it allows. I am asking only for the standard as written, applied equally, with no quota and no immunity.",
    "",
    profile.name.trim() || "A constituent",
    profile.place.trim(),
  ];
  return lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n");
}

export function phoneTree(campaign: Campaign, office: Office, profile: Profile): string {
  return [
    `QUORUM — ${campaign.title}`,
    `Window: ${formatWindow(campaign.surgeStart, campaign.surgeEnd)}`,
    `Call ${office.name}, ${office.role}: ${office.dcPhone}`,
    office.phoneNote ? office.phoneNote : "",
    office.districtPhone
      ? `District (${office.districtLabel ?? "local"}): ${office.districtPhone}`
      : office.level === "county"
        ? ""
        : "Then ask that desk for the district office number and call it the same day.",
    "",
    "Say this. Do not improvise. Staff count volume when the sentence matches.",
    "",
    callScript(campaign, office, profile, true),
    "",
    "Reply DONE after you call, with your real name. One person, one honest contact. Do not have anyone else dial as you.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export type Channel = "signal" | "whatsapp" | "sms" | "post" | "captain";

export const CHANNELS: { id: Channel; label: string; hint: string }[] = [
  {
    id: "signal",
    label: "Signal",
    hint: "Pin this message. Ask for DONE only from people who called. Do not let the thread renegotiate the sentence.",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    hint: "The number stays tappable. Pin it. Mute side chats until the window closes so the ask does not fork.",
  },
  {
    id: "sms",
    label: "Text",
    hint: "Send the ping first, then the script. A long first text gets cut off, and a cut-off sentence is a different campaign.",
  },
  {
    id: "post",
    label: "Public post",
    hint: "For X, Facebook, or an Instagram caption. Do not ask strangers for their names. Point them at the number and the hour.",
  },
  {
    id: "captain",
    label: "Captain brief",
    hint: "Only for other group leads. When they reply with a name, a headcount, and a channel, add them to the beam.",
  },
];

function demandLine(campaign: Campaign): string {
  return (
    campaign.demand.trim() ||
    "Schedule a hearing and a recorded vote on the unamended bill. Do not replace it with a weaker draft."
  );
}

export function channelBody(channel: Channel, campaign: Campaign, office: Office, profile: Profile): string {
  const window = formatWindow(campaign.surgeStart, campaign.surgeEnd);
  const ask = demandLine(campaign);
  const refuses = campaign.refuses.map((item) => item.trim()).filter(Boolean);
  const script = callScript(campaign, office, profile, true);
  if (channel === "whatsapp") {
    return [
      "*QUORUM*",
      `*Window:* ${window}`,
      `*Call:* ${office.name}, ${office.role}`,
      `*Number:* ${office.dcPhone}`,
      office.districtPhone ? `*Also:* ${office.districtLabel ?? "District"} ${office.districtPhone}` : "",
      "",
      "Say this. Do not change a word. Staff count the calls that match.",
      "",
      script,
      "",
      "Reply DONE and your real name after you call. One person, one call. Do not have anyone else dial as you.",
    ]
      .filter((line) => line !== "")
      .join("\n");
  }
  if (channel === "sms") {
    return [
      `Quorum ${window}. Call ${office.name}, ${office.role}, ${office.dcPhone}. Read the next text word for word. Reply DONE and your name only if you called.`,
      "",
      "— second text —",
      "",
      script,
    ].join("\n");
  }
  if (channel === "post") {
    return [
      `One office decides whether this gets a hearing: ${office.name}, ${office.role}.`,
      "",
      `Call ${office.dcPhone} between ${window}.`,
      "",
      `Say this, in these words: "${ask}"`,
      "",
      refuses.length ? `Do not accept: ${refuses.join("; ")}.` : "Do not accept a substitute.",
      "",
      "Call as yourself. Same words. Same hour. Do not have someone else dial for you.",
    ].join("\n");
  }
  if (channel === "captain") {
    return [
      "BEAM LOCK — do not rewrite",
      "",
      `Target: ${office.name}, ${office.role}`,
      `Phone: ${office.dcPhone}`,
      `Window: ${window}`,
      `Sentence: ${ask}`,
      refuses.length ? `Refuses: ${refuses.join("; ")}` : "Refuses: any substitute.",
      "",
      "Your people use this exact text. No second office. No softer ask. If you change the sentence, you are a different campaign.",
      "",
      "Reply: GROUP NAME / HOW MANY WILL CALL / CHANNEL",
    ].join("\n");
  }
  return phoneTree(campaign, office, profile);
}

export function smsPing(campaign: Campaign, office: Office): string {
  return `Quorum ${formatWindow(campaign.surgeStart, campaign.surgeEnd)}. Call ${office.name}, ${office.role}, ${office.dcPhone}. Read the next text word for word. Reply DONE and your name only if you called.`;
}

export function scatterLine(people: number, across: number): string {
  const each = people / across;
  if (each < 1) {
    return "Less than one contact per office. It disappears into the pile.";
  }
  if (each < 5) {
    return "A few contacts per office. Staff can clear that before lunch.";
  }
  return "Noticeable if you live there. Leadership can still ignore it.";
}

export function focusLine(people: number, level: Level): string {
  const bar = level === "county" ? [8, 25, 60] : level === "state" ? [25, 80, 200] : [40, 120, 300];
  if (people < bar[0]) return "A start. An intern logs it. The principal does not hear it.";
  if (people < bar[1]) return "The person who counts the contacts gets pulled in.";
  if (people < bar[2]) {
    return "The principal is briefed before the next meeting. A substitute gets harder to hide.";
  }
  return "The switchboard is the story. One office cannot pretend it missed the standard.";
}

export function perOfficeLabel(people: number, across: number): string {
  const each = people / across;
  if (each < 0.1) return "<0.1";
  if (each < 10) return each.toFixed(1);
  return String(Math.round(each));
}

export function blankCampaign(officeId: string, threshold: number): Campaign {
  const office = officeById(officeId);
  return {
    id: crypto.randomUUID(),
    title: `Demand on the ${office.role}`,
    demand: "",
    principle:
      "The law tutors. Do not codify a compromise and teach it as the baseline.",
    refuses: [],
    officeId,
    threshold: Math.max(20, threshold),
    posture: "absolute",
    surgeStart: 9 * 60,
    surgeEnd: 11 * 60,
    seeded: false,
  };
}
