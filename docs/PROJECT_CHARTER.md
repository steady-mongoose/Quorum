# **The Board: Project Charter**

A town board with a lock on the feed. This document holds who is working on it, where the code lives, the mission statement once it is decided, and how the project is run.

## **Contents**

> 1. Project team
> 2. Repository
> 3. Mission statement
> 4. Project management
> 5. Decisions already made
> 6. Open items

*Replace this list with a live table of contents: Insert > Table of contents.*

## **Project team**

| Name | Role | Owns |
| :---- | :---- | :---- |
| Josh McMullin | [Project Lead / Chairman] | [WHAT THEY OWN] |
| Zachary Taylor | [Lead Strategist] | [WHAT THEY OWN] |
| Ryan Horne | [Contributor] | [WHAT THEY OWN] |
| Sam Archer | [Treasurer] | [WHAT THEY OWN] |

The brief calls for five roles with one name each: Product lead, App owner, Infra owner, Rules owner, Money owner. Two people hold each login. The App owner is not also the Infra owner.

## **Repository**

Code: [github.com/steady-mongoose/Quorum](https://github.com/steady-mongoose/Quorum)
Working branch: **the-board**. Quorum, the original campaign tool, is the engine of the Civic room. The Board's rules live in **src/lib/board/model.ts**; the README has a ten-step guide to using the app and a sample week that loads from the About page.

## **Mission statement**

Conservatism is not enough when so little of the order worth keeping is left. We gather Christians of the historic liturgical traditions (Catholic, Greek Orthodox, and confessional high-church Protestant) to rebuild what our founders assumed and modernity dissolved: the family, the parish, the town, honest work, and a people governed by virtue before law. This board exists so neighbors can see what is happening where they live, meet face to face, and then log off and go do the work. We use the machine to get away from the machine.

We honor how each tradition worships within its own sacramental and creedal heritage. The board rejects Christian Zionism, along with the entertainment-driven church model. It is not a Twitter replacement. Success is a person who opens it, reads their room, and leaves.

### **Guard rails**

> 1. Lawful and nonviolent. Talking about resisting and overthrowing tyranny is protected speech, including the founders' right of revolution in the Declaration of Independence, just-rebellion theology, and support for people living under dictatorships. Still removed: calls for violence against a specific person or group, plans or instructions for attacks, intimidation, and doxxing. Zero tolerance for pornography and child sexual abuse material (CSAM): it is removed on sight, the account is banned, and CSAM is reported to NCMEC as federal law requires. Threats come down under the hard-removal rule.
> 2. Speech stays up. There is no hate-speech rule. Only calls for violence, threats, doxxing, pornography, and blasphemy (rule 10) come down. Stewards mark posts, they never remove them, and a mark never hides a post.
> 3. Give it legs. Any claim, especially on controversial subjects like Zionism, Israel, immigration, or officials, needs a source, evidence, or a firsthand account. A bare assertion or slur with no argument gets marked "no legs," and the post stays up.
> 4. Local first. Rooms map to real towns and congregations; national topics enter through what members saw where they live.
> 5. No money from government or political parties. Revenue is memberships plus one labeled sponsor card per room.
> 6. Same rules for all. Every steward mark must be explainable in one sentence and applied the same way to any member, ally or opponent.
> 7. Council promotion. Political candidates and businesses the board supports apply to a review council. Once approved, their posts are automatically promoted to a higher position. Every promoted post carries a visible "Council-approved" label, and the council logs each approval and the reason for it.
>    7a. What we champion. The council gives priority to Christian-owned businesses and to institutions of ordered community life: men-only and women-only gyms, true gentlemen's clubs (dining, cigar, and social clubs in the old sense, not strip clubs), literary societies, homeschool co-ops, guilds and trade apprenticeships, and similar member associations.
> 8. Doctrine. Stewards do not referee doctrine among Catholic, Orthodox, and high-church Protestant members. Posts promoting dispensationalism, Christian Zionism, or megachurch-style ministry may be marked as out of scope. Criticism of Zionism, the state of Israel, or any political or religious movement is welcome under rule 3.
> 9. Invite-only, role-based access. Every member joins by invitation from an existing member. Access is tiered by role, and each step up requires more layers of approval: Member (one inviter vouches), Steward (inviter plus approval by existing stewards of that room), Admin or infrastructure access (steward approval plus sign-off by the role owners). Access is revocable, and every grant and revocation is logged.
> 10. No blasphemy. Christ is King. Posts that mock, curse, or degrade God, Christ, the Holy Spirit, the Virgin Mary, the saints, the Cross, or the sacraments are removed. Honest theological questions and doctrinal debate under rule 8 are not blasphemy.
> 11. Criticism of other religions is protected. Members may criticize Islam and any other non-Christian religion, its doctrines, its history, and its political movements, in the tradition of writers like Raymond Ibrahim. Rule 3 applies: give it legs with sources, history, or texts. Calls for violence against any people remain banned under rule 1.

## **Project management**

### **Weekly call**

One call, thirty minutes, same five questions each week:

> 1. Is it up?
> 2. What shipped?
> 3. What is blocked?
> 4. Any vendor ticket?
> 5. Next three tasks?

### **Milestones**

| Stage | What | Monthly cost | Status | Owner |
| :---- | :---- | :---- | :---- | :---- |
| Browser skeleton | Rooms, four post types, Find, stewards, messages, sample week. Runs on localStorage. | $0 | Done | [NAME] |
| Closed test | One OVH VPS, login in place of the name field, 5 to 20 invited people, nightly database dump. | About $5 to $20 | Next | [NAME] |
| Invite beta | OVH dedicated plus a live spare at a second company, two domains, two registrars, monthly failover drill. 100 to 1,000 users, text and images. | $140 to $320 | Not started | [NAME] |
| Legal and money | Form the LLC before anyone pays. Prepaid memberships from known people. No GoFundMe, no Stripe as the only rail. | Part of the $20,000 start | Not started | [NAME] |

### **Task board**

| Task | Owner | Due | Status |
| :---- | :---- | :---- | :---- |
| Name the five role holders | [NAME] | [DATE] | Open |
| Write the mission statement | Josh McMullin | 2026-10-14 | Drafted |
| Order the $20 OVH VPS and boot the app on it | [NAME] | [DATE] | Open |
| Wire login (better-auth is already in the scaffold) | [NAME] | [DATE] | Open |
| Register the spare domain at a second registrar | [NAME] | [DATE] | Open |
| Form the LLC | [NAME] | [DATE] | Open |

### **Recovery plan, if a vendor cuts us**

Easy only if the spare already exists. First hour: stop the press posts, name what died, open the password manager, put a one-line status page on the spare domain. Same night: boot the last image on the spare, point both names at it, send mail from somewhere other than Google, Microsoft, or the dead host. Next morning: snapshot, order a third box at a company not in the news with us, answer any abuse ticket with the removal log.

## **Decisions already made**

These are settled so they are not reopened on the weekly call.

> * Website first. No App Store chase.
> * Invite-only at the start. Text and images only. Video off until the $250 band is boring.
> * Public site runs on a paid dedicated box. Not a home machine, not AWS, Google, Azure, or Apple.
> * No feed algorithm (except council-approved promotion under guard rail 7), no reshare, no quote-post, no public like counts, no badges, no streaks. The list ends.
> * Home opens to the most local content first: rooms you've joined, then your zip code's town rooms, then your congregation, with wider regions only after those. The order is fixed and the same for every member.
> * Theme-based groups (for example a literary society or a homeschool co-op) sit alongside town and congregation rooms. Each group's admin moderates that group's content under the same guard rails, and every mark is logged and can be appealed to the room's stewards.
> * English only. The app and website ship in English, with no translations or language settings.
> * No per-person scores of any kind. Reliability belongs to the meeting card, not the person.
> * Hosted posts carry no headcount. Trade cards list only when two other members name the work.
> * Messages are two names only, plain text, deleted after 30 days. No group messages.
> * Hard removal only for threats, pornography, CSAM, and blasphemy. Everything else stays up. Stewards mark for the missing reason, never the side, and every mark is logged in the room.
> * Sponsorship buys one labeled card per room and nothing else. Memberships are the revenue that survives a vendor leaving.

## **Open items**

> * Product name and LLC name.
> * The five role holders.
> * The about-page stance copy.
> * One-sentence definition of the proposed content rule flagged in the brief, or a decision to drop it. Nothing switches on until a sentence exists that a steward can apply the same way to every user.
> * Whether candidate cards exist at launch or after a real endorsement.
> * Payment rails for prepaid memberships.

*SLOGAN?
