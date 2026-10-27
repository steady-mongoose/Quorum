import { openBan } from "../board/store.ts";
import { closeDmReport, fileDmReport, listDmReports } from "./reports.ts";
import type { AppDeps } from "../http.ts";
import {
  DM_BUNDLE_LIMIT,
  DM_BUNDLE_TARGET_LIMIT,
  DM_REPORT_LIMIT,
  DM_SEND_LIMIT,
  consumeLimit,
} from "../rate-limit.ts";
import {
  addPrekeys,
  claimBundle,
  getBackup,
  listPeers,
  previewBundle,
  listMessages,
  listOwnDevices,
  listThreads,
  lookupMembers,
  openThread,
  postMessage,
  putBackup,
  recordAttendance,
  registerDevice,
  revokeDevice,
  sweepIfDue,
  type DeviceRegistration,
} from "./store.ts";
import type {
  BackupCipher,
  EnvelopeWire,
  MessageWire,
  PublicPrekey,
} from "../../src/lib/e2ee/protocol.ts";

function json(status: number, body: unknown, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > 65_536) {
    return Promise.reject(Object.assign(new Error("That request is too large."), { status: 413 }));
  }
  const text = await request.text();
  if (text.length > 65_536) {
    return Promise.reject(Object.assign(new Error("That request is too large."), { status: 413 }));
  }
  if (!text) return {};
  const body = JSON.parse(text) as unknown;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Promise.reject(Object.assign(new Error("Send a JSON object."), { status: 400 }));
  }
  return body as Record<string, unknown>;
}

function tooMany(retryAfter: number): Response {
  return json(
    429,
    { error: "Too many attempts. Wait and try again." },
    new Headers({ "retry-after": String(retryAfter) }),
  );
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function prekeysOf(value: unknown): PublicPrekey[] | null {
  if (!Array.isArray(value)) return null;
  const prekeys: PublicPrekey[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.publicKey !== "string" ||
      typeof row.signature !== "string"
    ) {
      return null;
    }
    prekeys.push({ id: row.id, publicKey: row.publicKey, signature: row.signature });
  }
  return prekeys;
}

function registrationOf(body: Record<string, unknown>): DeviceRegistration | null {
  const prekeys = prekeysOf(body.prekeys);
  if (!prekeys) return null;
  return {
    deviceId: stringField(body, "deviceId"),
    label: stringField(body, "label"),
    signPublic: stringField(body, "signPublic"),
    boxPublic: stringField(body, "boxPublic"),
    statementSig: stringField(body, "statementSig"),
    identityPublic: stringField(body, "identityPublic"),
    identitySig: stringField(body, "identitySig"),
    signedPrekey: {
      id: stringField(signedPrekey(body), "id"),
      publicKey: stringField(signedPrekey(body), "publicKey"),
      signature: stringField(signedPrekey(body), "signature"),
    },
    prekeys,
  };
}

function signedPrekey(body: Record<string, unknown>): Record<string, unknown> {
  const value = body.signedPrekey;
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function messageOf(body: Record<string, unknown>): MessageWire | null {
  if ("text" in body || "plaintext" in body || "plainText" in body) return null;
  if (!Array.isArray(body.envelopes)) return null;
  const envelopes: EnvelopeWire[] = [];
  for (const item of body.envelopes) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.nonce !== "string" ||
      typeof row.ciphertext !== "string" ||
      typeof row.ephemeralPublic !== "string"
    ) {
      return null;
    }
    envelopes.push({
      recipientDeviceId: typeof row.recipientDeviceId === "string" ? row.recipientDeviceId : null,
      recipientUserBackup:
        typeof row.recipientUserBackup === "string" ? row.recipientUserBackup : null,
      nonce: row.nonce,
      ciphertext: row.ciphertext,
      ephemeralPublic: row.ephemeralPublic,
      prekeyId: typeof row.prekeyId === "string" ? row.prekeyId : null,
      signedPrekeyId: typeof row.signedPrekeyId === "string" ? row.signedPrekeyId : null,
    });
  }
  if (
    typeof body.messageId !== "string" ||
    typeof body.threadId !== "string" ||
    typeof body.senderDeviceId !== "string" ||
    typeof body.bodyNonce !== "string" ||
    typeof body.bodyCiphertext !== "string" ||
    typeof body.bodySig !== "string"
  ) {
    return null;
  }
  return {
    messageId: body.messageId,
    threadId: body.threadId,
    senderDeviceId: body.senderDeviceId,
    bodyNonce: body.bodyNonce,
    bodyCiphertext: body.bodyCiphertext,
    bodySig: body.bodySig,
    envelopes,
  };
}

