# The Hall

Your church, your shop, your county. Show up.

The Hall holds where a small set of people meet, what they did, and what the parish needs this week. It is not a feed. You open it, see where to be this week, and go. Success is a person who opens it, sees Thursday, and leaves.

Quorum (below) is the engine of The County room. A campaign is one demand on one office in one hour; while its window is open it is **this week's call** on the front page, and every call, letter, or visit logged on the desk files in The County as a **Did**: an act, a date, one proof.

## Get it running

You need [Node.js](https://nodejs.org/) 22 or newer and Git. Then, in a terminal:

```bash
git clone https://github.com/steady-mongoose/Quorum.git
cd Quorum
git checkout the-board
npm install
npm run dev
```

Open http://localhost:8080. Everything you do stays in that browser on that machine; there is no server and no account yet.

To see it filled in:

1. Open **About** and press **Load the sample week**. Six invented members around Brandon and Riverview, a week of cards and posts, a parish need, two message threads. You become Josh.
2. **This week** opens: the next seven days with something on them, this week's call with the number to dial, and what a parish needs. Press **I'll be there** on something.
3. **Rooms**: The Shop opens on the framing night; a tradesman is listed by two witnesses; a Hosted shows who came and who was named. **You** shows the four-line profile and who you have stood in a room with.
4. To try hosting: on About, set your name to **Tom**, go to The Shop, file a **Hosted** on the framing night with a roll call and name someone. On **Find**, press **Invite someone** on that card to get a code; on About, redeem it under a new name.

**Clear the board** on the About page wipes it back to the brief's seed cards. **Steward tools** turn on marking, hard removal, and the steward-only Notice and Bulletin types.

Stop the server with Ctrl+C. Windows, Mac, and Linux all work; `npm run dev` is the only command you need day to day.

## Engaging, not addictive: the model

Addictive apps run on variable reward: you open them not knowing what you will get, and that uncertainty is the hook. The Hall runs on **obligation to people you have met**. You open it knowing what you will get: Thursday, the book, the Nelsons' Tuesday. Three loops do the work, and each has a built-in limit that keeps it from turning into a feed.

| Loop | What pulls you back | The limit that keeps it honest |
|---|---|---|
| **Rhythm** | The week has a shape: Sunday, the meal after, Thursday, the second Wednesday. The front page is those dates. | Only the next seven days, only days with something on them. No infinite scroll; the page ends. Nothing refreshes on its own. |
| **Obligation** | You said you'd be there, and the host will take roll with your name in front of them. You put your name on Tuesday. Someone is reading chapter five because you are. | Names, never counts. No-shows get nothing: no streak lost, no badge gone, no public mark. The pull is the people, not the app. |
| **Recognition** | A host who was there names one person who earned it, in front of the others. It lands on your profile where the people you've stood with can read it. | One per meeting. Never a number, never ranked, never from someone who wasn't in the room. Visible only to people who have stood with you. |

The measures that matter are the ones a feed cannot fake: how many people who said they'd be there were there; how many cards got a Hosted; how many parish days got a name on them; how many members come back the next week. Time in the app is a failure metric. A good week is ten minutes on Sunday night and one minute on Thursday afternoon.

Every feature proposal gets the same question: *does this make someone leave the house?* If it makes them scroll, it does not go in.

**The Shelf** is the clearest case. A book reading is the oldest engagement loop there is (a table of people who agreed to read the same chapters), and the app adds exactly three things to it: the date, what to have read by then, and who said they're coming. The host sets the next chapters when closing the table, so the obligation is always specific. There is no in-app discussion of the book. The discussion is the table.

## How it works

**The week comes first.** The front page is the next seven days that have something on them. Empty days are left out; an empty week says so and points at the rooms. The County's open call window sits at the top with the number to dial.

**Invite only.** Without a code, the only page is the door. A host makes a one-use code for one card and hands it over however they like. The code reveals nothing until a name is entered; then that name is a member and on the going list. Codes expire after seven days. The first thing a new member sees is a date, not a feed. On a new box, the first member gets in with the founder code (`VITE_FOUNDER_CODE` in `.env`; the dev default is `FOUNDER`) and becomes a steward. Change it before anyone else can reach the box.

**Say you'll be there. The host takes roll.** A card's going list is names, never a count. After the hour the host files a **Hosted**: how it went in a line (no headcount; the composer refuses one), who came, one person **Named** if someone earned it (they must have been there; never the host), and the next date. Who came joins the card's "been" list. A card that does not happen is a Hosted that says so.

**Rooms do not mix.** The County (hearings, the week's call, labeled candidate cards). The Question (one question a month, chairs open to anyone). The Shop (apprentice nights, bench logs, the net; a tradesman is listed by the men he worked for). The Shelf (book readings: one book, a few chapters a week, a table; the host sets what to have read by next time). The Co-op (households, chapter logs). Reformed, Latin Mass, Greek Orthodox (service time, the meal after, and what the parish needs). Dispatch (steward bulletins only).

**Post types.** Members file **Did** (an act, a date, one proof), **Asked** (one question, what was tried; closes when answered), and **Hosted**. Stewards file **Notice** (an announcement with its source) and **Bulletin** (a public scene with a clock and a block). Every post picks a type or it does not send. The rules live in `src/lib/board/model.ts`, not in the views.

**A parish need** is posted by whoever is organizing it, with the family's say-so: what is needed, where to bring it, and a list of days. You put your name on a day. Nothing enforces it.

**Profiles are four lines** (name, household, parish, trade) plus what was earned by going: who you have stood in a room with, what you host, the last three times a host named you. Visible in full only to people who have stood in a room with you; everyone else sees a name.

**Messages** are two names, plain text, deleted after 30 days, no groups. You can message someone you share a "been" list with or who replied to your post.

**Built in, not settings:** chronological inside the room ending in "You're caught up"; no feed algorithm, reshare, quote, like counts, badges, streaks, or scores; one mark on every screen, set by the owner (`OWNER_THEME` in `src/lib/board/themes.ts`); a dismissable line at twenty minutes. **Stewards** mark posts *sloppy* or *unsupported* (they sort down, they do not disappear) and hard-remove only threats, pornography, and CSAM, which carries a 30-day filing ban and a removal log. Every mark is logged in the room for everyone to read.

Status: browser skeleton on `localStorage`. The next step is the same screens on a $20 VPS with login (better-auth is already wired) in place of the name field, and invite codes creating accounts.

---

# Quorum

Quorum helps real people ask one public office for one thing, in the same words, during the same hour.

A bill often lives or dies at one desk: a committee chair, a floor leader, a county board. Quorum is the card for that desk. It writes the sentence, the phone number, and the time window. People call or write as themselves. The app does not dial, send messages, or pretend a crowd exists.

## What you use it for

1. Pick the office that can actually move the bill.
2. Write one demand. Do not soften it into a different ask.
3. Set the hour everyone will call.
4. Send that same text to your people.
5. After someone calls, they say so. You log only real contacts.

Other groups can lock onto the same desk. They use your sentence, your office, and your hour. A group that rewrites the ask is not on this effort.

## How the message apps fit

Quorum does not log into Signal, WhatsApp, X, or Facebook. You copy a ready text and paste it yourself.

| Where | Who sees it | What you paste |
|---|---|---|
| Signal | Your private group | The call, the number, and the exact words. Pin it. People reply only after they have called. |
| WhatsApp | Your private group | The same text. The phone number stays tappable. |
| Text or iMessage | People you already know | A short ping, then the script as a second text so it is not cut off. |
| X or Facebook | The public | The office, the number, the hour, and the sentence. Do not ask strangers for their names. |
| Instagram | The public | A screenshot of the card on the desk, plus the public post as the caption. |

Private apps are how your own people get the script. Public apps are how other people see which office was asked, and what was asked. Both use the same sentence.

## What it will not do

It will not shame a private person, a staffer's family, or anyone's home life. It will not invent supporters, run fake accounts, or tell people to harass. The public post names the office and the demand. That is accountability. It is not a pile-on.

## Run

```bash
npm install
npm run dev
```

Open the app at `http://localhost:8080`.

Campaigns, contact logs, your cell, and pledged groups stay in the browser on that device. There is no shared national counter.
