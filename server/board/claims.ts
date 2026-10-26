import { createHash, randomBytes, randomUUID } from "node:crypto";
import { generateInviteCode, validEmail } from "../closed-test/rules.ts";
import { isUniqueViolation, type Db } from "../db.ts";
import { sendTextEmail, type MailDeps } from "./alert-mail.ts";
import { actorRole, stewardsRoom } from "./access.ts";
import { openBan } from "./store.ts";
import {
  CLAIM_ALLOWED_METHODS,
  CLAIM_CODE_ATTEMPTS,
  CLAIM_CODE_MS,
  CLAIM_PENDING_MS,
  methodAllowed,
  proofRequired,
  roleLevel,
  sharedClaimHost,
  type ClaimMethod,
} from "../../src/lib/board/claim-policy.ts";
import {
  emailOnOrgDomain,
  listingRoomId,
  parseListingsCsv,
  parseListingsJson,
  type Listing,
} from "../../src/lib/board/listings.ts";
import { ROOM_ID } from "../../src/lib/media/limits.ts";
import { canSeeHiddenRooms, listingColumnsReady } from "./room-visibility.ts";

type Fail = { ok: false; status: number; error: string };
type Ok<T> = { ok: true; value: T };

function fail(status: number, error: string): Fail {
  return { ok: false, status, error };
}

const HOST_NOTE = "Host, claimed this listing.";
const PAGE_CAP = 65_536;
const BARRED = "This account cannot claim a listing right now.";
const NOT_THIS_ROOM = "Only a steward of this listing can decide a claim.";
const OWN_CLAIM = "A steward does not decide their own claim.";
const SHARED_HOST = "That page is on a shared site. Ask a steward to review the claim.";

async function barredFrom(db: Db, userId: string, now: Date, roomId: string): Promise<Fail | null> {
  const ban = await openBan(db, userId, now, roomId);
  if (!ban) return null;
  return fail(403, BARRED);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

type RoomListing = {
  id: string;
  name: string;
  status: string;
  town_name: string;
  county: string;
  category: string;
  source_url: string;
  what: string;
  host_user_id: string | null;
};

type ClaimRow = {
  id: string;
  room_id: string;
  claimant: string | null;
  claimant_name: string;
  method: string;
  evidence: string;
  state: string;
  reviewer: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  decided_at: Date | string | null;
  expires_at: Date | string;
  name: string;
  town_name: string;
  county: string;
  category: string;
  source_url: string;
  room_status: string;
};

export type ClaimView = {
  id: string;
  roomId: string;
  name: string;
  town: string;
  county: string;
  category: string;
  sourceUrl: string;
  method: ClaimMethod;
  state: "pending" | "approved" | "rejected" | "expired";
  claimantName: string;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
  verified: boolean;
  token: string;
  email: string;
  mine: boolean;
};

export type ListingView = {
  id: string;
  name: string;
  town: string;
  county: string;
  category: string;
  sourceUrl: string;
  status: "draft" | "unclaimed";
  createdAt: number;
};

type Evidence = {
  email?: string;
  codeHash?: string;
  codeExpiresAt?: string;
  verifiedAt?: string | null;
  token?: string;
  checkedBy?: "" | "server";
  attempts?: number;
  decisionNote?: string;
};

function atMs(value: Date | string | number | null): number | null {
  if (value === null) return null;
  return new Date(value).getTime();
}

function parseEvidence(text: string): Evidence {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Evidence;
  } catch {
    return {};
  }
}

function hashCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function siteToken(): string {
  return `avouch-${randomBytes(18).toString("base64url")}`;
}

function isMethod(value: string): value is ClaimMethod {
  return value === "site_code" || value === "domain_email" || value === "steward_review";
}

