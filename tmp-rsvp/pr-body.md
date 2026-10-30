## feat: RSVPs stored on the server, scoped by role [MIGRATION 0049 – needs Josh's OK]

> ⚠️ **Migration 0049 is NOT applied anywhere.** Do not merge or deploy until Josh types his OK directly in Builder's chat. Build-freeze exception approved by Josh (relayed by AVO Chief of Staff, Oct 29 8:07 PM ET). **0049's SQL is unchanged by this update.** Its header comment still describes the old admin-only rule. I left it alone so the migration file doesn't change.

### Who sees what (Josh, Oct 29 9:04 PM ET; replaces #91's admin-only rule)
| Who | Sees |
|---|---|
| Admin (the owner counts as one) | Every RSVP: who's going and who came |
| Host | Who's going and who came, for **their own** gatherings |
| Steward | Who's going in the rooms they steward. *Interpretation:* "who's going" only, so `attended` is masked to false for them |
| Member | Only their own "You're going". No names, no counts |
| Signed out | 401 |

- **Who came:** only the host or an admin marks it. Anyone else gets 403 "Only the host or an admin marks who came." on `/attendance` and on a self-`attended:true`. The "I went" control is removed from the UI for everyone else.
- **Two flags:** `going` and `attended` stay separate.
- **Where it's enforced:** filtering happens in SQL in `readRsvps`, with a join to `public_gathering` for `host_user_id` and `room_id`, and a `case` that masks `attended`. The client's `forViewer` (with `rsvpSight`: all / host / steward) and `applyServerRsvps` (`rowSight`) apply the same rule as a second layer.
- **The device→server move drops self-marked "I've been" flags** unless the person is the host of that gathering or an admin. Their `going` flag still moves. An entry left empty is skipped.
- **A non-admin host closing their own gathering is recorded on the server:** the roll call sends `userIds` to `/attendance` with `close:true`. There's a test for this.
- **Retention / auto-delete:** not added. Josh is being asked separately.

### What changed
- **migrations/0049_gathering_rsvp.sql (new, unchanged in this update):** `gathering_rsvp(gathering_id → public_gathering.id ON DELETE CASCADE, user_id → "user".id ON DELETE CASCADE, going, attended, created_at, updated_at)`. PK (gathering_id, user_id), check `(going or attended)`, an index on user_id. Idempotent, no count columns.
- **server/board/rsvp.ts:** routes are rate-limited via `limitBoard`.
  - `GET /api/rsvps` returns `{viewer, admin, hosts, stewardRooms, rsvps}`, filtered by role in SQL.
  - `GET /api/gatherings/:id/rsvps` returns `{mine}`, plus `people` for admins, the host, and stewards of the room.
  - `POST /api/gatherings/:id/rsvp` takes `{going?, attended?: true}`. A self-`attended` only works for the host or an admin; others get 403.
  - `POST /api/gatherings/:id/attendance` is host or admin only (403 for others). It takes ≤200 userIds and marks only people who were going. `close` resets the date.
  - `POST /api/rsvps/move` only adds, drops non-host/non-admin `attended`, and caps at 200.
  - A missing table gives **503 `{error:"rsvp-not-ready"}`**.
- **Client** (`rsvp-api.ts`, `store.ts`, `model.ts`, views):
  - `rsvp()` sets the value it sent instead of toggling.
  - An in-flight guard means two quick taps send one request. A `rsvpPending` state drives `aria-disabled` + `aria-busy` (not `disabled`).
  - An RSVP stays on the device **only** for `rsvp-not-ready`. Any other failure, including a dropped connection, leaves the button unchanged and shows "Your RSVP was not saved. Try again in a moment." The close/roll call shows "Who came was not saved. Try again in a moment."
  - A `role=status` line "Not saved. Try again." appears under the button.
  - The roll call picks people by **userId**, so two members with one name aren't mixed up. Names fall back to ids only when exactly one person matches.
  - The roll call shows for the host and admins. Stewards see the going list.
- **RsvpControl / CSS:**
  - The laurel animates only after a tap (`data-tapped`) and respects `prefers-reduced-motion`.
  - The pending style is `aria-disabled="true"`.
- **Copy:**
  - About: "Who's coming stays private. The host sees who is coming to their own gathering, a room's stewards see who is coming in that room, and admins see every list. Only the host or an admin records who came."
  - The Find intro no longer tells members to press "I went".
- **Tests:**
  - `server/board/rsvp.test.ts` (11) covers admin, owner, host of own vs other, steward of the room vs another room, member, signed out, a member/steward marking attendance (403), a non-admin host's roll call being recorded, 503 rsvp-not-ready, and the move dropping self-attended.
  - `src/lib/board/rsvp-server.test.ts` (11) covers double tap, rsvp-not-ready vs network/other failure, host/steward/member views, the userId roll call with duplicate names, a host's close sending ids (and CAME_NOT_SAVED), and that a member can't mark "I've been".
  - `rsvp-admin-only.test.ts` is renamed to **`rsvp-who-sees.test.ts`** and updated for the new rule, the aria-busy/pending state, and the tap-only animation.

### Keying
Rows are keyed by `public_gathering.id` (UUID) + `user_id`. Seed cards have no row and are never uploaded.

### Deploy order
1. Apply **0049** (only after Josh's OK).
2. Deploy the API and client.

If the API goes first, the routes return 503 rsvp-not-ready and clients keep RSVPs on the device.

### Rollback
1. Redeploy the previous API and client.
2. If needed, run `drop table if exists gathering_rsvp;`. Server-stored RSVPs are lost.

### Open questions: resolved
1. Hosts see the going list for their own gatherings? **Yes** (Josh).
2. Two flags vs one status? **Two flags** (Josh).
3. Stewards see the list? **Yes, who's going in rooms they steward.** Read as going-only, not who came. Flag if that's wrong.
4. Members self-mark "I've been"? **No.** Only the host or an admin marks who came.
5. Still open: **retention / auto-delete.** Josh is being asked separately. Nothing is added here.

### Tests
- **Full serial run** (`node scripts/run-tests.mjs`, Node 24, DB env unset):
  - scripts: 245 tests, 236 pass, 0 fail, 9 skipped
  - app: 889 tests, 876 pass, 0 fail, 13 skipped
  - exit 0
- `tsc --noEmit`: only the 4 known baseline errors in confirm-dialog.render.test.mjs.
