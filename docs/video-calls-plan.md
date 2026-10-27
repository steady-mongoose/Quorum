# Avouch video calls — plan

Repo steady-mongoose/Quorum, base `the-board` (5b8a2a5). Signaling branch: `cursor/video-dm-calls` (b7cdb57), pushed, no PR, not merged, prod untouched.

## 1. TURN cost estimate (priority)

### Usage assumption (10-50 members, a few calls a week)

- About 3 calls a week, so about 13 a month, at about 45 min each. Video runs about 1.5 Mbps per stream (720p).
- A 1:1 call carries 2 streams, about 1 GB of media in total. A 4-person mesh room call carries 12 streams, about 6 GB.
- Mix assumed: 10 one-to-one calls plus 3 room calls a month, about 28 GB of media.
- Typically only 10-25% of calls need a relay (people on strict carrier or office networks). That puts expected TURN traffic at **3-7 GB a month**. Worst case, with every call relayed, it is **about 30-60 GB a month**.

| Option                                           | One-time cost                                                                             | Monthly cost at our scale                                                                                                                                                   | What it does for Avouch                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Self-hosted coturn on the existing Vultr box** | $0 to buy; about 2-4 h setup (ports 3478/5349 plus a UDP relay range, TLS cert, firewall) | **$0 extra**. Relayed traffic goes through the box twice (in and out), so worst case is about 120 GB. Vultr plans include 1-5 TB of bandwidth a month; overage is $0.01/GB. | The existing code already mints coturn REST credentials (`server/calls/turn.ts`, `CALLS_TURN_SECRET`), so nothing new has to be built. Media stays on our own server (privacy). Downsides: one region only, it uses the box's CPU and bandwidth, and we run it ourselves. |
| **Cloudflare Realtime TURN**                     | $0                                                                                        | **$0**. $0.05/GB egress, but the first 1,000 GB a month are free (shared with the SFU). Even 60 GB stays inside the free tier.                                              | Anycast global network with ports 443/80 that get through firewalls. Free with the Cloudflare SFU if we move to an SFU later. Needs a small change: mint credentials through the Cloudflare TURN key API instead of the coturn HMAC.                                      |
| **Twilio Network Traversal**                     | $0                                                                                        | **About $1-3 expected; $12-24 worst case**. STUN is free; TURN is $0.40/GB (US/EU).                                                                                         | Reliable and global. Costs the most per GB, and needs a Twilio account plus a token API call for each call.                                                                                                                                                               |
| **metered.ca**                                   | $0                                                                                        | **Free tier is 500 MB a month**, which one relayed call can use up. A realistic plan is **$99/mo** (150 GB; overage $0.40/GB).                                              | A global, managed TURN service with a dashboard. It costs far more than we need at our scale.                                                                                                                                                                             |

**Recommendation:** use Cloudflare Realtime TURN ($0 at our scale, and it gets through firewalls on 443). Keep coturn on Vultr as the free self-hosted option, or as a fallback. Either one needs Josh's OK before it goes live (it's an account or service plus a config change), and neither needs a migration.

**Is TURN needed?** Yes, for reliability. STUN alone fails for people behind symmetric NAT or carrier-grade NAT, which covers many phones on cellular and office networks. Without TURN, roughly 10-20% of calls would never connect.

Pricing sources (fetched Oct 27, 2026):

- Cloudflare TURN: https://developers.cloudflare.com/realtime/turn/
- Cloudflare SFU/TURN pricing: https://developers.cloudflare.com/realtime/sfu/pricing/
- Twilio: https://www.twilio.com/en-us/stun-turn/pricing
- metered.ca: https://www.metered.ca/stun-turn
- Vultr (bandwidth and $0.01/GB overage): https://www.vultr.com/pricing/
- Note: the Vultr box's actual plan and bandwidth quota weren't checked. Confirm them in the Vultr console.

## 2. What exists today (PR #18, merged as 66117a1)

- **Server:** `server/calls/*`. Routes `/api/calls/status` and `/api/calls/rooms/:id` with `join`, `leave`, `signal` and poll (HTTP polling, no websockets).
  - Calls are kept in memory in one process and never written to the database. Nothing is recorded.
  - Limits: 6 peers per room; signals expire after 60 s; peers drop after 45 s without a poll.
  - Rate limits apply. Banned members are removed from calls (`evict.ts`).
  - Membership comes from `room_member` plus the audience gate, read-only.
- **Feature flag:** `CALLS=on`. STUN and TURN come from `CALLS_STUN_URLS`, `CALLS_TURN_URLS` and `CALLS_TURN_SECRET` (coturn REST HMAC, 60-minute credentials).
- **Client:** `src/lib/calls/session.ts` runs a polite-peer perfect-negotiation mesh; there is one RTCPeerConnection per peer.

## 3. Pushed on `cursor/video-dm-calls` (no migration, no paid service)