function toView(row: ClaimRow, reveal: boolean, userId: string): ClaimView | null {
  if (!isMethod(row.method)) return null;
  if (
    row.state !== "pending" &&
    row.state !== "approved" &&
    row.state !== "rejected" &&
    row.state !== "expired"
  ) {
    return null;
  }
  const evidence = parseEvidence(row.evidence);
  const verified = Boolean(evidence.verifiedAt);
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name,
    town: row.town_name,
    county: row.county,
    category: row.category,
    sourceUrl: row.source_url,
    method: row.method,
    state: row.state,
    claimantName: row.claimant_name,
    createdAt: atMs(row.created_at) ?? 0,
    expiresAt: atMs(row.expires_at) ?? 0,
    decidedAt: atMs(row.decided_at),
    verified,
    token: reveal && row.method === "site_code" ? (evidence.token ?? "") : "",
    email: reveal && row.method === "domain_email" ? (evidence.email ?? "") : "",
    mine: row.claimant === userId,
  };
}

const CLAIM_SELECT = `select c.id, c.room_id, c.claimant, c.claimant_name, c.method, c.evidence, c.state,
  c.reviewer, c.created_at, c.updated_at, c.decided_at, c.expires_at,
  r.name, r.town_name, r.county, r.category, r.source_url, r.status as room_status
  from claim_request c
  join room r on r.id = c.room_id`;

async function expireDue(db: Db, now: Date): Promise<void> {
  if (!(await listingColumnsReady(db))) return;
  const rows = await db.query<{ id: string; room_id: string }>(
    `update claim_request
     set state = 'expired', updated_at = $1, decided_at = $1
     where state = 'pending' and expires_at <= $1
     returning id, room_id`,
    [now],
  );
  for (const row of rows) {
    console.log(JSON.stringify({ event: "claim-expired", claimId: row.id, roomId: row.room_id }));
  }
}

async function loadClaim(db: Db, id: string): Promise<ClaimRow | null> {
  const rows = await db.query<ClaimRow>(`${CLAIM_SELECT} where c.id = $1`, [id]);
  return rows[0] ?? null;
}

async function personName(db: Db, userId: string): Promise<string | null> {
  const rows = await db.query<{ name: string }>(`select name from "user" where id = $1`, [userId]);
  return rows[0]?.name ?? null;
}

function logDecision(
  event: "claim-approved" | "claim-rejected",
  row: ClaimRow,
  reviewer: string,
): void {
  console.log(
    JSON.stringify({
      event,
      claimId: row.id,
      roomId: row.room_id,
      reviewer,
      claimant: row.claimant,
      method: row.method,
    }),
  );
}

export async function importListings(
  db: Db,
  input: { userId: string; body: unknown; now: Date },
): Promise<Ok<{ imported: ListingView[] }> | Fail> {
  if (!(await listingColumnsReady(db))) return fail(503, "Listings are not available yet.");
  const actor = await actorRole(db, input.userId);
  if (!actor.admin) return fail(403, "Only an admin can import listings.");
  const parsed = parseListingsJson(input.body);
  if (!parsed.ok) return fail(400, parsed.error);
  return writeListings(db, { userId: input.userId, listings: parsed.listings, now: input.now });
}

export async function importListingsFile(
  db: Db,
  input: { userId: string; text: string; format: "json" | "csv"; now: Date },
): Promise<Ok<{ imported: ListingView[] }> | Fail> {
  if (!(await listingColumnsReady(db))) return fail(503, "Listings are not available yet.");
  const actor = await actorRole(db, input.userId);
  if (!actor.admin) return fail(403, "Only an admin can import listings.");
  const parsed =
    input.format === "csv"
      ? parseListingsCsv(input.text)
      : parseListingsJson(JSON.parse(input.text) as unknown);
  if (!parsed.ok) return fail(400, parsed.error);
  return writeListings(db, { userId: input.userId, listings: parsed.listings, now: input.now });
}

