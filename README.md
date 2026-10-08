# The Board

A town board with a lock on the feed. It holds what a small set of people did, where they meet, and what they saw in public. It is not a Twitter replacement. Success is a person who opens it, reads their room, and leaves.

Quorum (below) is the engine of the Civic room. A campaign is one demand on one office in one hour; while its window is open it shows in Civic as a labeled card, and every call, letter, or visit logged on the desk files in Civic as a **Did**: an act, a date, one proof.

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

To see the template filled in:

1. Open **About**, type a name, and press **Load the sample week**. Six invented members, a week of posts, cards with dates, two message threads. You become Josh.
2. Pick a look under **About → Look**: Plain, An Appeal to Heaven, Jerusalem cross, or Don't Tread on Me.
3. Walk the rooms. Guilds opens on the framing night; Skills shows a tradesman listed by two witnesses; Dispatch has a sloppy post marked and sorted last; Messages has the Dale and Tom threads.

**Clear the board** on the same page wipes it back to the brief's seed cards. **Steward tools** on that page turn on marking and hard removal so you can try the moderation path.

Stop the server with Ctrl+C. Windows, Mac, and Linux all work; `npm run dev` is the only command you need day to day.

## Rooms and post types

Rooms do not mix: Civic, Public hall, Skills, Guilds, School, Reformed, Latin Mass, Greek Orthodox, Dispatch. Every post picks a type or it does not send: **Did**, **Asked**, **Noted**, **Saw**. Dispatch takes Saw only and nothing else takes Saw; a Saw wants a clock in the proof and refuses a home address. The rules live in `src/lib/board/model.ts`, not in the views.

Built in, not settings: chronological inside the room ending in "You're caught up"; no For You, reshare, quote, badges, streaks, autoplay, or public like counts; a dismissable line at 20 minutes; notifications off unless asked for.

A room opens on its **shelf** — at most two cards with a date inside 14 days — then its feed; with nothing near, it opens on the feed. The host closes a date with a **Hosted** post: it happened, next date, no headcount (the composer refuses one). A Did that names a card sorts first. A **trade card** (a business) cannot list itself: two other members name its work in a Did and it lists. Every steward mark lands in a **mark log** the whole room can read.

**Messages** are two names, no groups, plain text, deleted after 30 days. You can message someone you share an "I went" list with or who replied to your post; a card marked "takes a first-timer" opens a message to its host once you have been.

**Find** is a date list, not a recommendation. A card lists only after the lister has been twice, and hides after two missed meetings. **Stewards** mark posts *sloppy* or *unsupported* (they sort down, they do not disappear) and hard-remove only threats, pornography, and CSAM, which carries a 30-day filing ban and a removal log.

## How to use it

Open **About**, put your name on your posts, and press **Load the sample week** to see a board in use (six invented members around Brandon and Riverview; you become Josh). Then:

1. **Read your room.** Pick a room. It opens on what is coming up inside two weeks, then the feed, newest first inside each tier. The list ends. Leave.
2. **Go somewhere.** Open **Find**, pick a card, go. Afterwards press **I went**. Two visits is what lets you list a card of your own, and being on a card's "I went" list with someone is what lets you message them.
3. **File what you did.** Back in the room, pick **Did**, name the card if there was one, say what you did and give one proof (who was there, a receipt, a photo you took). No verdict.
4. **Ask one question.** **Asked** takes one question and what you already tried. When a reply answers it, press **Answered**.
5. **Note a fact.** **Noted** is a passage, a measurement, a time. Say where it comes from, or a steward may mark it *unsupported* and it sorts under posts that did.
6. **If you host, close the date.** After the hour, file **Hosted**: how it went in a line (no headcount, the composer refuses one) and the next date. That is the advertisement for next time. Tick **Take a first-timer** on your card if a new person can message you.
7. **If you run a business, do not list it.** Ask nobody. When two members you worked for file a Did naming your trade card, it lists under Skills.
8. **Saw something in public?** Dispatch, **Saw** only: the scene, a clock, the block. No house numbers, no children's faces, no naming a private person.
9. **Message to arrange, not to talk.** Two names, no groups, plain text, gone in 30 days. Open one from a post or a card.
10. **Stewards:** mark *sloppy* or *unsupported*, never for the side. Every mark is logged in the room for everyone to read. Hard-remove only threats, pornography, and CSAM.

Status: browser skeleton on `localStorage`. The next step is the same screens on a $20 VPS with login (better-auth is already wired) in place of the name field.

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
