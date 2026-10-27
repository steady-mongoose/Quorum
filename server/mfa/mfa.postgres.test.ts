import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import pg from "pg";
import { createApp, type AppDeps } from "../http.ts";
import { pgDb, type Db } from "../db.ts";
import { CLIENT_IP_HEADER } from "../proxy.ts";
import { isNoTransaction, isSkipEmbedded, sqlStatements } from "../../scripts/migration-plan.mjs";
import { totpAt } from "./totp.ts";

const KEY = "ab".repeat(32);
const ROOT = process.env.MFA_TEST_DATABASE_URL ?? "postgres://avouch:secret@127.0.0.1:5432/avouch_test";
const DATABASE = "avouch_mfa_0023";
const ALONGSIDE = "avouch_mfa_0023_side";

let pool: pg.Pool | null = null;
let db: Db | null = null;
let skipped = false;

function assertClean(label: string, text: string, secrets: string[]) {
  for (const secret of secrets) {
    if (secret && text.includes(secret)) throw new Error(`${label} contained a secret`);
  }
}

async function applyFiles(client: pg.PoolClient, names: string[]) {
  const dir = new URL("../../migrations/", import.meta.url);
  for (const name of names) {
    const sql = await readFile(new URL(name, dir), "utf8");
    if (isSkipEmbedded(sql)) {
      for (const statement of sqlStatements(sql)) {
        try {
          await client.query(statement);
        } catch (error) {
          const duplicate =
            error && typeof error === "object" && "code" in error && error.code === "42710";
          if (!duplicate) throw error;
        }
      }
      continue;
    }
    if (isNoTransaction(sql)) {
      for (const statement of sqlStatements(sql)) await client.query(statement);
      continue;
    }
    await client.query(sql);
  }
}