async function writeListings(
  db: Db,
  input: { userId: string; listings: Listing[]; now: Date },
): Promise<Ok<{ imported: ListingView[] }> | Fail> {
  const seen = new Set<string>();
  for (const listing of input.listings) {
    const id = listingRoomId(listing.name);
    if (!id) return fail(400, `Name the listing with letters or numbers.`);
    if (seen.has(id)) return fail(400, `${listing.name} is listed twice.`);
    seen.add(id);
  }
  try {
    const imported = await db.transaction(async (tx) => {
      const order = await tx.query<{ next: number }>(
        `select coalesce(max(sort_order), 0) as next from room`,
      );
      let sort = Number(order[0]?.next ?? 0);
      const saved: ListingView[] = [];
      for (const listing of input.listings) {
        sort += 1;
        const id = listingRoomId(listing.name);
        if (!id) throw new Error("missing id");
        await tx.query(
          `insert into room (
             id, name, what, takes, steward_takes, card_kinds, card_noun,
             requires_next_date, parish, sort_order, created_by, created_at,
             status, seeded_by, source_url, town_name, county, category
           ) values (
             $1, $2, '', $3, $4, $5, 'Meeting',
             false, false, $6, $7, $8,
             $9, $7, $10, $11, $12, $13
           )`,
          [
            id,
            listing.name,
            ["did", "asked", "hosted"],
            ["noted"],
            ["meeting"],
            sort,
            input.userId,
            input.now,
            listing.status,
            listing.sourceUrl,
            listing.town,
            listing.county,
            listing.category,
          ],
        );
        saved.push({
          id,
          name: listing.name,
          town: listing.town,
          county: listing.county,
          category: listing.category,
          sourceUrl: listing.sourceUrl,
          status: listing.status,
          createdAt: input.now.getTime(),
        });
      }
      return saved;
    });
    return { ok: true, value: { imported } };
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "That listing is already here.");
    throw error;
  }
}

async function findUnclaimed(
  db: Db,
  key: string,
): Promise<{ ok: true; room: RoomListing } | { ok: false; status: number; error: string }> {
  const id = key.trim().toLowerCase();
  if (ROOM_ID.test(id)) {
    const byId = await db.query<RoomListing>(
      `select id, name, status, town_name, county, category, source_url, what, host_user_id
       from room where id = $1 and status = 'unclaimed'`,
      [id],
    );
    if (byId[0]) return { ok: true, room: byId[0] };
  }
  const byName = await db.query<RoomListing>(
    `select id, name, status, town_name, county, category, source_url, what, host_user_id
     from room where status = 'unclaimed' and lower(name) = lower($1)`,
    [key.trim()],
  );
  if (byName.length > 1) return fail(409, "Name the listing more exactly.");
  if (!byName[0]) return fail(404, "That listing is not here.");
  return { ok: true, room: byName[0] };
}

