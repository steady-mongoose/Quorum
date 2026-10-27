import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { roomCallMember } from "../calls/membership.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import { sendChat } from "../chat/store.ts";
import type { Db } from "../db.ts";
import { memberOfRoom } from "../media/access.ts";
import { CLAIM_CODE_ATTEMPTS, roleLevel } from "../../src/lib/board/claim-policy.ts";
import { canReadRoom } from "./room-visibility.ts";
import { actorRole, councilFlags } from "./access.ts";
import {
  checkSiteCode,
  confirmClaimCode,
  decideClaim,
  expireClaims,
  importListings,
  importListingsFile,
  listClaims,
  requestClaim,
  seededRoom,
  type ClaimDeps,
} from "./claims.ts";
import { loadSharedGathering } from "./gathering-record.ts";
import { requestGroup } from "./groups.ts";
import { joinRoom, listHome } from "./places-store.ts";
import { handlePublicGathering } from "./public-gathering.ts";
import { createPost, listBoard } from "./store.ts";

const now = new Date("2026-10-26T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const did = {
  type: "did",
  claim: "Sharpened the chisels in the shop.",
  reason: "Tom checked them on Thursday.",
  on: "2026-10-18",
};

async function user(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`, now],
  );
  return id;
}

async function grant(
  db: Db,
  userId: string,
  name: string,
  role: "member" | "steward" | "admin",
  roomId = "",
) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
    [randomUUID(), userId, name, role, roomId, now],
  );
}

async function member(db: Db, name: string): Promise<string> {
  const id = await user(db, name);
  await grant(db, id, name, "member");
  return id;
}

async function steward(db: Db, name: string): Promise<string> {
  const id = await member(db, name);
  await grant(db, id, name, "steward", "shop");
  return id;
}

async function admin(db: Db, name: string): Promise<string> {
  const id = await user(db, name);
  await db.query(
    `insert into member_role (user_id, is_admin, is_council, is_council_chair)
     values ($1, true, false, false)`,
    [id],
  );
  return id;
}

async function chair(db: Db, name: string): Promise<string> {
  const id = await steward(db, name);
  await db.query(
    `insert into member_role (user_id, is_admin, is_council, is_council_chair)
     values ($1, false, true, true)`,
    [id],
  );
  return id;
}

async function owner(db: Db, name: string): Promise<string> {
  const id = await user(db, name);
  await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', $1)`, [id]);
  return id;
}

function listing(name: string, host: string, status?: "draft" | "unclaimed") {
  return {
    name,
    town: "Brandon",
    county: "Hillsborough",
    category: "Church",
    source_url: `https://${host}/about`,
    ...(status ? { status } : {}),
  };
}

async function seed(db: Db, userId: string, rows: ReturnType<typeof listing>[]) {
  return importListings(db, { userId, body: { listings: rows }, now });
}

async function stand(db: Db, userId: string, roomId: string) {
  await db.query(
    `insert into room_member (room_id, user_id) values ($1, $2) on conflict do nothing`,
    [roomId, userId],
  );
}

function roomIdsOf(sections: { rooms?: { id: string }[]; posts?: { room: string }[] }[]): string[] {
  return sections.flatMap((section) => section.rooms?.map((room) => room.id) ?? []);
}

async function withLogs<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const previous = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const value = await run();
    return { value, lines };
  } finally {
    console.log = previous;
  }
}

function codeFrom(text: string): string {
  const match = /The code is ([A-Z2-9]{8})\./.exec(text);
  assert.ok(match?.[1], "the mail contains the code");
  return match[1] ?? "";
}

test("an unknown room status stays hidden, including from an admin", () => {
  const memberActor = { admin: false, steward: false };
  const stewardActor = { admin: false, steward: true };
  assert.equal(canReadRoom("active", memberActor), true);
  assert.equal(canReadRoom("draft", memberActor), false);
  assert.equal(canReadRoom("unclaimed", memberActor), false);
  assert.equal(canReadRoom("unclaimed", stewardActor), true);
  assert.equal(canReadRoom("sealed", stewardActor), false);
  assert.equal(canReadRoom("sealed", { admin: true, steward: true }), false);
});