async function migrationNames(): Promise<string[]> {
  const dir = new URL("../../migrations/", import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  return names;
}

async function createDatabase(name: string) {
  const admin = new pg.Pool({ connectionString: ROOT, max: 1 });
  try {
    await admin.query("select 1");
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [name],
    );
    await admin.query(`drop database if exists ${name}`);
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
}

function databaseUrl(name: string): string {
  const url = new URL(ROOT);
  url.pathname = `/${name}`;
  return url.toString();
}

async function connect(name: string): Promise<pg.Pool> {
  const next = new pg.Pool({ connectionString: databaseUrl(name), max: 4 });
  await next.query("select 1");
  return next;
}

before(async () => {
  process.env.MFA_SECRET_KEY = KEY;
  try {
    await createDatabase(DATABASE);
  } catch (error) {
    if (process.env.CI || process.env.MFA_POSTGRES_REQUIRED === "1") throw error;
    skipped = true;
    return;
  }
  const names = await migrationNames();
  const main = await connect(DATABASE);
  const client = await main.connect();
  try {
    await applyFiles(client, names);
  } finally {
    client.release();
  }
  pool = main;
  db = pgDb(main);

  await createDatabase(ALONGSIDE);
  const side = await connect(ALONGSIDE);
  const sideClient = await side.connect();
  try {
    const beforeMfa = names.filter((name) => name < "0023_mfa.sql");
    await applyFiles(sideClient, beforeMfa);
    await sideClient.query(`
      create table claim_request (id text primary key);
      create table categories (id text primary key);
      create table room_categories (room_id text, category_id text);
      create table member_active_days (user_id text, day date);
      create table stats_daily (day date primary key);
    `);
    await applyFiles(
      sideClient,
      names.filter((name) => name === "0023_mfa.sql"),
    );
    const tables = await sideClient.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and tablename like 'mfa_%' order by 1`,
    );
    assert.deepEqual(
      tables.rows.map((row) => row.tablename),
      [
        "mfa_assurance",
        "mfa_audit",
        "mfa_factor",
        "mfa_lock",
        "mfa_recovery_code",
        "mfa_reset",
        "mfa_reset_approval",
        "mfa_step_up",
      ],
    );
  } finally {
    sideClient.release();
    await side.end();
  }
});

after(async () => {
  if (pool) await pool.end();
  if (skipped) return;
  const admin = new pg.Pool({ connectionString: ROOT, max: 1 });
  try {
    for (const name of [DATABASE, ALONGSIDE]) {
      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
        [name],
      );
      await admin.query(`drop database if exists ${name}`);
    }
  } catch {
    // The suite already reported the setup error.
  } finally {
    await admin.end();
  }
});

function handler(clock: { now: Date }) {
  if (!db) throw new Error("Postgres is not connected.");
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => clock.now,
    createAccount: async () => ({ id: "unused" }),
    signIn: async () => ({ ok: false, status: 500, message: "unused" }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return {
        id,
        name: headers.get("x-user-name") ?? "Member",
        email: headers.get("x-user-email") ?? "member@example.com",
        sessionId: headers.get("x-session-id") ?? undefined,
      };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
  } satisfies AppDeps);
}

async function user(input: {
  name: string;
  email: string;
  admin?: boolean;
  owner?: boolean;
  stewardRoom?: string;
}) {
  if (!db) throw new Error("Postgres is not connected.");
  const id = randomUUID();
  const sessionId = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, input.name, input.email],
  );
  await db.query(
    `insert into "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
     values ($1, now() + interval '2 days', $2, now(), now(), $3)`,
    [sessionId, randomUUID(), id],
  );
  if (input.admin || input.owner || input.stewardRoom) {
    await db.query(
      `insert into access_log
        (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
       values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
      [randomUUID(), id, input.name],
    );
  }
  if (input.admin) {
    await db.query(
      `insert into member_role (user_id, is_admin) values ($1, true)
       on conflict (user_id) do update set is_admin = true`,
      [id],
    );
  }
  if (input.owner) {
    await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', $1)`, [id]);
  }
  if (input.stewardRoom) {
    await db.query(
      `insert into access_log
        (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
       values ($1, $2, $3, 'steward', $4, 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
      [randomUUID(), id, input.name, input.stewardRoom],
    );
  }
  return { id, sessionId, email: input.email, name: input.name };
}

function headers(person: { id: string; sessionId: string; email: string; name: string }, ip: string) {
  return {
    "content-type": "application/json",
    [CLIENT_IP_HEADER]: ip,
    "x-user-id": person.id,
    "x-session-id": person.sessionId,
    "x-user-email": person.email,
    "x-user-name": person.name,
  };
}

async function enroll(app: ReturnType<typeof handler>, person: { id: string; sessionId: string; email: string; name: string }, clock: { now: Date }, ip: string) {
  if (!db) throw new Error("Postgres is not connected.");
  const started = await app(
    new Request("http://127.0.0.1:8787/api/mfa/enroll/start", {
      method: "POST",
      headers: headers(person, ip),
      body: JSON.stringify({ kind: "totp" }),
    }),
  );
  assert.equal(started.status, 200);
  const startBody = (await started.json()) as { secret: string; otpauth: string; modules: number[][] };
  const rows = await db.query<{ secret_ciphertext: string }>(
    `select secret_ciphertext from mfa_factor where user_id = $1 and status = 'pending'`,
    [person.id],
  );
  const { openSecret } = await import("./secret.ts");
  const sealed = await db.query<{ secret_ciphertext: string; secret_iv: string; key_id: string }>(
    `select secret_ciphertext, secret_iv, key_id from mfa_factor where user_id = $1 and status = 'pending'`,
    [person.id],
  );
  const plain = openSecret({
    ciphertext: sealed[0]!.secret_ciphertext,
    iv: sealed[0]!.secret_iv,
    keyId: sealed[0]!.key_id,
  });
  assert.ok(plain);
  const liveCode = totpAt(plain!, clock.now.getTime());
  assert.match(startBody.secret, /^[A-Z2-7]+$/);
  assert.equal(startBody.secret.includes(sealed[0]!.secret_ciphertext), false);
  const confirmed = await app(
    new Request("http://127.0.0.1:8787/api/mfa/enroll/confirm", {
      method: "POST",
      headers: headers(person, ip),
      body: JSON.stringify({ code: liveCode }),
    }),
  );
  const confirmBody = (await confirmed.json()) as { recoveryCodes?: string[]; error?: string };
  assert.equal(confirmed.status, 200, JSON.stringify(confirmBody));
  return {
    secret: startBody.secret,
    otpauth: startBody.otpauth,
    modules: startBody.modules,
    recoveryCodes: confirmBody.recoveryCodes ?? [],
    ciphertext: rows[0]?.secret_ciphertext ?? "",
    plain: plain!,
  };
}

test("required roles, replay, lockout, reset, and recovery on Postgres", async (t) => {
  if (skipped || !db) {
    t.skip("Set MFA_TEST_DATABASE_URL to run authenticator tests on Postgres.");
    return;
  }
  const database = db;
  const clock = { now: new Date("2026-10-26T18:00:00Z") };
  const app = handler(clock);
  const logs: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((method) => console[method]);
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      logs.push(args.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" "));
    };
  }
  try {
    const member = await user({ name: "Ada", email: "ada@example.com" });
    const steward = await user({
      name: "Tom",
      email: "tom@example.com",
      stewardRoom: "shop",
    });
    const blocked = await app(
      new Request("http://127.0.0.1:8787/api/access", {
        method: "POST",
        headers: headers(steward, "203.0.113.10"),
        body: JSON.stringify({ action: "grant-member", email: "ada@example.com" }),
      }),
    );
    const blockedBody = (await blocked.json()) as { error?: string; step?: string };
    assert.equal(blocked.status, 403);
    assert.equal(blockedBody.error, "mfa_required");
    assert.equal(blockedBody.step, "enroll");

    const memberAccess = await app(
      new Request("http://127.0.0.1:8787/api/access", {
        method: "POST",
        headers: headers(member, "203.0.113.11"),
        body: JSON.stringify({ action: "grant-member", email: "tom@example.com" }),
      }),
    );
    const memberBody = (await memberAccess.json()) as { error?: string };
    assert.notEqual(memberBody.error, "mfa_required");

    const passkey = await app(
      new Request("http://127.0.0.1:8787/api/mfa/enroll/start", {
        method: "POST",
        headers: headers(member, "203.0.113.11"),
        body: JSON.stringify({ kind: "passkey" }),
      }),
    );
    assert.equal(passkey.status, 501);

    const enrolled = await enroll(app, steward, clock, "203.0.113.12");
    assert.equal(enrolled.modules.length > 20, true);
    assert.equal(enrolled.recoveryCodes.length, 10);
    assertClean("enroll log", logs.join("\n"), [enrolled.secret, KEY, ...enrolled.recoveryCodes, enrolled.ciphertext]);

    const replay = await app(
      new Request("http://127.0.0.1:8787/api/mfa/step-up", {
        method: "POST",
        headers: headers(steward, "203.0.113.12"),
        body: JSON.stringify({ action: "role-grant", code: totpAt(enrolled.plain, clock.now.getTime()) }),
      }),
    );
    const replayBody = (await replay.json()) as { error?: string };
    assert.equal(replay.status, 401);
    assert.equal(replayBody.error, "mfa_replay");

    const needsStep = await app(
      new Request("http://127.0.0.1:8787/api/access", {
        method: "POST",
        headers: headers(steward, "203.0.113.13"),
        body: JSON.stringify({ action: "grant-member", email: "ada@example.com" }),
      }),
    );
    const stepBody = (await needsStep.json()) as { error?: string; action?: string };
    assert.equal(needsStep.status, 403);
    assert.equal(stepBody.error, "mfa_step_up");
    assert.equal(stepBody.action, "role-grant");

    clock.now = new Date(clock.now.getTime() + 30_000);
    const stepped = await app(
      new Request("http://127.0.0.1:8787/api/mfa/step-up", {
        method: "POST",
        headers: headers(steward, "203.0.113.13"),
        body: JSON.stringify({ action: "role-grant", code: totpAt(enrolled.plain, clock.now.getTime()) }),
      }),
    );
    assert.equal(stepped.status, 200);
    const granted = await app(
      new Request("http://127.0.0.1:8787/api/access", {
        method: "POST",
        headers: headers(steward, "203.0.113.13"),
        body: JSON.stringify({ action: "grant-member", email: "ada@example.com" }),
      }),
    );
    const grantedBody = (await granted.json()) as { error?: string };
    assert.notEqual(grantedBody.error, "mfa_required");
    assert.notEqual(grantedBody.error, "mfa_step_up");

    const claim = await app(
      new Request("http://127.0.0.1:8787/api/claims/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/decide", {
        method: "POST",
        headers: headers(steward, "203.0.113.14"),
        body: "{}",
      }),
    );
    const claimBody = (await claim.json()) as { error?: string; action?: string };
    assert.equal(claim.status, 403);
    assert.equal(claimBody.error, "mfa_step_up");
    assert.equal(claimBody.action, "claim-approval");

    const fresh = await user({ name: "Ned", email: "ned@example.com" });
    const ned = await enroll(app, fresh, clock, "203.0.113.20");
    for (let n = 0; n < 4; n += 1) {
      const bad = await app(
        new Request("http://127.0.0.1:8787/api/mfa/challenge", {
          method: "POST",
          headers: headers(fresh, "203.0.113.21"),
          body: JSON.stringify({ code: "000000" }),
        }),
      );
      assert.equal(bad.status, 401);
    }
    const fifth = await app(
      new Request("http://127.0.0.1:8787/api/mfa/challenge", {
        method: "POST",
        headers: headers(fresh, "203.0.113.21"),
        body: JSON.stringify({ code: "000000" }),
      }),
    );
    assert.equal(fifth.status, 429);
    assert.equal(((await fifth.json()) as { error?: string }).error, "mfa_locked");
    const locked = await app(
      new Request("http://127.0.0.1:8787/api/mfa/challenge", {
        method: "POST",
        headers: headers(fresh, "203.0.113.21"),
        body: JSON.stringify({ code: totpAt(ned.plain, clock.now.getTime()) }),
      }),
    );
    const lockedBody = (await locked.json()) as { error?: string };
    assert.equal(locked.status, 429);
    assert.equal(lockedBody.error, "mfa_locked");
    clock.now = new Date(clock.now.getTime() + 16 * 60 * 1000);
    const unlocked = await app(
      new Request("http://127.0.0.1:8787/api/mfa/challenge", {
        method: "POST",
        headers: headers(fresh, "203.0.113.22"),
        body: JSON.stringify({ code: totpAt(ned.plain, clock.now.getTime()) }),
      }),
    );
    assert.equal(unlocked.status, 200);

    const rated = await user({ name: "Bea", email: "bea@example.com" });
    await enroll(app, rated, clock, "203.0.113.30");
    await database.query(`delete from "rateLimit" where "key" like $1`, [`mfa:%${rated.id}%`]);
    for (let n = 0; n < 10; n += 1) {
      await database.query(`delete from mfa_lock where user_id = $1`, [rated.id]);
      const bad = await app(
        new Request("http://127.0.0.1:8787/api/mfa/challenge", {
          method: "POST",
          headers: headers(rated, "203.0.113.31"),
          body: JSON.stringify({ code: "111111" }),
        }),
      );
      assert.equal(bad.status, 401);
    }
    const rate = await app(
      new Request("http://127.0.0.1:8787/api/mfa/challenge", {
        method: "POST",
        headers: headers(rated, "203.0.113.31"),
        body: JSON.stringify({ code: "111111" }),
      }),
    );
    assert.equal(rate.status, 429);
    assert.equal(((await rate.json()) as { error?: string }).error, "mfa_rate");

    const owner = await user({ name: "Josh", email: "josh@example.com", owner: true });
    const adminA = await user({ name: "Ida", email: "ida@example.com", admin: true });
    const adminB = await user({ name: "Ruth", email: "ruth@example.com", admin: true });
    const subject = await user({ name: "Owen", email: "owen@example.com", admin: true });
    const ownerMfa = await enroll(app, owner, clock, "203.0.113.40");
    const adminAMfa = await enroll(app, adminA, clock, "203.0.113.41");
    const adminBMfa = await enroll(app, adminB, clock, "203.0.113.42");
    const subjectMfa = await enroll(app, subject, clock, "203.0.113.43");
    const asked = await app(
      new Request("http://127.0.0.1:8787/api/mfa/reset/request", {
        method: "POST",
        headers: headers(subject, "203.0.113.43"),
        body: JSON.stringify({}),
      }),
    );
    assert.equal(asked.status, 200);
    const resetId = ((await asked.json()) as { id: string }).id;

    async function approve(person: typeof owner, plain: Buffer, ip: string) {
      clock.now = new Date(clock.now.getTime() + 30_000);
      const up = await app(
        new Request("http://127.0.0.1:8787/api/mfa/step-up", {
          method: "POST",
          headers: headers(person, ip),
          body: JSON.stringify({ action: "mfa-reset", code: totpAt(plain, clock.now.getTime()) }),
        }),
      );
      assert.equal(up.status, 200, await up.clone().text());
      return app(
        new Request(`http://127.0.0.1:8787/api/mfa/reset/${resetId}/approve`, {
          method: "POST",
          headers: headers(person, ip),
          body: "{}",
        }),
      );
    }

    const self = await approve(subject, subjectMfa.plain, "203.0.113.44");
    assert.equal(self.status, 403);
    assert.equal(((await self.json()) as { error?: string }).error, "mfa_reset_self");

    const once = await approve(adminA, adminAMfa.plain, "203.0.113.45");
    assert.equal(once.status, 200);
    assert.equal(((await once.json()) as { completed?: boolean }).completed, false);
    const named = await app(
      new Request("http://127.0.0.1:8787/api/mfa/reset", {
        headers: headers(owner, "203.0.113.47"),
      }),
    );
    const namedText = await named.text();
    assert.equal(named.status, 200);
    const namedBody = JSON.parse(namedText) as {
      resets: { approvals: { approverName?: string }[] }[];
    };
    const approverNames = namedBody.resets.flatMap((row) => row.approvals.map((item) => item.approverName));
    assert.equal(approverNames.includes("Ida"), true);
    assertClean("named queue", namedText, [subjectMfa.secret, adminAMfa.secret, KEY]);
    const twice = await approve(adminA, adminAMfa.plain, "203.0.113.45");
    assert.equal(twice.status, 403);
    assert.equal(((await twice.json()) as { error?: string }).error, "mfa_reset_repeat");
    const done = await approve(adminB, adminBMfa.plain, "203.0.113.46");
    const doneBody = (await done.json()) as { completed?: boolean; error?: string };
    assert.equal(done.status, 200, JSON.stringify(doneBody));
    assert.equal(doneBody.completed, true);
    const factor = await database.query<{ status: string; secret_ciphertext: string }>(
      `select status, secret_ciphertext from mfa_factor where user_id = $1`,
      [subject.id],
    );
    assert.equal(factor[0]?.status, "disabled");
    assert.equal(factor[0]?.secret_ciphertext, "");

    const other = await user({ name: "Leah", email: "leah@example.com" });
    await enroll(app, other, clock, "203.0.113.50");
    const requested = await app(
      new Request("http://127.0.0.1:8787/api/mfa/reset/request", {
        method: "POST",
        headers: headers(adminA, "203.0.113.51"),
        body: JSON.stringify({ userId: other.id }),
      }),
    );
    assert.equal(requested.status, 200);
    const otherId = ((await requested.json()) as { id: string }).id;
    clock.now = new Date(clock.now.getTime() + 30_000);
    const up = await app(
      new Request("http://127.0.0.1:8787/api/mfa/step-up", {
        method: "POST",
        headers: headers(adminA, "203.0.113.51"),
        body: JSON.stringify({ action: "mfa-reset", code: totpAt(adminAMfa.plain, clock.now.getTime()) }),
      }),
    );
    assert.equal(up.status, 200);
    const requester = await app(
      new Request(`http://127.0.0.1:8787/api/mfa/reset/${otherId}/approve`, {
        method: "POST",
        headers: headers(adminA, "203.0.113.51"),
        body: "{}",
      }),
    );
    assert.equal(requester.status, 403);
    assert.equal(((await requester.json()) as { error?: string }).error, "mfa_reset_requester");

    const queue = await app(
      new Request("http://127.0.0.1:8787/api/mfa/reset", {
        headers: headers(owner, "203.0.113.52"),
      }),
    );
    const queueText = await queue.text();
    assert.equal(queue.status, 200);
    assertClean("reset queue", queueText, [subjectMfa.secret, other ? "" : "", KEY]);

    const recoverUser = await user({ name: "Paul", email: "paul@example.com" });
    const paul = await enroll(app, recoverUser, clock, "203.0.113.60");
    await database.query(`update mfa_assurance set verified_at = null where user_id = $1`, [recoverUser.id]);
    const firstCode = paul.recoveryCodes[0]!;
    const secondCode = paul.recoveryCodes[1]!;
    const used = await app(
      new Request("http://127.0.0.1:8787/api/mfa/challenge", {
        method: "POST",
        headers: headers(recoverUser, "203.0.113.61"),
        body: JSON.stringify({ code: firstCode }),
      }),
    );
    assert.equal(used.status, 200);
    await database.query(`update mfa_assurance set verified_at = null where user_id = $1`, [recoverUser.id]);
    const again = await app(
      new Request("http://127.0.0.1:8787/api/mfa/challenge", {
        method: "POST",
        headers: headers(recoverUser, "203.0.113.62"),
        body: JSON.stringify({ code: firstCode }),
      }),
    );
    assert.equal(again.status, 401);
    const nextCode = await app(
      new Request("http://127.0.0.1:8787/api/mfa/challenge", {
        method: "POST",
        headers: headers(recoverUser, "203.0.113.63"),
        body: JSON.stringify({ code: secondCode }),
      }),
    );
    assert.equal(nextCode.status, 200);
    const spent = await database.query<{ n: string }>(
      `select count(*) as n from mfa_recovery_code where user_id = $1 and used_at is not null`,
      [recoverUser.id],
    );
    assert.equal(Number(spent[0]?.n), 2);

    clock.now = new Date(clock.now.getTime() + 30_000);
    const turnedOff = await app(
      new Request("http://127.0.0.1:8787/api/mfa/disable", {
        method: "POST",
        headers: headers(recoverUser, "203.0.113.64"),
        body: JSON.stringify({ code: totpAt(paul.plain, clock.now.getTime()) }),
      }),
    );
    assert.equal(turnedOff.status, 200, await turnedOff.clone().text());
    const wiped = await database.query<{ secret_ciphertext: string; status: string }>(
      `select secret_ciphertext, status from mfa_factor where user_id = $1`,
      [recoverUser.id],
    );
    assert.equal(wiped[0]?.status, "disabled");
    assert.equal(wiped[0]?.secret_ciphertext, "");

    const status = await app(
      new Request("http://127.0.0.1:8787/api/mfa/status", { headers: headers(steward, "203.0.113.70") }),
    );
    const statusText = await status.text();
    const exportResponse = await app(
      new Request("http://127.0.0.1:8787/api/admin/export", { headers: headers(member, "203.0.113.71") }),
    );
    const exportText = await exportResponse.text();
    const hashes = await database.query<{ code_hash: string }>(
      `select code_hash from mfa_recovery_code where user_id = $1`,
      [steward.id],
    );
    assertClean("status", statusText, [enrolled.secret, KEY, enrolled.ciphertext, ...enrolled.recoveryCodes]);
    assertClean("export", exportText, [enrolled.secret, KEY, ...paul.recoveryCodes]);
    for (const row of hashes) assertClean("status hash", statusText, [row.code_hash]);
    assert.equal(logs.join("\n").includes(KEY), false);
    assert.equal(ownerMfa.secret.length > 0, true);

    const actions = await database.query<{ action: string }>(
      `select distinct action from mfa_audit order by action`,
    );
    const found = actions.map((row) => row.action);
    for (const action of ["enroll", "disable", "recovery-use", "reset-request", "reset-approve", "reset-complete"]) {
      assert.equal(found.includes(action), true, action);
    }
  } finally {
    methods.forEach((method, index) => {
      console[method] = originals[index]!;
    });
  }
});