- New routes `/api/calls/dm/:threadId` with `join`, `leave`, `signal` and poll. They use the same in-memory store under the key `dm:<thread>`, limited to 2 peers.
- `server/calls/dm-membership.ts` decides who can call. The caller must be one of the two people in an existing `dm_thread`, they must still share a verified meeting (the same rule that lets them message, via `sharesMeeting`, now exported), and neither of them can have an open ban. Threads the caller isn't in return 404.
- `store.join` takes an optional limit on how many people can join.
- Tests are in `server/calls/dm-calls.test.ts`: the flag being off, joining, signaling and polling, a third person refused, outsiders, strangers and signed-out users refused, DM and room keys kept separate, and the membership check unit-tested. All 25 call tests and the 12 DM store tests pass, and eslint and prettier are clean. Typecheck shows only errors that already exist in `confirm-dialog.render.test.mjs`.

## 4. TURN: Cloudflare first, coturn fallback (built on this branch)

- `server/calls/cloudflare-turn.ts` calls `POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers` with `Bearer TURN_KEY_API_TOKEN` and `{ttl: 3600}`. The result is cached for half the TTL, with a 5 s timeout. Only `turn.cloudflare.com` and `stun.cloudflare.com` URLs are passed on.
- `createIceSource` in `server/calls/config.ts`: Cloudflare when both vars are set; otherwise, or when Cloudflare fails, the existing coturn HMAC path. If only one var is set, calls stay off (`partial-turn`).
- **Policy change to review:** the codebase refused every vendor ICE host. Cloudflare is now allowed only for lists the API minted through the key API (`parseIceUrl(..., {allowCloudflare: true})`). Env URL lists still refuse cloudflare.com.
- No key was created and Cloudflare/prod were not touched. To go live: Josh creates a TURN key (Cloudflare dashboard > Realtime > TURN), puts the two vars in `deploy/.env`, sets `CALLS=on`, then restarts the api.

## 5. Architecture

- Mesh WebRTC, polite-peer negotiation, HTTP polling signaling, one API process, all in memory. Caps: room 6, DM 2. Nothing recorded, no migration.
- SFU (Cloudflare Realtime SFU) only if rooms need more than about 6 people. That would be a separate project, at $0.05/GB after 1 TB free.

## 6. Ringing (host or steward calls a member)

- In-memory ring store (`server/calls/rings.ts`), 60 s TTL, at most 5 pending per person. A repeat ring replaces the earlier one.
- Who can ring: the room's host (`room.host_user_id`), a steward of that room, or an admin. The target must pass the same room-call membership check as a join; otherwise the server answers 409.
- Joining the room's call answers the ring; a ban clears it. No missed-call history, since that would need a migration.

## 7. UI (all hidden unless `/api/calls/status` says enabled and not recorded)

- Room: the existing call panel, now a shared `CallPanel`. Once you're in the call, hosts and stewards see a "Call a member to this room" picker.
- Messages: a "Video call" button in the open thread (`dm-call.tsx`) opens the same panel against `/api/calls/dm/<thread>`.
- Incoming ring: a `role="alertdialog"` banner, "X is calling you to a room call", with "Go to the call" and "Not now". Focus moves to it. It polls every 5 s only while calls are on.
- All controls are at least 44px tall. Mute and camera buttons use `aria-pressed`, and an sr-only status line announces joining and joined.

## 8. Tests

- `server/calls/cloudflare-turn.test.ts`: request shape, host filtering, cache and refresh, fallback on failure, no call without a key, partial key keeps calls off, env Cloudflare URLs still refused.
- `server/calls/rings.test.ts`: store behaviour; routes check that only host/steward can ring, the target must be a member, self-ring returns 400, the inbox shows only your rings, dismiss works, and rings are off with the flag off.
- `src/lib/calls/rings.test.ts`: the client drops malformed or unsafe rings.
- Plus the existing DM, room, config, store, evict, session and ICE tests.

## 9. QA plan (before turning on in prod)

1. Locally with `CALLS=on` and STUN only: two Chrome profiles with `--use-fake-device-for-media-stream`. Run a DM call, a room call, a ring followed by Go to the call, and a ban mid-call (the person is dropped).
2. Staging with a Cloudflare key: one phone on cellular and one laptop on Wi-Fi. Check in `chrome://webrtc-internals` that the selected candidate is `relay` via turn.cloudflare.com. Record that test session screen-side only, as QA evidence; the product itself never records.
3. Pull the key (or block rtc.live.cloudflare.com) and confirm it falls back to coturn/STUN.
4. Keyboard and screen reader pass: VoiceOver/NVDA announce the ring dialog, and every control is reachable with Tab.

## 10. Effort and what needs Josh

- Done on this branch: about 2 days of work. QA steps 1–4 take about half a day, and step 2 needs two real devices.
- Needs Josh: create the Cloudflare TURN key, set the env vars and `CALLS=on`, OK the vendor-host policy exception, and merge the PR.