function backupOf(
  body: Record<string, unknown>,
): { boxPublic: string; record: BackupCipher } | null {
  if (body.kdf !== "argon2id") return null;
  if (typeof body.boxPublic !== "string" || typeof body.salt !== "string") return null;
  if (typeof body.nonce !== "string" || typeof body.ciphertext !== "string") return null;
  if (typeof body.opslimit !== "number" || typeof body.memlimit !== "number") return null;
  return {
    boxPublic: body.boxPublic,
    record: {
      kdf: "argon2id",
      opslimit: body.opslimit,
      memlimit: body.memlimit,
      salt: body.salt,
      nonce: body.nonce,
      ciphertext: body.ciphertext,
    },
  };
}

export const ADMIN_DM_REPORTS = "/api/admin/dm-reports";

/**
 * Private-message routes. Returns null when the path is not under /api/dm,
 * so the rest of the API can keep going.
 */
export async function handleDm(
  deps: AppDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/dm") && !url.pathname.startsWith(ADMIN_DM_REPORTS)) return null;
  const session = await deps.readSession(request.headers);
  if (!session) return json(401, { error: "Sign in first." });
  const ban = await openBan(deps.db, session.id, deps.now());
  if (ban) return json(403, { error: "banned", ban });
  try {
    await sweepIfDue(deps.db, deps.now());
    return await dispatch(deps, request, url, session.id);
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error ? Number(error.status) : 400;
    if (error instanceof SyntaxError) return json(400, { error: "Send JSON." });
    const message = error instanceof Error ? error.message : "Send JSON.";
    if (status === 413 || status === 400) return json(status, { error: message });
    throw error;
  }
}