async function secondSession(person: { id: string; sessionId: string; email: string; name: string }) {
  if (!db) throw new Error("Postgres is not connected.");
  const sessionId = randomUUID();
  await db.query(
    `insert into "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
     values ($1, now() + interval '2 days', $2, now(), now(), $3)`,
    [sessionId, randomUUID(), person.id],
  );
  return { ...person, sessionId };
}

test("a password-only session cannot reach DMs, invites, or account settings", async (t) => {
  if (skipped || !db) {
    t.skip("Set MFA_TEST_DATABASE_URL to run authenticator tests on Postgres.");
    return;
  }
  const clock = { now: new Date("2026-10-27T18:00:00Z") };
  const app = handler(clock);
  const admin = await user({ name: "Gate Admin", email: "gate-admin@example.com", admin: true });
  await enroll(app, admin, clock, "198.51.100.1");
  const halfway = await secondSession(admin);
  const gated: Array<[string, string]> = [
    ["GET", "/api/dm/threads"],
    ["GET", "/api/dm/devices"],
    ["GET", "/api/dm/peers"],
    ["POST", "/api/dm/devices"],
    ["GET", "/api/dm/backup"],
    ["POST", "/api/invites"],
    ["GET", "/api/invite-log"],
    ["POST", "/api/auth/change-password"],
    ["POST", "/api/auth/change-email"],
    ["GET", "/api/auth/list-sessions"],
    ["POST", "/api/auth/revoke-sessions"],
    ["GET", "/api/board"],
  ];
  for (const [method, path] of gated) {
    const response = await app(
      new Request(`http://127.0.0.1:8787${path}`, {
        method,
        headers: headers(halfway, "198.51.100.2"),
        ...(method === "GET" ? {} : { body: "{}" }),
      }),
    );
    const body = (await response.json()) as { error?: string; step?: string };
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.equal(body.error, "mfa_required", `${method} ${path}`);
    assert.equal(body.step, "challenge", `${method} ${path}`);
  }
  // Exempt: the session read, sign-out and the second step itself.
  for (const [method, path] of [
    ["GET", "/api/auth/get-session"],
    ["POST", "/api/auth/sign-out"],
    ["GET", "/api/mfa/status"],
  ] as const) {
    const response = await app(
      new Request(`http://127.0.0.1:8787${path}`, {
        method,
        headers: headers(halfway, "198.51.100.3"),
        ...(method === "GET" ? {} : { body: "{}" }),
      }),
    );
    assert.notEqual(response.status, 403, `${method} ${path}`);
  }
});