export type ClaimDeps = MailDeps & {
  send?: (message: {
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  fetchPage?: (url: string) => Promise<{ ok: true; body: string } | { ok: false; error: string }>;
};

function claimMail(name: string, code: string): { subject: string; text: string } {
  return {
    subject: `Avouch: code to claim ${name}`,
    text: [
      `Someone asked to claim ${name} on Avouch.`,
      `The code is ${code}.`,
      "It expires in 24 hours.",
      "If you did not ask, ignore this message.",
    ].join("\n"),
  };
}

async function deliverCode(
  deps: ClaimDeps,
  input: { to: string; name: string; code: string; claimId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const message = claimMail(input.name, input.code);
  const mail = { ...message, to: input.to, idempotencyKey: `claim-code/${input.claimId}` };
  if (deps.send) return deps.send(mail);
  return sendTextEmail(mail, deps);
}

export async function requestClaim(
  db: Db,
  input: { userId: string; roomKey: string; method: string; email: string; now: Date },
  deps: ClaimDeps = {},
): Promise<Ok<{ claim: ClaimView }> | Fail> {
  if (!(await listingColumnsReady(db))) return fail(503, "Claims are not available yet.");
  await expireDue(db, input.now);
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can claim a listing.");
  if (!methodAllowed(input.method))
    return fail(400, "Choose a code on the site, an email on the domain, or a steward's review.");
  const name = await personName(db, input.userId);
  if (!name) return fail(403, "Only a member can claim a listing.");
  const found = await findUnclaimed(db, input.roomKey);
  if (!found.ok) return found;
  const room = found.room;
  const bar = await barredFrom(db, input.userId, input.now, room.id);
  if (bar) return bar;
  const evidence: Evidence = {};
  let plainCode = "";
  if (input.method === "domain_email") {
    const email = input.email.trim().toLowerCase();
    if (!validEmail(email)) return fail(400, "Enter an email address.");
    if (!emailOnOrgDomain(email, room.source_url)) {
      return fail(400, "That address is not on the organization's domain.");
    }
    const emailDomain = email.split("@")[1] ?? "";
    if (sharedClaimHost(hostOf(room.source_url)) || sharedClaimHost(emailDomain)) {
      return fail(400, SHARED_HOST);
    }
    plainCode = generateInviteCode();
    evidence.email = email;
    evidence.codeHash = hashCode(plainCode);
    evidence.codeExpiresAt = new Date(input.now.getTime() + CLAIM_CODE_MS).toISOString();
    evidence.verifiedAt = null;
  } else if (input.method === "site_code") {
    if (sharedClaimHost(hostOf(room.source_url))) return fail(400, SHARED_HOST);
    evidence.token = siteToken();
    evidence.verifiedAt = null;
    evidence.checkedBy = "";
  }
  const id = randomUUID();
  try {
    await db.query(
      `insert into claim_request (
         id, room_id, claimant, claimant_name, method, evidence, state, created_at, updated_at, expires_at
       ) values ($1, $2, $3, $4, $5, $6, 'pending', $7, $7, $8)`,
      [
        id,
        room.id,
        input.userId,
        name,
        input.method,
        JSON.stringify(evidence),
        input.now,
        new Date(input.now.getTime() + CLAIM_PENDING_MS),
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error))
      return fail(409, "You already have a claim open for that listing.");
    throw error;
  }
  if (input.method === "domain_email") {
    const sent = await deliverCode(deps, {
      to: evidence.email ?? "",
      name: room.name,
      code: plainCode,
      claimId: id,
    });
    if (!sent.ok) {
      await db.query(`delete from claim_request where id = $1`, [id]);
      console.log(
        JSON.stringify({
          event: "claim-mail-failed",
          claimId: id,
          roomId: room.id,
          message: sent.error,
        }),
      );
      return fail(503, "The code could not be sent.");
    }
  }
  const row = await loadClaim(db, id);
  const view = row ? toView(row, true, input.userId) : null;
  if (!view) return fail(500, "The claim was not saved.");
  return { ok: true, value: { claim: view } };
}

export async function confirmClaimCode(
  db: Db,
  input: { userId: string; claimId: string; code: string; now: Date },
): Promise<Ok<{ claim: ClaimView }> | Fail> {
  if (!(await listingColumnsReady(db))) return fail(503, "Claims are not available yet.");
  await expireDue(db, input.now);
  const row = await loadClaim(db, input.claimId);
  if (!row || row.claimant !== input.userId) return fail(404, "That claim is not here.");
  if (row.state !== "pending") return fail(400, "That claim is already decided.");
  if (row.method !== "domain_email") return fail(400, "This claim does not use an email code.");
  const bar = await barredFrom(db, input.userId, input.now, row.room_id);
  if (bar) return bar;
  const evidence = parseEvidence(row.evidence);
  const expires = evidence.codeExpiresAt ? new Date(evidence.codeExpiresAt).getTime() : 0;
  if (!evidence.codeHash || !expires || expires <= input.now.getTime()) {
    return fail(400, "That code has expired.");
  }
  if (hashCode(input.code) !== evidence.codeHash) {
    const attempts = (evidence.attempts ?? 0) + 1;
    evidence.attempts = attempts;
    if (attempts >= CLAIM_CODE_ATTEMPTS) {
      await db.query(
        `update claim_request
         set state = 'expired', evidence = $2, updated_at = $3, decided_at = $3
         where id = $1 and state = 'pending'`,
        [row.id, JSON.stringify(evidence), input.now],
      );
      console.log(JSON.stringify({ event: "claim-expired", claimId: row.id, roomId: row.room_id }));
      return fail(400, "That code was tried too many times. The claim has expired.");
    }
    await db.query(
      `update claim_request set evidence = $2, updated_at = $3 where id = $1 and state = 'pending'`,
      [row.id, JSON.stringify(evidence), input.now],
    );
    return fail(400, "That code does not match.");
  }
  evidence.verifiedAt = input.now.toISOString();
  await db.query(
    `update claim_request set evidence = $2, updated_at = $3 where id = $1 and state = 'pending'`,
    [row.id, JSON.stringify(evidence), input.now],
  );
  const saved = await loadClaim(db, row.id);
  const view = saved ? toView(saved, true, input.userId) : null;
  if (!view) return fail(500, "The claim was not saved.");
  return { ok: true, value: { claim: view } };
}

async function readPublicPage(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(4_000),
      headers: { accept: "text/html, text/plain" },
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, error: "The page did not show the code." };
    }
    if (!response.ok || !response.body)
      return { ok: false, error: "The page did not show the code." };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received <= PAGE_CAP) {
      const step = await reader.read();
      if (step.done) break;
      received += step.value.byteLength;
      if (received > PAGE_CAP) {
        await reader.cancel();
        return { ok: false, error: "The page did not show the code." };
      }
      chunks.push(step.value);
    }
    return { ok: true, body: new TextDecoder().decode(Buffer.concat(chunks)) };
  } catch {
    return { ok: false, error: "The page did not show the code." };
  }
}