test("draft and unclaimed rooms stay off member reads and public pages", async () => {
  const { db, close } = await openTestDb();
  try {
    const ana = await member(db, "Ana");
    const lee = await steward(db, "Lee");
    const pat = await admin(db, "Pat");
    const imported = await seed(db, pat, [
      listing("Grace Hall", "grace.example"),
      listing("Oak Chapel", "oak.example", "draft"),
    ]);
    assert.equal(imported.ok, true);

    const memberBoard = await listBoard(db, ana, now);
    assert.equal(memberBoard.ok, true);
    if (!memberBoard.ok) return;
    const memberRooms = memberBoard.value.rooms.map((room) => room.id);
    assert.equal(memberRooms.includes("shop"), true);
    assert.equal(memberRooms.includes("grace-hall"), false);
    assert.equal(memberRooms.includes("oak-chapel"), false);
    const named = await listBoard(db, ana, now, { room: "grace-hall" });
    assert.equal(named.ok, false);
    if (!named.ok) assert.equal(named.status, 404);

    const stewardBoard = await listBoard(db, lee, now);
    assert.equal(stewardBoard.ok, true);
    if (!stewardBoard.ok) return;
    const grace = stewardBoard.value.rooms.find((room) => room.id === "grace-hall");
    const oak = stewardBoard.value.rooms.find((room) => room.id === "oak-chapel");
    assert.equal(grace?.status, "unclaimed");
    assert.equal(oak?.status, "draft");
    assert.equal(grace?.town, "Brandon");
    assert.equal(grace?.sourceUrl, "https://grace.example/about");

    const adminBoard = await listBoard(db, pat, now);
    assert.equal(adminBoard.ok, true);
    if (!adminBoard.ok) return;
    assert.equal(
      adminBoard.value.rooms.some((room) => room.id === "grace-hall"),
      true,
    );

    await stand(db, ana, "grace-hall");
    await db.query(
      `insert into room_join (user_id, room_id, joined_at) values ($1, 'grace-hall', $2)`,
      [ana, now],
    );
    const memberHome = await listHome(db, ana, now);
    assert.equal(memberHome.ok, true);
    if (!memberHome.ok) return;
    assert.equal(roomIdsOf(memberHome.value.sections).includes("grace-hall"), false);

    const joined = await joinRoom(db, { userId: lee, roomId: "grace-hall", now });
    assert.equal(joined.ok, true);
    const stewardHome = await listHome(db, lee, now);
    assert.equal(stewardHome.ok, true);
    if (!stewardHome.ok) return;
    assert.equal(roomIdsOf(stewardHome.value.sections).includes("grace-hall"), true);

    const refusedJoin = await joinRoom(db, { userId: ana, roomId: "oak-chapel", now });
    assert.equal(refusedJoin.ok, false);
    if (!refusedJoin.ok) assert.equal(refusedJoin.status, 404);

    const post = await createPost(db, {
      userId: ana,
      name: "Ana",
      roomId: "grace-hall",
      body: did,
      now,
    });
    assert.equal(post.ok, false);
    if (!post.ok) assert.equal(post.error, "That room is not here.");

    const postId = randomUUID();
    await db.query(
      `insert into board_post
       (id, room_id, author_user_id, author_name, type, claim, reason, subject, created_at)
       values ($1, 'grace-hall', $2, 'Lee', 'did', 'The hall meets on Thursday.', 'The page says so.', 'candidate', $3)`,
      [postId, lee, now],
    );
    await db.query(
      `insert into council_approval (id, post_id, reason, checklist, by_user_id, by_name, action, at)
       values ($1, $2, 'The claim is specific.', $3, $4, 'Pat', 'approve', $5)`,
      [randomUUID(), postId, ["The date is on the page."], pat, now],
    );
    const homeAfter = await listHome(db, ana, now);
    assert.equal(homeAfter.ok, true);
    if (!homeAfter.ok) return;
    const council = homeAfter.value.sections.find((section) => section.tier === "council");
    const councilRooms =
      council && "posts" in council ? council.posts.map((item) => item.room) : [];
    assert.equal(councilRooms.includes("grace-hall"), false);
    const stewardAfter = await listHome(db, lee, now);
    assert.equal(stewardAfter.ok, true);
    if (!stewardAfter.ok) return;
    const stewardCouncil = stewardAfter.value.sections.find(
      (section) => section.tier === "council",
    );
    assert.equal(
      Boolean(
        stewardCouncil &&
        "posts" in stewardCouncil &&
        stewardCouncil.posts.some((item) => item.room === "grace-hall"),
      ),
      true,
    );

    const chat = await sendChat(db, {
      userId: ana,
      name: "Ana",
      roomId: "grace-hall",
      text: "Hello from the hall.",
      now,
    });
    assert.equal(chat.ok, false);
    if (!chat.ok) assert.equal(chat.error, "That room is not here.");
    await stand(db, ana, "shop");
    const shopChat = await sendChat(db, {
      userId: ana,
      name: "Ana",
      roomId: "shop",
      text: "Hello from the shop.",
      now,
    });
    assert.equal(shopChat.ok, true);

    assert.deepEqual(await roomCallMember(db, ana, "grace-hall", now), { kind: "bad-room" });
    assert.deepEqual(await roomCallMember(db, ana, "shop", now), { kind: "member" });

    const media = await memberOfRoom(db, ana, "grace-hall", now);
    assert.equal(media.ok, false);
    if (!media.ok) assert.equal(media.status, 404);
    const shopMedia = await memberOfRoom(db, ana, "shop", now);
    assert.equal(shopMedia.ok, true);

    const group = await requestGroup(db, {
      userId: ana,
      name: "Ana",
      roomId: "grace-hall",
      groupName: "Woodworkers",
      about: "People who work with wood in town.",
      now,
    });
    assert.equal(group.ok, false);
    if (!group.ok) assert.equal(group.error, "Ask from a room you have joined.");

    const gatheringId = randomUUID();
    const openId = randomUUID();
    await db.query(
      `insert into public_gathering
       (id, title, gather_on, gather_time, town, place, room_id, shared, removed, host_user_id)
       values ($1, 'Thursday meeting', '2026-11-05', '7:00 pm', 'Brandon', 'Grace Hall, Brandon', 'grace-hall', true, false, $2),
              ($3, 'Shop hours', '2026-11-05', '9:00 am', 'Brandon', 'The shop, Brandon', 'shop', true, false, $2)`,
      [gatheringId, pat, openId],
    );
    assert.equal(await loadSharedGathering(db, gatheringId, now), null);
    const hiddenPage = await handlePublicGathering(
      { db, readSession: async () => null, now: () => now },
      new Request(`http://127.0.0.1:8787/api/e/${gatheringId}`),
      new URL(`http://127.0.0.1:8787/api/e/${gatheringId}`),
    );
    assert.ok(hiddenPage);
    assert.equal(hiddenPage?.status, 404);
    const openPage = await handlePublicGathering(
      { db, readSession: async () => null, now: () => now },
      new Request(`http://127.0.0.1:8787/api/e/${openId}`),
      new URL(`http://127.0.0.1:8787/api/e/${openId}`),
    );
    assert.equal(openPage?.status, 200);
    const openBody = (await openPage?.json()) as { title?: string };
    assert.equal(openBody.title, "Shop hours");
  } finally {
    await close();
  }
});