test("an unenrolled admin or steward is refused on every non-member route", async (t) => {
  if (skipped || !db) {
    t.skip("Set MFA_TEST_DATABASE_URL to run authenticator tests on Postgres.");
    return;
  }
  const clock = { now: new Date("2026-10-27T19:00:00Z") };
  const app = handler(clock);
  const admin = await user({ name: "Plain Admin", email: "plain-admin@example.com", admin: true });
  const steward = await user({ name: "Plain Steward", email: "plain-steward@example.com", stewardRoom: "shop" });
  const routes: Array<[string, string]> = [
    ["DELETE", "/api/gatherings/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
    ["POST", "/api/groups/carpentry/admins"],
    ["POST", "/api/group-requests/abc"],
    ["POST", "/api/group-appeals/abc"],
    ["POST", "/api/zips"],
    ["GET", "/api/appeals"],
    ["GET", "/api/group-appeals"],
    ["GET", "/api/group-requests"],
    ["GET", "/api/admin/stats"],
    ["PATCH", "/api/rooms/shop"],
  ];
  for (const person of [admin, steward]) {
    for (const [method, path] of routes) {
      const response = await app(
        new Request(`http://127.0.0.1:8787${path}`, {
          method,
          headers: headers(person, "198.51.100.10"),
          ...(method === "GET" ? {} : { body: "{}" }),
        }),
      );
      const body = (await response.json()) as { error?: string; step?: string };
      assert.equal(response.status, 403, `${person.name} ${method} ${path}`);
      assert.equal(body.error, "mfa_required", `${person.name} ${method} ${path}`);
      assert.equal(body.step, "enroll");
    }
  }
  // A plain member route still works for them, so the app can show the enroll prompt.
  const board = await app(
    new Request("http://127.0.0.1:8787/api/board", { headers: headers(steward, "198.51.100.11") }),
  );
  assert.equal(board.status, 200);
});

test("parallel wrong codes cannot beat the five-try lock", async (t) => {
  if (skipped || !db) {
    t.skip("Set MFA_TEST_DATABASE_URL to run authenticator tests on Postgres.");
    return;
  }
  const database = db;
  const clock = { now: new Date("2026-10-27T20:00:00Z") };
  const app = handler(clock);
  const person = await user({ name: "Racer", email: "racer@example.com" });
  const enrolled = await enroll(app, person, clock, "198.51.100.20");
  const halfway = await secondSession(person);
  const statuses: number[] = [];
  const burst = Array.from({ length: 12 }, (_, n) =>
    app(
      new Request("http://127.0.0.1:8787/api/mfa/challenge", {
        method: "POST",
        // Spread over IPs so only the per-account lock is under test.
        headers: headers(halfway, `198.51.100.${30 + n}`),
        body: JSON.stringify({ code: "000000" }),
      }),
    ).then(async (response) => {
      statuses.push(response.status);
      await response.text();
    }),
  );
  await Promise.all(burst);
  const lock = await database.query<{ fail_count: number; locked_until: Date | null }>(
    `select fail_count, locked_until from mfa_lock where user_id = $1`,
    [person.id],
  );
  assert.ok(lock[0]?.locked_until, "the account is locked");
  assert.ok(Number(lock[0]!.fail_count) >= 5);
  // At most five codes were graded; the rest were refused as locked.
  assert.ok(statuses.filter((status) => status !== 429).length <= 5, statuses.join(","));
  const right = await app(
    new Request("http://127.0.0.1:8787/api/mfa/challenge", {
      method: "POST",
      headers: headers(halfway, "198.51.100.99"),
      body: JSON.stringify({ code: totpAt(enrolled.plain, clock.now.getTime()) }),
    }),
  );
  assert.equal(right.status, 429);
});
