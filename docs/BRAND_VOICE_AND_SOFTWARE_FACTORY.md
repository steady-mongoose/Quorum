# Brand voice, Belonging Moat, and Software Factory

Read this with `DESIGN.md` (how Avouch looks) and `docs/TESTING.md` (hands-on checklist). Together they set the product guardrails, the parish/civic voice, and how we ship without thrashing `the-board` or production.

## 1. The Avouch Belonging Moat (product and privacy)

Avouch is invite-only belonging, not a growth feed. The product wins when neighbors trust the room they are in.

### Invite-only entry

- People enter through trusted host codes: a real person vouching for a real person.
- Sign-up includes 18+ age attestation. MFA and passkeys apply where the account flow requires them.
- A used or invented invite code fails clearly; it does not create an account.

### Shared-room privacy and safety

- Non-members see no room internals.
- Barred members stay invisible on room and gathering surfaces, including after a gathering moves (`moved_from`).
- Direct messages and write-ups follow the retention and privacy rules already in the app and README.
- Special-event RSVPs and attendance roll call are scoped to the host and the room's stewards. Admins who are neither host nor steward see only aggregate RSVP metrics. Hide counts below 5, and hide counts that equal the full room membership.

### Local scope and civic calls

- Rooms and groups stay county-scoped. `Find` surfaces local places and gatherings.
- Peer-to-peer civic and room Quorum calls are opt-in and unrecorded. Production keeps `CALLS` gated off until Josh explicitly enables them. Do not turn `CALLS` on unasked.

### Social member surfaces vs. operational directories

**Social member surfaces** (`This week`, room feeds, group discussions, direct messages, gathering cards for ordinary members):

- Zero engagement bait.
- Zero likes, reshares, streaks, or popularity scores.
- Zero algorithmic feed ranking.
- Chronological or scheduled order only. No public attendee or RSVP headcounts on member-facing cards.

**Operational directories, finders, steward queues, and admin tables** that can exceed 6 items (`Find`, `Rooms` directory, county/church/place finders, steward queues, admin stats/queues/audit logs):

- Instant case-insensitive search with `Showing X of Y` and a `Clear` control.
- Typed `asc` / `desc` sort on non-vanity fields (name, date, county, role, status) with `aria-sort` and `Intl.Collator` / numeric / timestamp comparison.
- Facet chips synced to TanStack Router search params on routed views.
- Virtualization above about 100 rows, and a zero-match empty state with `Reset filters`.

The Elastic UI rule in `.cursor/rules/elastic-ui-and-collections.mdc` is the layout and collection contract for these surfaces.

## 2. Parish and Civic Anti-Slop Harness (voice, copy, taste)

### Point of view and register

Speak like a neighbor or parish steward: plain, warm, unhurried human English. Name concrete outcomes — who is hosting, when and where neighbors meet, which room sees a post, what was saved or sent. Do not sound like a tech-bro pitch, a growth hack, or an "AI-powered" product page.

`DESIGN.md` already sets the visual register: engraved book from a church library, Ink & Bone / Parchment & Lapis tokens, five-artist sepia engravings. Copy must match that calm parish/hall tone. Name buttons for what they do (`Save`, `Remove`). When the same control repeats down a list, give each one an accessible label that names its row.

### Banned AI tell-phrases

Never use these in UI copy, emails, digests, PR bodies, commit messages, or docs (except inside this explicit ban list):

- *delve*
- *tapestry*
- *testament to*
- *in today's fast-paced world*
- *unlock the power of*
- *seamless*
- *game-changer*
- *elevate*
- *foster*
- Rhetorical *"It's not X—it's Y"* contrast clichés
- Unverified superlatives

### No fabricated proof

Do not invent stats, quotes, member counts, or church endorsements. If a number is not in the database or a verified source opened this turn, omit it.

### Taste check rubric (`0–5`, hold below 4)

Score every user-facing string or review note on all three axes. Ship only when every axis is **>= 4**:

1. **Zero AI Smell** — Reads like a thoughtful human steward or neighbor. No tell-phrases from the ban list.
2. **Brand & Doctrinal Fidelity** — Honors `DESIGN.md` tokens and art rules, Christian hospitality without performative clichés, strict privacy, and zero vanity metrics on social surfaces.
3. **Action Clarity** — Plain literal labels and status lines. Example: `Date changed to Nov 8. The host and everyone going have been told.` One clear purpose. No filler opener or sign-off padding.

## 3. Software Factory Conveyor and release governance

### Conveyor

1. **Grill assumptions** — Write a Done-List (Goal, Why, Anti-Scope, binary `PASS`/`FAIL` checks). If two requirements conflict, resolve the hierarchy in writing before touching code.
2. **Clean worktree** — Isolate in a `git worktree` off `/workspace/Quorum` (for example `/workspace/wt-…`) on a descriptive branch from latest `origin/the-board`. Never create duplicate clones (`Quorum-2`, and so on). Never commit directly on `the-board`.
3. **Build** — Follow `DESIGN.md` tokens and `.cursor/rules/elastic-ui-and-collections.mdc`.
4. **Prove** — Run full `tsc` / lint / test / build. For UI work, capture before/after Playwright screenshots at 320 / 390 / 768 / 1280px and 125% zoom, plus `check-ui-gate.mjs` JSON:
   ```bash
   node /home/box/agent-data/workflows/elastic-layout-reactive-ux-gate/check-ui-gate.mjs <url> --out /tmp/ui-gate.json
   ```
5. **Single-pass batched gate** — One batched `@AVO QA` + `@AVO Design Critic` review against the PR head SHA. Fix until the Done-List is clear before merging or escalating gated work.

### SHA-Pinned Chief-of-Staff Approval Relay and safety rules

Never:

- Force-push (`--force` / `--force-with-lease`)
- Skip hooks (`--no-verify`)
- Rebase pushed branches (use normal merge commits)
- Print or edit `deploy/.env`
- Enable `CALLS` unasked
- Apply any migration other than the ones Josh approved for that release
- Restart anything on prod other than the `api` service (use `sudo` if Docker says permission denied)

Never merge `migrations/` or deploy to production without Josh's explicit OK — either directly from Josh in chat, or via a SHA-pinned approval relay from `AVO Chief of Staff` that cites:

- Exact PR number and head SHA
- Migration file SHA-256 digests when migrations are in scope
- Approved scope
- Owner message or answered-card timestamp reference

If any migration commit landed after the approved SHA, stop and re-confirm.

Before applying approved migrations: take a fresh encrypted Postgres backup under `/var/backups/avouch/*.dump.age`, verify non-zero size, then migrate. On any migration or smoke-check failure, roll back immediately to that pre-migration backup.

Hands-on product checks after a release follow `docs/TESTING.md`.
