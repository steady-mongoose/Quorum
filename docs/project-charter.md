# The Hall: Project Charter

Live copy, for editing and comments: [Google Doc](https://docs.google.com/document/d/1FH7gENeuPMeL3j5nGFiH9w5mEmbrhfMvMCTRjWEvehU/edit). This file is the version kept with the code; when the two disagree, the Google Doc is the one the team is editing.

An invite-only social app for the people you see at church, at the shop, and at the county. This document holds who is working on it, where the code lives, the mission statement once it is decided, and how the project is run.

## Contents

1. Project team
2. Repository
3. Mission statement
4. Project management
5. Decisions already made
6. Open items

## Project team

| Name | Role | Owns |
|---|---|---|
| Zachary Taylor | [ROLE] | [WHAT THEY OWN] |
| Ryan Horne | [ROLE] | [WHAT THEY OWN] |
| Sam Archer | [ROLE] | [WHAT THEY OWN] |

The brief calls for five roles with one name each: Product lead, App owner, Infra owner, Rules owner, Money owner. Two people hold each login. The App owner is not also the Infra owner.

## Repository

Code: [github.com/steady-mongoose/Quorum](https://github.com/steady-mongoose/Quorum)

Quorum, the original campaign tool, is the engine of The County room. The Hall's rules live in `src/lib/board/model.ts`; the README explains how to run it, how it works, and the sample week that loads from the door or the About page.

## Mission statement

[TO BE DETERMINED]

Working description until then: it shows you the week's meetings, lets you say you will be there, and lets the host record who came. You get in by invitation to a real meeting. There is no feed to scroll and nothing to like. Open it, see where to be, go.

## Project management

### Weekly call

One call, thirty minutes, same five questions each week:

1. Is it up?
2. What shipped?
3. What is blocked?
4. Any vendor ticket?
5. Next three tasks?

### Milestones

| Stage | What | Monthly cost | Status | Owner |
|---|---|---|---|---|
| Browser skeleton | Rooms, the week, invite codes, roll call, messages, profiles, a sample week. Runs on localStorage. | $0 | Done | [NAME] |
| Closed test | One OVH VPS, login in place of the name field, invite codes on the server, 5 to 20 invited people, nightly database dump. | About $5 to $20 | Next | [NAME] |
| Invite beta | OVH dedicated plus a live spare at a second company, two domains, two registrars, monthly failover drill. 100 to 1,000 users, text and images. | $140 to $320 | Not started | [NAME] |
| Legal and money | Form the LLC before anyone pays. Prepaid memberships from known people. No GoFundMe, no Stripe as the only rail. | Part of the $20,000 start | Not started | [NAME] |

### Task board

| Task | Owner | Due | Status |
|---|---|---|---|
| Name the five role holders | [NAME] | [DATE] | Open |
| Write the mission statement and the "What we stand for" copy | [NAME] | [DATE] | Open |
| Order the $20 OVH VPS and boot the app on it | [NAME] | [DATE] | Open |
| Wire login and move invite codes and the founder code server-side (better-auth is already in the scaffold) | [NAME] | [DATE] | Open |
| Register the spare domain at a second registrar | [NAME] | [DATE] | Open |
| Form the LLC | [NAME] | [DATE] | Open |

### Recovery plan, if a vendor cuts us

Easy only if the spare already exists. First hour: stop the press posts, name what died, open the password manager, put a one-line status page on the spare domain. Same night: boot the last image on the spare, point both names at it, send mail from somewhere other than Google, Microsoft, or the dead host. Next morning: snapshot, order a third box at a company not in the news with us, answer any abuse ticket with the removal log.

## Decisions already made

These are settled so they are not reopened on the weekly call.

- Website first. No App Store chase.
- Invite-only. A host's one-use code to one meeting is the only way in; the founder code opens a new box once. Text and images only. Video off until the $250 band is boring.
- Public site runs on a paid dedicated box. Not a home machine, not AWS, Google, Azure, or Apple.
- No feed algorithm, no reshare, no quote-post, no like counts, no badges, no streaks, no per-person scores. The front page is the week, not a feed.
- The host writes up each meeting: how it went, who came, one person mentioned at most, the next date. No headcount.
- A business is listed only when two members post that it did work for them.
- People who have been to the same meeting can message each other and see each other's profile. Nobody else can. Messages are two names only, plain text, not encrypted, deleted after 30 days.
- Hard removal only for threats, pornography, and CSAM. Everything else stays up. Stewards mark for the missing reason, never the side, and every mark is logged in the room. Stewards are appointed by the founder, never self-appointed.
- One mark on every screen, set by the owner (An Appeal to Heaven). Church rooms are kept separate: Reformed Baptist (1689), Reformed Presbyterian (Westminster), Latin Mass, Greek Orthodox.
- Sponsorship buys one labeled card per room and nothing else. Memberships are the revenue that survives a vendor leaving.

## Open items

- Product name on the door (The Hall for now) and the LLC name.
- The five role holders.
- The mission statement and the "What we stand for" copy.
- One-sentence definition of the proposed content rule flagged in the brief, or a decision to drop it. Nothing switches on until a sentence exists that a steward can apply the same way to every user.
- Whether candidate events exist at launch or after a real endorsement.
- Whether "I went" (self-reported) or the host's roll call is the gate for messages and profiles.
- Payment rails for prepaid memberships.
