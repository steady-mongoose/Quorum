# Avouch Social

**An invite-only social app for your church, your shop, and your county.**

Avouch Social is a social network built around showing up. It holds where a small set of people meet, who said they'd be there, what they did, and what the parish needs this week. Members get in by a host's code to one real event; they RSVP, the host takes roll, and the people you've stood in a room with are the people you can message. There is no feed algorithm, no reshare, no likes, no scores. You open it, see where to be this week, and go. Success is a person who opens it, sees Thursday, and leaves.

Quorum (below) is the engine of The County room. A campaign is one demand on one office in one hour; while its window is open it is **this week's call** on the front page, and every call, letter, or visit logged on the desk files in The County as a **Did**: an act, a date, one proof.

## Get it running

You need [Node.js](https://nodejs.org/) 22.6 or newer and Git. Then, in a terminal:

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

Addictive apps run on variable reward: you open them not knowing what you will get, and that uncertainty is the hook. Avouch Social runs on **obligation to people you have met**. You open it knowing what you will get: Thursday, the book, the Nelsons' Tuesday. Three loops do the work, and each has a built-in limit that keeps it from turning into a feed.

| Loop            | What pulls you back                                                                                                                                                  | The limit that keeps it honest                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Rhythm**      | The week has a shape: Sunday, the meal after, Thursday, the second Wednesday. The front page is those dates.                                                         | Only the next seven days, only days with something on them. No infinite scroll; the page ends. Nothing refreshes on its own.              |
| **Obligation**  | You said you'd be there, and the host will take roll with your name in front of them. You put your name on Tuesday. Someone is reading chapter five because you are. | Names, never counts. No-shows get nothing: no streak lost, no badge gone, no public mark. The pull is the people, not the app.            |
| **Recognition** | A host who was there names one person who earned it, in front of the others. It lands on your profile where the people you've stood with can read it.                | One per meeting. Never a number, never ranked, never from someone who wasn't in the room. Visible only to people who have stood with you. |

The measures that matter are the ones a feed cannot fake: how many people who said they'd be there were there; how many cards got a Hosted; how many parish days got a name on them; how many members come back the next week. Time in the app is a failure metric. A good week is ten minutes on Sunday night and one minute on Thursday afternoon.

Every feature proposal gets the same question: _does this make someone leave the house?_ If it makes them scroll, it does not go in.

**The Literary Society** is the clearest case. A book reading is the oldest engagement loop there is (a table of people who agreed to read the same chapters), and the app adds exactly three things to it: the date, what to have read by then, and who said they're coming. The host sets the next chapters when closing the table, so the obligation is always specific. There is no in-app discussion of the book. The discussion is the table.

## How it works

**The week comes first.** The front page is the next seven days that have something on them. Empty days are left out; an empty week says so and points at the rooms. The County's open call window sits at the top with the number to dial.

**Invite only.** Without a code, the only page is the door. A host makes a one-use code for one card and hands it over however they like. The code reveals nothing until a name is entered; then that name is a member and on the going list. Codes expire after seven days. The first thing a new member sees is a date, not a feed. On a new box, the first member gets in with the founder code (`VITE_FOUNDER_CODE` in `.env`; the dev default is `FOUNDER`) and becomes a steward. Change it before anyone else can reach the box.

**Say you'll be there. The host takes roll.** A card's going list is names, never a count. After the hour the host files a **Hosted**: how it went in a line (no headcount; the composer refuses one), who came, one person **Named** if someone earned it (they must have been there; never the host), and the next date. Who came joins the card's "been" list. A card that does not happen is a Hosted that says so.

**Rooms do not mix.** The County (hearings, the week's call, labeled candidate cards). The Question (one question a month, chairs open to anyone). The Shop (apprentice nights, bench logs, the net; a tradesman is listed by the men he worked for). Literary Society (a reading group: one book, a few chapters between meetings, a table; the host sets what to read by next time). The Co-op (households, chapter logs). The church rooms, kept separate: Reformed Baptist (churches holding the 1689 Second London Confession), Reformed Presbyterian (the Westminster Standards), Latin Mass, Greek Orthodox; each has service time, the meal after, the calendar, and what the church needs this week. Dispatch (steward bulletins only).

**Post types.** Members file **Did** (an act, a date, one proof), **Asked** (one question, what was tried; closes when answered), and **Hosted**. Stewards file **Notice** (an announcement with its source) and **Bulletin** (a public scene with a clock and a block). Every post picks a type or it does not send. The rules live in `src/lib/board/model.ts`, not in the views.

**A parish need** is posted by whoever is organizing it, with the family's say-so: what is needed, where to bring it, and a list of days. You put your name on a day. Nothing enforces it.

**Profiles are four lines** (name, household, parish, trade) plus what was earned by going: who you have stood in a room with, what you host, the last three times a host named you. Visible in full only to people who have stood in a room with you; everyone else sees a name.

**Messages** are two names, plain text, deleted after 30 days, no groups. You can message someone you share a "been" list with or who replied to your post.

**Room chat** is one transcript per room, in time order, for people who have stood in that room. The server checks the session and that room's membership on every read and every send. A hard removal or a ban closes that access on the next request. A steward can remove a line only in a room they steward. A grant with no room does not count. An admin can remove a line in every room. The lines are plain text. End-to-end encryption for a room is a later change: a removed member must not be able to read lines sent after they leave, and that needs a new epoch. Private 1:1 messages stay on the design that reserves migration `0006`. This transcript is migration `0013`. Until that file is applied, room chat answers that it is not available yet, and the rest of the board still loads.

**Built in, not settings:** chronological inside the room ending in "You're caught up"; no feed algorithm, reshare, quote, like counts, badges, streaks, or scores; one mark on every screen, set by the owner (`OWNER_THEME` in `src/lib/board/themes.ts`); a dismissable line at twenty minutes. **Stewards** mark posts _sloppy_, _No legs_ (stored as `unsupported`), or _out of scope_. A mark dims the post. It stays in time order and it does not disappear. A steward can mark, remove, or decide an appeal only in a room they steward. A grant with no room does not count. Hard removal covers threats, pornography, CSAM, doxxing, and posts that mock God or Christ. A room steward's bar covers that room. An admin's bar, and a CSAM bar, cover the whole site. A removal bars filing in that room for 30 days. CSAM bans the account, holds the evidence for one year (pending counsel), and prepares a CyberTipline report that Josh files by hand. The content is never shown. A mark is logged in the room. An appeal is visible to its author, the stewards of that room, and an admin. Lifting an appeal ends the bar from that removal in that room. A bar in another room stays.

**Home** is a fixed list: rooms you have joined, then town rooms for your ZIP, then your congregation, then wider regions. Inside a room, posts stay newest first. A mark only dims a post. The council can label a candidate post or a business post **Council-approved**, once, with a logged reason and a review checklist. That label is not a rank. A steward is the inviter plus a steward of that room (the first steward of a room is the inviter plus the council chair). An admin is already a steward, plus the role owner's sign-off. Every grant and revocation is in `access_log`. A ZIP does not create a room. A member requests one, and an admin approves it.

Migration **0011** is `migrations/0011_places.sql`. It adds towns, ZIP codes, congregations, room requests, and council approvals. It is applied on production. Migration **0013** still needs approval before it is applied. Merging is not that approval.

Migration **0010** is `migrations/0010_moderation.sql`. It adds doxxing and blasphemy, the out-of-scope mark, appeals, and the CSAM hold. It is not applied. Migration **0014** is `migrations/0014_board_ban_room.sql`. It adds `board_ban.room_id` so a room steward's bar covers that room, and an empty room id stays a site-wide bar. A CSAM removal writes that empty room id. It is not applied. Migration **0015** is `migrations/0015_hard_rules.sql`. It allows doxxing and blasphemy on the theme-group and room-chat checks. It is not applied. Migration **0017** is `migrations/0017_csam_hold_key.sql`. It adds `board_csam_hold.key_id` so a reseal can tell which key encrypted a hold. `0016` stays reserved. Group inheritance uses the approved request and `board_ban.room_id`; it does not add a migration. 0017 does not replace a function. It is not applied. Approve 0010, 0014, 0015, and 0017 before they are applied. Merging is not that approval. Home, vouching, a ZIP correction, and a room request look only at a site-wide bar. A room bar does not block those. A theme group approved from a room inherits that room's bar for the group: a member barred from the room cannot read or post there. Room chat and room calls use only that room's own bar. A group cannot take a room's id, including one named in the code list when that row is missing. A group with no approving room, including the five seed groups, does not inherit a room bar. A site-wide bar still blocks every group.

**Theme groups** sit beside the rooms: carpentry, gardening, brewing, distilling, and a literary society. Each group has its own admins and stewards. An admin of the group appoints a steward, and that grant is logged. Those admins use the same marks and hard removals on that group's posts. A member can appeal to a steward of that group, or to a steward of the room that approved the group. A bar on that room follows the group: the member cannot read it or post in it. It does not change chat or calls in a room. A group cannot use a room's id, including one named in the code list when that row is missing. A steward grant with no room does not count. Posts are newest first, in English, with no likes and no scores. The tables are `migrations/0012_theme_groups.sql`. That file is numbered 0012 and is already applied on production.

Status: the screens still run in the browser when `VITE_DEMO=1`, or when `/api/health` does not answer. A closed test can point them at `https://api.avouchsocial.com` with `VITE_API_BASE_URL`. An empty `VITE_API_BASE_URL` means same-origin `/api`, not the demo. Signup on that API is invite-code only. The box itself is described in `deploy/README.md`. Do not apply `migrations/` until the owner approves those files.

Pictures and short video upload straight to S3-compatible storage with a presigned link that locks the size. That stays off until the storage credentials are set, and video stays off until `MEDIA_VIDEO=on`. A worker re-encodes the file, strips location data, and makes a thumbnail. Only a member of that room can see it, through a short-lived signed link. A picture in a message is encrypted on the device; that step waits on the messaging work described in `src/lib/media/e2e.ts`. There is still no feed algorithm, reshare, like, or score.

A room can also hold a live group call. That is separate from stored video, and it stays hidden until `CALLS=on` on the API. The browsers talk to each other. The API only passes the offer, the answer, and the network candidates, and only to people who have stood in that room. The call is not recorded. The roster lives in that one API process. A TURN relay, if you run one, is the optional `calls` profile in `deploy/docker-compose.yml`. `docker compose up` does not start it. See `deploy/README.md`.

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

| Where            | Who sees it             | What you paste                                                                               |
| ---------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| Signal           | Your private group      | The call, the number, and the exact words. Pin it. People reply only after they have called. |
| WhatsApp         | Your private group      | The same text. The phone number stays tappable.                                              |
| Text or iMessage | People you already know | A short ping, then the script as a second text so it is not cut off.                         |
| X or Facebook    | The public              | The office, the number, the hour, and the sentence. Do not ask strangers for their names.    |
| Instagram        | The public              | A screenshot of the card on the desk, plus the public post as the caption.                   |

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