export async function checkSiteCode(
  db: Db,
  input: { userId: string; claimId: string; now: Date },
  deps: ClaimDeps = {},
): Promise<Ok<{ claim: ClaimView }> | Fail> {
  if (!(await listingColumnsReady(db))) return fail(503, "Claims are not available yet.");
  await expireDue(db, input.now);
  const actor = await actorRole(db, input.userId);
  const row = await loadClaim(db, input.claimId);
  if (!row) return fail(404, "That claim is not here.");
  if (row.claimant && row.claimant === input.userId) return fail(403, OWN_CLAIM);
  if (!canSeeHiddenRooms(actor)) return fail(404, "That claim is not here.");
  if (!stewardsRoom(actor, row.room_id)) return fail(403, NOT_THIS_ROOM);
  const callerBar = await barredFrom(db, input.userId, input.now, row.room_id);
  if (callerBar) return callerBar;
  if (row.claimant) {
    const claimantBar = await barredFrom(db, row.claimant, input.now, row.room_id);
    if (claimantBar) return claimantBar;
  }
  if (row.state !== "pending" || row.method !== "site_code") {
    return fail(400, "This claim does not use a site code.");
  }
  const evidence = parseEvidence(row.evidence);
  if (!evidence.token) return fail(400, "This claim does not use a site code.");
  if (sharedClaimHost(hostOf(row.source_url))) return fail(400, SHARED_HOST);
  const read = deps.fetchPage ?? ((url: string) => readPublicPage(url, deps.fetch ?? fetch));
  const page = await read(row.source_url);
  if (!page.ok || !page.body.includes(evidence.token)) {
    return fail(400, "The page did not show the code.");
  }
  evidence.verifiedAt = input.now.toISOString();
  evidence.checkedBy = "server";
  await db.query(
    `update claim_request set evidence = $2, updated_at = $3 where id = $1 and state = 'pending'`,
    [row.id, JSON.stringify(evidence), input.now],
  );
  const saved = await loadClaim(db, row.id);
  const view = saved ? toView(saved, true, input.userId) : null;
  if (!view) return fail(500, "The claim was not saved.");
  return { ok: true, value: { claim: view } };
}

async function sharingTable(db: Db): Promise<boolean> {
  const rows = await db.query<{ name: string | null }>(
    `select to_regclass('public.public_gathering') as name`,
  );
  return Boolean(rows[0]?.name);
}

