# The Board

A town board with a lock on the feed. It holds what a small set of people did, where they meet, and what they saw in public. It is not a Twitter replacement. Success is a person who opens it, reads their room, and leaves.

Quorum (below) is the engine of the Civic room. A campaign is one demand on one office in one hour; while its window is open it shows in Civic as a labeled card, and every call, letter, or visit logged on the desk files in Civic as a **Did**: an act, a date, one proof.

## Rooms and post types

Rooms do not mix: Civic, Public hall, Skills, Guilds, School, Reformed, Latin Mass, Greek Orthodox, Dispatch. Every post picks a type or it does not send: **Did**, **Asked**, **Noted**, **Saw**. Dispatch takes Saw only and nothing else takes Saw; a Saw wants a clock in the proof and refuses a home address. The rules live in `src/lib/board/model.ts`, not in the views.

Built in, not settings: chronological inside the room ending in "You're caught up"; no For You, reshare, quote, badges, streaks, autoplay, or public like counts; a dismissable line at 20 minutes; notifications off unless asked for.

A room opens on its **shelf** — at most two cards with a date inside 14 days — then its feed; with nothing near, it opens on the feed. The host closes a date with a **Hosted** post: it happened, next date, no headcount (the composer refuses one). A Did that names a card sorts first. A **trade card** (a business) cannot list itself: two other members name its work in a Did and it lists. Every steward mark lands in a **mark log** the whole room can read.

**Messages** are two names, no groups, plain text, deleted after 30 days. You can message someone you share an "I went" list with or who replied to your post; a card marked "takes a first-timer" opens a message to its host once you have been.

**Find** is a date list, not a recommendation. A card lists only after the lister has been twice, and hides after two missed meetings. **Stewards** mark posts *sloppy* or *unsupported* (they sort down, they do not disappear) and hard-remove only threats, pornography, and CSAM, which carries a 30-day filing ban and a removal log.

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