test("only an admin can import a listing, and only the given fields are stored", async () => {
  const { db, close } = await openTestDb();
  try {
    const ana = await member(db, "Ana");
    const lee = await steward(db, "Lee");
    const pat = await admin(db, "Pat");
    const before = await db.query<{ n: number }>(`select count(*)::int as n from town`);
    const refused = await seed(db, ana, [listing("Grace Hall", "grace.example")]);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.status, 403);
    const stewardRefused = await seed(db, lee, [listing("Grace Hall", "grace.example")]);
    assert.equal(stewardRefused.ok, false);

    const imported = await seed(db, pat, [listing("Grace Hall", "grace.example")]);
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    assert.equal(imported.value.imported[0]?.id, "grace-hall");
    const room = await seededRoom(db, "grace-hall");
    assert.equal(room?.what, "");
    assert.equal(room?.town_name, "Brandon");
    assert.equal(room?.county, "Hillsborough");
    assert.equal(room && "category" in room, false);
    const categoryColumn = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'room' and column_name = 'category'`,
    );
    assert.equal(categoryColumn.length, 0);
    assert.equal(room?.source_url, "https://grace.example/about");
    assert.equal(room?.status, "unclaimed");
    assert.equal(room?.host_user_id, null);
    const after = await db.query<{ n: number }>(`select count(*)::int as n from town`);
    assert.equal(after[0]?.n, before[0]?.n);

    const again = await seed(db, pat, [listing("Grace Hall", "grace.example")]);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.status, 409);

    const csv = await importListingsFile(db, {
      userId: pat,
      format: "csv",
      text: "name,town,county,category,source_url,status\nOak Chapel,Brandon,Hillsborough,Church,https://oak.example/about,draft\n",
      now,
    });
    assert.equal(csv.ok, true);
    const oak = await seededRoom(db, "oak-chapel");
    assert.equal(oak?.status, "draft");
    assert.equal(oak?.what, "");
    assert.equal(oak?.source_url, "https://oak.example/about");
  } finally {
    await close();
  }
});

test("email and site claims move through every state, and approval makes the claimant host", async () => {
  const { db, close } = await openTestDb();
  try {
    const ana = await member(db, "Ana");
    const bea = await member(db, "Bea");
    const cam = await member(db, "Cam");
    const lee = await steward(db, "Lee");
    const pat = await admin(db, "Pat");
    const imported = await seed(db, pat, [
      listing("Grace Hall", "grace.example"),
      listing("Oak Chapel", "oak.example", "draft"),
      listing("North Hall", "north.example"),
      listing("South Hall", "south.example"),
      listing("Maple Hall", "maple.example"),
    ]);
    assert.equal(imported.ok, true);
    await grant(db, lee, "Lee", "steward", "grace-hall");
    await grant(db, lee, "Lee", "steward", "north-hall");
    await grant(db, lee, "Lee", "steward", "maple-hall");

    const draft = await requestClaim(db, {
      userId: ana,
      roomKey: "Oak Chapel",
      method: "site_code",
      email: "",
      now,
    });
    assert.equal(draft.ok, false);
    if (!draft.ok) assert.equal(draft.status, 404);

    const badMethod = await requestClaim(db, {
      userId: ana,
      roomKey: "grace-hall",
      method: "phone",
      email: "",
      now,
    });
    assert.equal(badMethod.ok, false);
    if (!badMethod.ok) assert.equal(badMethod.status, 400);

    const wrongDomain = await requestClaim(db, {
      userId: ana,
      roomKey: "Grace Hall",
      method: "domain_email",
      email: "ana@gmail.com",
      now,
    });
    assert.equal(wrongDomain.ok, false);
    if (!wrongDomain.ok)
      assert.equal(wrongDomain.error, "That address is not on the organization's domain.");

    const mailDown = await withLogs(() =>
      requestClaim(
        db,
        {
          userId: ana,
          roomKey: "grace-hall",
          method: "domain_email",
          email: "office@grace.example",
          now,
        },
        { send: async () => ({ ok: false, error: "down" }) },
      ),
    );
    assert.equal(mailDown.value.ok, false);
    if (!mailDown.value.ok) assert.equal(mailDown.value.status, 503);
    assert.match(mailDown.lines.join("\n"), /claim-mail-failed/);
    const leftover = await db.query(`select id from claim_request`);
    assert.equal(leftover.length, 0);

    let mailed = "";
    const requested = await requestClaim(
      db,
      {
        userId: ana,
        roomKey: "Grace Hall",
        method: "domain_email",
        email: "Office@Grace.example",
        now,
      },
      {
        send: async (message) => {
          mailed = message.text;
          assert.equal(message.to, "office@grace.example");
          return { ok: true };
        },
      },
    );
    assert.equal(requested.ok, true);
    if (!requested.ok) return;
    const code = codeFrom(mailed);
    const packed = JSON.stringify(requested.value.claim);
    assert.equal(packed.includes(code), false);
    const stored = await db.query<{ evidence: string }>(
      `select evidence from claim_request where id = $1`,
      [requested.value.claim.id],
    );
    assert.equal(stored[0]?.evidence.includes(code), false);
    assert.match(stored[0]?.evidence ?? "", /codeHash/);
    assert.equal(requested.value.claim.state, "pending");
    assert.equal(requested.value.claim.verified, false);
    assert.equal(requested.value.claim.mine, true);

    const duplicate = await requestClaim(db, {
      userId: ana,
      roomKey: "grace-hall",
      method: "site_code",
      email: "",
      now,
    });
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.status, 409);

    const wrong = await confirmClaimCode(db, {
      userId: ana,
      claimId: requested.value.claim.id,
      code: "ZZZZZZZZ",
      now,
    });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.error, "That code does not match.");

    const expiredCode = await confirmClaimCode(db, {
      userId: ana,
      claimId: requested.value.claim.id,
      code,
      now: new Date(now.getTime() + DAY + 60_000),
    });
    assert.equal(expiredCode.ok, false);
    if (!expiredCode.ok) assert.equal(expiredCode.error, "That code has expired.");

    const confirmed = await confirmClaimCode(db, {
      userId: ana,
      claimId: requested.value.claim.id,
      code,
      now,
    });
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.equal(confirmed.value.claim.verified, true);
    assert.equal(confirmed.value.claim.state, "pending");

    const rival = await requestClaim(db, {
      userId: bea,
      roomKey: "grace-hall",
      method: "steward_review",
      email: "",
      now,
    });
    assert.equal(rival.ok, true);
    if (!rival.ok) return;

    const gatheringId = randomUUID();
    await db.query(
      `insert into public_gathering
       (id, title, gather_on, gather_time, town, place, room_id, shared, removed, host_user_id)
       values ($1, 'Thursday meeting', '2026-11-05', '7:00 pm', 'Brandon', 'Grace Hall, Brandon', 'grace-hall', true, false, $2)`,
      [gatheringId, pat],
    );
    const approved = await withLogs(() =>
      decideClaim(db, {
        userId: lee,
        claimId: requested.value.claim.id,
        decision: "approve",
        note: "",
        now,
      }),
    );
    assert.equal(approved.value.ok, true);
    if (!approved.value.ok) return;
    assert.equal(approved.value.value.claim.state, "approved");
    assert.match(approved.lines.join("\n"), /claim-approved/);
    assert.match(approved.lines.join("\n"), /Another claim was approved/);
    const host = await seededRoom(db, "grace-hall");
    assert.equal(host?.status, "active");
    assert.equal(host?.host_user_id, ana);
    const grantRow = await db.query<{ note: string; role: string }>(
      `select note, role from access_log where user_id = $1 and room_id = 'grace-hall' and role = 'steward'`,
      [ana],
    );
    assert.equal(grantRow[0]?.note, "Host, claimed this listing.");
    const shared = await db.query<{ shared: boolean }>(
      `select shared from public_gathering where id = $1`,
      [gatheringId],
    );
    assert.equal(shared[0]?.shared, false);
    assert.equal(await loadSharedGathering(db, gatheringId, now), null);
    const rivalRow = await db.query<{ state: string }>(
      `select state from claim_request where id = $1`,
      [rival.value.claim.id],
    );
    assert.equal(rivalRow[0]?.state, "rejected");

    const seen = await listBoard(db, ana, now);
    assert.equal(seen.ok, true);
    if (!seen.ok) return;
    assert.equal(
      seen.value.rooms.some((room) => room.id === "grace-hall" && room.status === "active"),
      true,
    );

    await db.query(`update room set name = 'North Hall' where id = 'south-hall'`);
    const ambiguous = await requestClaim(db, {
      userId: bea,
      roomKey: "North Hall",
      method: "site_code",
      email: "",
      now,
    });
    assert.equal(ambiguous.ok, false);
    if (!ambiguous.ok) assert.equal(ambiguous.status, 409);
    const byId = await requestClaim(db, {
      userId: bea,
      roomKey: "north-hall",
      method: "site_code",
      email: "",
      now,
    });
    assert.equal(byId.ok, true);
    if (!byId.ok) return;
    assert.match(byId.value.claim.token, /^avouch-/);
    const stranger = await checkSiteCode(db, {
      userId: cam,
      claimId: byId.value.claim.id,
      now,
    });
    assert.equal(stranger.ok, false);
    if (!stranger.ok) assert.equal(stranger.status, 404);
    const selfAttest = await checkSiteCode(db, {
      userId: bea,
      claimId: byId.value.claim.id,
      now,
    });
    assert.equal(selfAttest.ok, false);
    if (!selfAttest.ok)
      assert.equal(selfAttest.error, "A steward does not decide their own claim.");
    const missing = await checkSiteCode(
      db,
      { userId: lee, claimId: byId.value.claim.id, now },
      { fetchPage: async () => ({ ok: true, body: "no code here" }) },
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "The page did not show the code.");
    const early = await decideClaim(db, {
      userId: pat,
      claimId: byId.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(early.ok, false);
    if (!early.ok) assert.equal(early.error, "The code has not been checked yet.");
    const checked = await checkSiteCode(
      db,
      { userId: lee, claimId: byId.value.claim.id, now },
      { fetchPage: async () => ({ ok: true, body: byId.value.claim.token }) },
    );
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    assert.equal(checked.value.claim.verified, true);
    const evidence = await db.query<{ evidence: string }>(
      `select evidence from claim_request where id = $1`,
      [byId.value.claim.id],
    );
    assert.match(evidence[0]?.evidence ?? "", /"checkedBy":"server"/);
    assert.equal(evidence[0]?.evidence.includes('"checkedBy":"steward"'), false);

    const maple = await requestClaim(db, {
      userId: ana,
      roomKey: "maple-hall",
      method: "site_code",
      email: "",
      now,
    });
    assert.equal(maple.ok, true);
    if (!maple.ok) return;
    const serverChecked = await checkSiteCode(
      db,
      { userId: lee, claimId: maple.value.claim.id, now },
      {
        fetchPage: async (url) => {
          assert.equal(url, "https://maple.example/about");
          return { ok: true, body: `<p>${maple.value.claim.token}</p>` };
        },
      } satisfies ClaimDeps,
    );
    assert.equal(serverChecked.ok, true);

    const queue = await listClaims(db, { userId: cam, now });
    assert.equal(queue.ok, true);
    if (!queue.ok) return;
    assert.deepEqual(queue.value.methods.slice(0, 2), ["site_code", "domain_email"]);
    assert.equal(
      queue.value.listings.some((row) => row.id === "north-hall" && row.status === "unclaimed"),
      true,
    );
    assert.equal(
      queue.value.listings.some((row) => row.id === "oak-chapel"),
      false,
    );
    assert.equal(queue.value.log.length, 0);
    const hostQueue = await listClaims(db, { userId: ana, now });
    assert.equal(hostQueue.ok, true);
    if (!hostQueue.ok) return;
    assert.equal(
      hostQueue.value.listings.some((row) => row.id === "oak-chapel"),
      true,
    );
    const stewardQueue = await listClaims(db, { userId: lee, now });
    assert.equal(stewardQueue.ok, true);
    if (!stewardQueue.ok) return;
    assert.equal(
      stewardQueue.value.claims.some(
        (row) =>
          row.id === byId.value.claim.id &&
          row.method === "site_code" &&
          row.state === "pending" &&
          row.mine === false,
      ),
      true,
    );
    assert.equal(
      stewardQueue.value.listings.some((row) => row.id === "oak-chapel" && row.status === "draft"),
      true,
    );
    assert.equal(
      stewardQueue.value.log.some(
        (row) => row.id === rival.value.claim.id && row.state === "rejected",
      ),
      true,
    );

    const rejected = await withLogs(() =>
      decideClaim(db, {
        userId: lee,
        claimId: maple.value.claim.id,
        decision: "reject",
        note: "The page is a different organization.",
        now,
      }),
    );
    assert.equal(rejected.value.ok, true);
    if (!rejected.value.ok) return;
    assert.equal(rejected.value.value.claim.state, "rejected");
    assert.match(rejected.lines.join("\n"), /claim-rejected/);

    const aging = await requestClaim(db, {
      userId: bea,
      roomKey: "maple-hall",
      method: "steward_review",
      email: "",
      now,
    });
    assert.equal(aging.ok, true);
    if (!aging.ok) return;
    const later = new Date(now.getTime() + 15 * DAY);
    const expired = await withLogs(() => expireClaims(db, later));
    assert.match(expired.lines.join("\n"), /claim-expired/);
    const aged = await db.query<{ state: string }>(
      `select state from claim_request where id = $1`,
      [aging.value.claim.id],
    );
    assert.equal(aged[0]?.state, "expired");
  } finally {
    await close();
  }
});

test("steward review alone is allowed only at or above the admin trust line", async () => {
  const { db, close } = await openTestDb();
  try {
    const ana = await member(db, "Ana");
    const lee = await steward(db, "Lee");
    const sam = await steward(db, "Sam");
    const kim = await chair(db, "Kim");
    const pat = await admin(db, "Pat");
    const owen = await owner(db, "Owen");
    const imported = await seed(db, pat, [
      listing("River Chapel", "river.example"),
      listing("Pine Hall", "pine.example"),
      listing("Oak Lodge", "oaklodge.example"),
      listing("Cedar Hall", "cedar.example"),
      listing("Lee Hall", "lee.example"),
    ]);
    assert.equal(imported.ok, true);
    await grant(db, lee, "Lee", "steward", "river-chapel");
    await grant(db, lee, "Lee", "steward", "oak-lodge");
    await grant(db, lee, "Lee", "steward", "lee-hall");
    await grant(db, kim, "Kim", "steward", "river-chapel");

    const kimRole = await actorRole(db, kim);
    const flags = await councilFlags(db, kim);
    assert.equal(flags.chair, true);
    assert.equal(flags.council, true);
    assert.equal(kimRole.admin, false);
    assert.equal(kimRole.owner, false);
    assert.equal(roleLevel(kimRole), "steward");
    assert.equal(roleLevel(await actorRole(db, lee)), "steward");
    assert.equal(roleLevel(await actorRole(db, pat)), "admin");
    assert.equal(roleLevel(await actorRole(db, owen)), "owner");

    const river = await requestClaim(db, {
      userId: ana,
      roomKey: "River Chapel",
      method: "steward_review",
      email: "",
      now,
    });
    assert.equal(river.ok, true);
    if (!river.ok) return;
    const otherRoom = await decideClaim(db, {
      userId: sam,
      claimId: river.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(otherRoom.ok, false);
    if (!otherRoom.ok) {
      assert.equal(otherRoom.status, 403);
      assert.equal(otherRoom.error, "Only a steward of this listing can decide a claim.");
    }
    const leeReview = await decideClaim(db, {
      userId: lee,
      claimId: river.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(leeReview.ok, false);
    if (!leeReview.ok) {
      assert.equal(leeReview.status, 403);
      assert.equal(
        leeReview.error,
        "This claim needs a code on the site or an email on the organization's domain.",
      );
    }
    const kimReview = await decideClaim(db, {
      userId: kim,
      claimId: river.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(kimReview.ok, false);
    if (!kimReview.ok) assert.equal(kimReview.status, 403);
    const patReview = await decideClaim(db, {
      userId: pat,
      claimId: river.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(patReview.ok, true);
    const riverRoom = await seededRoom(db, "river-chapel");
    assert.equal(riverRoom?.status, "active");
    assert.equal(riverRoom?.host_user_id, ana);

    const pine = await requestClaim(db, {
      userId: ana,
      roomKey: "Pine Hall",
      method: "steward_review",
      email: "",
      now,
    });
    assert.equal(pine.ok, true);
    if (!pine.ok) return;
    const owenReview = await decideClaim(db, {
      userId: owen,
      claimId: pine.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(owenReview.ok, true);
    const pineRoom = await seededRoom(db, "pine-hall");
    assert.equal(pineRoom?.status, "active");
    assert.equal(pineRoom?.host_user_id, ana);

    const own = await requestClaim(db, {
      userId: lee,
      roomKey: "Lee Hall",
      method: "steward_review",
      email: "",
      now,
    });
    assert.equal(own.ok, true);
    if (!own.ok) return;
    const ownDecision = await decideClaim(db, {
      userId: lee,
      claimId: own.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(ownDecision.ok, false);
    if (!ownDecision.ok)
      assert.equal(ownDecision.error, "A steward does not decide their own claim.");

    const lodge = await requestClaim(db, {
      userId: ana,
      roomKey: "oak-lodge",
      method: "site_code",
      email: "",
      now,
    });
    assert.equal(lodge.ok, true);
    if (!lodge.ok) return;
    const unchecked = await decideClaim(db, {
      userId: lee,
      claimId: lodge.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(unchecked.ok, false);
    if (!unchecked.ok) assert.equal(unchecked.error, "The code has not been checked yet.");
    const verified = await checkSiteCode(
      db,
      { userId: lee, claimId: lodge.value.claim.id, now },
      { fetchPage: async () => ({ ok: true, body: lodge.value.claim.token }) },
    );
    assert.equal(verified.ok, true);
    const leeApprovesProof = await decideClaim(db, {
      userId: lee,
      claimId: lodge.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(leeApprovesProof.ok, true);
    const lodgeRoom = await seededRoom(db, "oak-lodge");
    assert.equal(lodgeRoom?.status, "active");
    assert.equal(lodgeRoom?.host_user_id, ana);

    const cedar = await requestClaim(
      db,
      {
        userId: ana,
        roomKey: "cedar-hall",
        method: "domain_email",
        email: "office@cedar.example",
        now,
      },
      { send: async () => ({ ok: true }) },
    );
    assert.equal(cedar.ok, true);
    if (!cedar.ok) return;
    const adminSkip = await decideClaim(db, {
      userId: pat,
      claimId: cedar.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(adminSkip.ok, false);
    if (!adminSkip.ok) assert.equal(adminSkip.status, 400);
  } finally {
    await close();
  }
});

async function bar(
  db: Db,
  userId: string,
  name: string,
  reason: "threat" | "porn",
  roomId: string,
  until: Date,
) {
  await db.query(
    `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id, created_at)
     values ($1, $2, $3, $4, 'Pat', 1, $5, $6, $7)`,
    [randomUUID(), userId, name, reason, until, roomId, now],
  );
}

test("bans, shared hosts, and wrong email codes stop a claim", async () => {
  const { db, close } = await openTestDb();
  try {
    const pat = await admin(db, "Pat");
    const owen = await owner(db, "Owen");
    const lee = await steward(db, "Lee");
    const ned = await member(db, "Ned");
    const meg = await member(db, "Meg");
    const sue = await member(db, "Sue");
    const una = await member(db, "Una");
    const old = await member(db, "Old");
    const imported = await seed(db, pat, [
      listing("Site Hall", "facebook.com"),
      listing("Photo Hall", "instagram.com"),
      listing("Link Hall", "linktr.ee"),
      listing("Page Hall", "wixsite.com"),
      listing("Mail Hall", "gmail.com"),
      listing("Grace Hall", "grace.example"),
      listing("Room Hall", "room.example"),
      listing("Other Hall", "other.example"),
      listing("Pat Hall", "pat.example"),
      listing("Owen Hall", "owen.example"),
    ]);
    assert.equal(imported.ok, true);
    await grant(db, lee, "Lee", "steward", "grace-hall");

    const until = new Date(now.getTime() + 7 * DAY);
    await bar(db, ned, "Ned", "porn", "", until);
    await bar(db, meg, "Meg", "porn", "room-hall", until);
    await bar(db, sue, "Sue", "threat", "", until);
    await bar(db, old, "Old", "threat", "", new Date(now.getTime() - DAY));

    for (const person of [ned, sue]) {
      const refused = await requestClaim(db, {
        userId: person,
        roomKey: "grace-hall",
        method: "steward_review",
        email: "",
        now,
      });
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.equal(refused.status, 403);
    }
    const roomBan = await requestClaim(db, {
      userId: meg,
      roomKey: "room-hall",
      method: "steward_review",
      email: "",
      now,
    });
    assert.equal(roomBan.ok, false);
    if (!roomBan.ok) assert.equal(roomBan.error, "This account cannot claim a listing right now.");
    const otherRoom = await requestClaim(db, {
      userId: meg,
      roomKey: "other-hall",
      method: "steward_review",
      email: "",
      now,
    });
    assert.equal(otherRoom.ok, true);
    const lapsed = await requestClaim(db, {
      userId: old,
      roomKey: "grace-hall",
      method: "steward_review",
      email: "",
      now,
    });
    assert.equal(lapsed.ok, true);

    const pending = await requestClaim(db, {
      userId: una,
      roomKey: "grace-hall",
      method: "steward_review",
      email: "",
      now,
    });
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    await bar(db, una, "Una", "threat", "", until);
    const approved = await decideClaim(db, {
      userId: pat,
      claimId: pending.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(approved.ok, false);
    if (!approved.ok) assert.equal(approved.status, 403);
    const still = await seededRoom(db, "grace-hall");
    assert.equal(still?.status, "unclaimed");
    assert.equal(still?.host_user_id, null);
    const confirmBar = await requestClaim(
      db,
      {
        userId: una,
        roomKey: "other-hall",
        method: "domain_email",
        email: "office@other.example",
        now,
      },
      { send: async () => ({ ok: true }) },
    );
    assert.equal(confirmBar.ok, false);

    const sharedSite = await requestClaim(db, {
      userId: old,
      roomKey: "site-hall",
      method: "site_code",
      email: "",
      now,
    });
    assert.equal(sharedSite.ok, false);
    if (!sharedSite.ok) assert.match(sharedSite.error, /shared site/);
    const instagram = await requestClaim(db, {
      userId: old,
      roomKey: "photo-hall",
      method: "site_code",
      email: "",
      now,
    });
    assert.equal(instagram.ok, false);
    if (!instagram.ok) assert.match(instagram.error, /shared site/);
    const link = await requestClaim(db, {
      userId: old,
      roomKey: "link-hall",
      method: "site_code",
      email: "",
      now,
    });
    assert.equal(link.ok, false);
    const wix = await requestClaim(db, {
      userId: old,
      roomKey: "page-hall",
      method: "domain_email",
      email: "office@wixsite.com",
      now,
    });
    assert.equal(wix.ok, false);
    const gmail = await requestClaim(db, {
      userId: old,
      roomKey: "mail-hall",
      method: "domain_email",
      email: "office@gmail.com",
      now,
    });
    assert.equal(gmail.ok, false);
    const reviewShared = await requestClaim(db, {
      userId: old,
      roomKey: "site-hall",
      method: "steward_review",
      email: "",
      now,
    });
    assert.equal(reviewShared.ok, true);

    let mailed = "";
    const coded = await requestClaim(
      db,
      {
        userId: old,
        roomKey: "room-hall",
        method: "domain_email",
        email: "office@room.example",
        now,
      },
      {
        send: async (message) => {
          mailed = message.text;
          return { ok: true };
        },
      },
    );
    assert.equal(coded.ok, true);
    if (!coded.ok) return;
    const code = codeFrom(mailed);
    for (let attempt = 1; attempt < CLAIM_CODE_ATTEMPTS; attempt += 1) {
      const wrong = await confirmClaimCode(db, {
        userId: old,
        claimId: coded.value.claim.id,
        code: "ZZZZZZZZ",
        now,
      });
      assert.equal(wrong.ok, false);
      if (!wrong.ok) assert.equal(wrong.error, "That code does not match.");
    }
    const expired = await withLogs(() =>
      confirmClaimCode(db, {
        userId: old,
        claimId: coded.value.claim.id,
        code: "ZZZZZZZZ",
        now,
      }),
    );
    assert.equal(expired.value.ok, false);
    if (!expired.value.ok) assert.match(expired.value.error, /expired/);
    assert.match(expired.lines.join("\n"), /claim-expired/);
    const row = await db.query<{ state: string }>(`select state from claim_request where id = $1`, [
      coded.value.claim.id,
    ]);
    assert.equal(row[0]?.state, "expired");
    const after = await confirmClaimCode(db, {
      userId: old,
      claimId: coded.value.claim.id,
      code,
      now,
    });
    assert.equal(after.ok, false);

    const ownAdmin = await requestClaim(db, {
      userId: pat,
      roomKey: "pat-hall",
      method: "steward_review",
      email: "",
      now,
    });
    assert.equal(ownAdmin.ok, true);
    if (!ownAdmin.ok) return;
    const adminOwn = await decideClaim(db, {
      userId: pat,
      claimId: ownAdmin.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(adminOwn.ok, false);
    if (!adminOwn.ok) assert.equal(adminOwn.error, "A steward does not decide their own claim.");
    const ownOwner = await requestClaim(db, {
      userId: owen,
      roomKey: "owen-hall",
      method: "site_code",
      email: "",
      now,
    });
    assert.equal(ownOwner.ok, true);
    if (!ownOwner.ok) return;
    const ownerCheck = await checkSiteCode(
      db,
      { userId: owen, claimId: ownOwner.value.claim.id, now },
      { fetchPage: async () => ({ ok: true, body: ownOwner.value.claim.token }) },
    );
    assert.equal(ownerCheck.ok, false);
    if (!ownerCheck.ok) assert.equal(ownerCheck.status, 403);
    const ownerOwn = await decideClaim(db, {
      userId: owen,
      claimId: ownOwner.value.claim.id,
      decision: "approve",
      note: "",
      now,
    });
    assert.equal(ownerOwn.ok, false);
    if (!ownerOwn.ok) assert.equal(ownerOwn.error, "A steward does not decide their own claim.");
  } finally {
    await close();
  }
});