async function grantHost(
  tx: Db,
  input: {
    claimant: string;
    claimantName: string;
    roomId: string;
    reviewerName: string;
    now: Date;
  },
): Promise<void> {
  await tx.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'steward', $4, 'grant', $5, $5, $5, $6, $7)`,
    [
      randomUUID(),
      input.claimant,
      input.claimantName,
      input.roomId,
      input.reviewerName,
      HOST_NOTE,
      input.now,
    ],
  );
  await tx.query(
    `insert into room_member (room_id, user_id) values ($1, $2) on conflict do nothing`,
    [input.roomId, input.claimant],
  );
  await tx.query(
    `insert into room_join (user_id, room_id, joined_at) values ($1, $2, $3) on conflict do nothing`,
    [input.claimant, input.roomId, input.now],
  );
  if (await sharingTable(tx)) {
    await tx.query(
      `update public_gathering set shared = false, updated_at = $2 where room_id = $1 and shared = true`,
      [input.roomId, input.now],
    );
  }
}

export async function decideClaim(
  db: Db,
  input: { userId: string; claimId: string; decision: string; note: string; now: Date },
): Promise<Ok<{ claim: ClaimView }> | Fail> {
  if (!(await listingColumnsReady(db))) return fail(503, "Claims are not available yet.");
  await expireDue(db, input.now);
  const actor = await actorRole(db, input.userId);
  if (input.decision !== "approve" && input.decision !== "reject") {
    return fail(400, "Approve the claim or reject it.");
  }
  const reviewerName = (await personName(db, input.userId)) ?? "Steward";
  const row = await loadClaim(db, input.claimId);
  if (!row || row.state !== "pending") return fail(404, "That claim is not here.");
  if (!isMethod(row.method)) return fail(400, "That claim is not here.");
  if (!stewardsRoom(actor, row.room_id)) return fail(403, NOT_THIS_ROOM);
  if (row.claimant && row.claimant === input.userId) return fail(403, OWN_CLAIM);
  const evidence = parseEvidence(row.evidence);
  if (input.decision === "approve") {
    if (row.claimant) {
      const claimantBar = await barredFrom(db, row.claimant, input.now, row.room_id);
      if (claimantBar) return claimantBar;
    }
    if (row.method === "steward_review") {
      if (proofRequired(row.method, roleLevel(actor))) {
        return fail(
          403,
          "This claim needs a code on the site or an email on the organization's domain.",
        );
      }
    } else if (row.method === "site_code") {
      if (!evidence.verifiedAt || evidence.checkedBy !== "server") {
        return fail(400, "The code has not been checked yet.");
      }
    } else if (!evidence.verifiedAt) {
      return fail(400, "The code has not been checked yet.");
    }
  }
  const note = input.note.trim().slice(0, 200);
  if (note) evidence.decisionNote = note;
  try {
    const saved = await db.transaction(async (tx) => {
      if (input.decision === "approve" && row.claimant) {
        const again = await openBan(tx, row.claimant, input.now, row.room_id);
        if (again) throw new Error("claimant-barred");
      }
      const updated = await tx.query<{ id: string }>(
        `update claim_request
         set state = $2, reviewer = $3, evidence = $4, updated_at = $5, decided_at = $5
         where id = $1 and state = 'pending'
         returning id`,
        [
          row.id,
          input.decision === "approve" ? "approved" : "rejected",
          input.userId,
          JSON.stringify(evidence),
          input.now,
        ],
      );
      if (!updated[0]) return null;
      if (input.decision === "approve" && row.claimant) {
        const active = await tx.query<{ id: string }>(
          `update room set status = 'active', host_user_id = $2
           where id = $1 and status = 'unclaimed'
           returning id`,
          [row.room_id, row.claimant],
        );
        if (!active[0]) throw new Error("room-not-unclaimed");
        await grantHost(tx, {
          claimant: row.claimant,
          claimantName: row.claimant_name,
          roomId: row.room_id,
          reviewerName,
          now: input.now,
        });
        const others = await tx.query<{
          id: string;
          room_id: string;
          claimant: string | null;
          method: string;
        }>(
          `update claim_request
           set state = 'rejected', reviewer = $2, updated_at = $3, decided_at = $3
           where room_id = $1 and state = 'pending' and id <> $4
           returning id, room_id, claimant, method`,
          [row.room_id, input.userId, input.now, row.id],
        );
        for (const other of others) {
          console.log(
            JSON.stringify({
              event: "claim-rejected",
              claimId: other.id,
              roomId: other.room_id,
              reviewer: input.userId,
              claimant: other.claimant,
              method: other.method,
              note: "Another claim was approved.",
            }),
          );
        }
      }
      return true;
    });
    if (!saved) return fail(409, "That claim is already decided.");
  } catch (error) {
    if (error instanceof Error && error.message === "room-not-unclaimed") {
      return fail(409, "That listing is not open.");
    }
    if (error instanceof Error && error.message === "claimant-barred") {
      return fail(403, BARRED);
    }
    throw error;
  }
  const decided = await loadClaim(db, row.id);
  if (!decided) return fail(500, "The decision was not saved.");
  logDecision(
    input.decision === "approve" ? "claim-approved" : "claim-rejected",
    decided,
    input.userId,
  );
  const view = toView(decided, true, input.userId);
  if (!view) return fail(500, "The decision was not saved.");
  return { ok: true, value: { claim: view } };
}

export async function listClaims(
  db: Db,
  input: { userId: string; now: Date },
): Promise<
  | Ok<{
      methods: readonly ClaimMethod[];
      claims: ClaimView[];
      log: ClaimView[];
      listings: ListingView[];
    }>
  | Fail
> {
  if (!(await listingColumnsReady(db))) return fail(503, "Claims are not available yet.");
  await expireDue(db, input.now);
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can read claims.");
  const steward = canSeeHiddenRooms(actor);
  const rows = await db.query<ClaimRow>(
    steward
      ? `${CLAIM_SELECT} where c.state = 'pending' order by c.created_at asc, c.id asc`
      : `${CLAIM_SELECT} where c.claimant = $1 order by c.created_at asc, c.id asc`,
    steward ? [] : [input.userId],
  );
  const claims = rows.flatMap((row) => {
    const view = toView(row, true, input.userId);
    return view ? [view] : [];
  });
  if (!steward) {
    const open = await db.query<{
      id: string;
      name: string;
      town_name: string;
      county: string;
      category: string;
      source_url: string;
      status: string;
      created_at: Date | string;
    }>(
      `select id, name, town_name, county, category, source_url, status, created_at
       from room where status = 'unclaimed' and name <> ''
       order by created_at asc, id asc`,
    );
    return {
      ok: true,
      value: {
        methods: CLAIM_ALLOWED_METHODS,
        claims,
        log: [],
        listings: open.map((row) => ({
          id: row.id,
          name: row.name,
          town: row.town_name,
          county: row.county,
          category: row.category,
          sourceUrl: row.source_url,
          status: "unclaimed" as const,
          createdAt: atMs(row.created_at) ?? 0,
        })),
      },
    };
  }
  const logged = await db.query<ClaimRow>(
    `${CLAIM_SELECT} where c.state in ('rejected', 'expired', 'approved')
     order by c.decided_at desc nulls last, c.id desc
     limit 50`,
  );
  const listings = await db.query<{
    id: string;
    name: string;
    town_name: string;
    county: string;
    category: string;
    source_url: string;
    status: string;
    created_at: Date | string;
  }>(
    `select id, name, town_name, county, category, source_url, status, created_at
     from room where status in ('draft', 'unclaimed') and name <> ''
     order by created_at asc, id asc`,
  );
  return {
    ok: true,
    value: {
      methods: CLAIM_ALLOWED_METHODS,
      claims,
      log: logged.flatMap((row) => {
        const view = toView(row, true, input.userId);
        return view ? [view] : [];
      }),
      listings: listings.flatMap((row) => {
        if (row.status !== "draft" && row.status !== "unclaimed") return [];
        return [
          {
            id: row.id,
            name: row.name,
            town: row.town_name,
            county: row.county,
            category: row.category,
            sourceUrl: row.source_url,
            status: row.status,
            createdAt: atMs(row.created_at) ?? 0,
          },
        ];
      }),
    },
  };
}

export async function seededRoom(db: Db, id: string): Promise<RoomListing | null> {
  const rows = await db.query<RoomListing>(
    `select id, name, status, town_name, county, category, source_url, what, host_user_id
     from room where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Used by tests that advance the clock without a request. */
export async function expireClaims(db: Db, now: Date): Promise<void> {
  await expireDue(db, now);
}