async function dispatch(
  deps: AppDeps,
  request: Request,
  url: URL,
  userId: string,
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  const reportOne = path.match(/^\/api\/dm\/messages\/([^/]+)\/report$/);
  if (reportOne && method === "POST") {
    const limit = await consumeLimit(deps.db, `dm-report:${userId}`, DM_REPORT_LIMIT, deps.now().getTime());
    if (!limit.allowed) return tooMany(limit.retryAfter);
    const body = await readJson(request);
    const saved = await fileDmReport(deps.db, {
      userId,
      messageId: decodeURIComponent(reportOne[1]),
      reason: body.reason,
      note: body.note,
      sharedText: body.sharedText,
      now: deps.now(),
    });
    if (!saved.ok) return json(saved.status, { error: saved.error });
    return json(201, saved.value);
  }
  // The admin queue lives under /api/admin so the member /api/dm wildcard in the
  // MFA policy never covers it: an admin needs an authenticator to use it.
  if (path === ADMIN_DM_REPORTS && method === "GET") {
    const listed = await listDmReports(deps.db, { userId, now: deps.now() });
    if (!listed.ok) return json(listed.status, { error: listed.error });
    return json(200, { reports: listed.value });
  }
  const closeOne = path.match(/^\/api\/admin\/dm-reports\/([^/]+)\/close$/);
  if (closeOne && method === "POST") {
    const body = await readJson(request);
    const closed = await closeDmReport(deps.db, {
      userId,
      reportId: decodeURIComponent(closeOne[1]),
      resolution: body.resolution,
      now: deps.now(),
    });
    if (!closed.ok) return json(closed.status, { error: closed.error });
    return json(200, { ok: true });
  }

  if (path === "/api/dm/devices" && method === "GET") {
    return json(200, { devices: await listOwnDevices(deps.db, userId) });
  }
  if (path === "/api/dm/devices" && method === "POST") {
    const body = registrationOf(await readJson(request));
    if (!body) return json(400, { error: "That device key was not accepted." });
    const saved = await registerDevice(deps.db, userId, body);
    if (!saved.ok) return json(saved.status, { error: saved.error });
    return json(201, saved.value);
  }

  const deviceAction = path.match(/^\/api\/dm\/devices\/([^/]+)\/(revoke|prekeys)$/);
  if (deviceAction && method === "POST") {
    const deviceId = decodeURIComponent(deviceAction[1]);
    if (deviceAction[2] === "revoke") {
      const revoked = await revokeDevice(deps.db, userId, deviceId, deps.now());
      if (!revoked.ok) return json(revoked.status, { error: revoked.error });
      return json(200, { ok: true });
    }
    const raw = await readJson(request);
    const prekeys = prekeysOf(raw.prekeys);
    if (!prekeys) return json(400, { error: "That device key was not accepted." });
    const signed = raw.signedPrekey;
    const signedPrekey =
      signed && typeof signed === "object"
        ? {
            id: stringField(signed as Record<string, unknown>, "id"),
            publicKey: stringField(signed as Record<string, unknown>, "publicKey"),
            signature: stringField(signed as Record<string, unknown>, "signature"),
          }
        : null;
    const saved = await addPrekeys(
      deps.db,
      userId,
      deviceId,
      prekeys,
      signedPrekey && signedPrekey.id ? signedPrekey : null,
      deps.now(),
    );
    if (!saved.ok) return json(saved.status, { error: saved.error });
    return json(200, { ok: true });
  }

  if (path === "/api/dm/backup" && method === "GET") {
    const backup = await getBackup(deps.db, userId);
    if (!backup) return json(404, { error: "No key backup is stored." });
    return json(200, backup);
  }
  if (path === "/api/dm/backup" && method === "POST") {
    const parsed = backupOf(await readJson(request));
    if (!parsed) return json(400, { error: "That key backup was not accepted." });
    const saved = await putBackup(deps.db, userId, parsed.boxPublic, parsed.record, deps.now());
    if (!saved.ok) return json(saved.status, { error: saved.error });
    return json(200, { ok: true });
  }

  if (path === "/api/dm/keys" && method === "GET") {
    const preview = await previewBundle(deps.db, userId, url.searchParams.get("userId") ?? "");
    if (!preview.ok) return json(preview.status, { error: preview.error });
    return json(200, preview.value);
  }

  if (path === "/api/dm/bundles" && method === "POST") {
    const target = stringField(await readJson(request), "userId");
    const limit = await consumeLimit(
      deps.db,
      `dm-bundle:${userId}`,
      DM_BUNDLE_LIMIT,
      deps.now().getTime(),
    );
    if (!limit.allowed) return tooMany(limit.retryAfter);
    const perTarget = await consumeLimit(
      deps.db,
      `dm-bundle:${userId}:${target}`,
      DM_BUNDLE_TARGET_LIMIT,
      deps.now().getTime(),
    );
    if (!perTarget.allowed) return tooMany(perTarget.retryAfter);
    const bundle = await claimBundle(deps.db, userId, target, deps.now());
    if (!bundle.ok) return json(bundle.status, { error: bundle.error });
    return json(200, bundle.value);
  }

  if (path === "/api/dm/attendance" && method === "POST") {
    const body = await readJson(request);
    const claimed = body.cardIds ?? body.meetingIds;
    const cardIds = Array.isArray(claimed)
      ? claimed.filter((item): item is string => typeof item === "string")
      : [];
    const saved = await recordAttendance(deps.db, userId, deps.now(), cardIds);
    if (!saved.ok) return json(saved.status, { error: saved.error });
    return json(200, { ok: true });
  }
  if (path === "/api/dm/peers" && method === "GET") {
    return json(200, { peers: await listPeers(deps.db, userId) });
  }

  if (path === "/api/dm/members" && method === "GET") {
    const found = await lookupMembers(deps.db, url.searchParams.get("name") ?? "");
    if (!found.ok) return json(found.status, { error: found.error });
    return json(200, found.value);
  }

  if (path === "/api/dm/threads" && method === "GET") {
    return json(200, { threads: await listThreads(deps.db, userId) });
  }
  if (path === "/api/dm/threads" && method === "POST") {
    const opened = await openThread(
      deps.db,
      userId,
      stringField(await readJson(request), "userId"),
      deps.now(),
    );
    if (!opened.ok) return json(opened.status, { error: opened.error });
    return json(201, opened.value);
  }

  const messages = path.match(/^\/api\/dm\/threads\/([^/]+)\/messages$/);
  if (messages && method === "GET") {
    const listed = await listMessages(deps.db, userId, decodeURIComponent(messages[1]), deps.now());
    if (!listed.ok) return json(listed.status, { error: listed.error });
    return json(200, { messages: listed.value });
  }
  if (messages && method === "POST") {
    const limit = await consumeLimit(
      deps.db,
      `dm-send:${userId}`,
      DM_SEND_LIMIT,
      deps.now().getTime(),
    );
    if (!limit.allowed) return tooMany(limit.retryAfter);
    const raw = await readJson(request);
    if ("text" in raw || "plaintext" in raw || "plainText" in raw) {
      return json(400, { error: "The server does not accept message text." });
    }
    const parsed = messageOf(raw);
    if (!parsed) return json(400, { error: "That message was not accepted." });
    const saved = await postMessage(
      deps.db,
      userId,
      decodeURIComponent(messages[1]),
      parsed,
      deps.now(),
    );
    if (!saved.ok) return json(saved.status, { error: saved.error });
    return json(201, saved.value);
  }

  return json(404, { error: "Not found." });
}
