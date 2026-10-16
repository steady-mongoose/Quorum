// Who may change Home. Council members add an approval with a reason.
// Admins revoke an approval, and admins correct a ZIP. Stewards do neither
// by these functions. Nothing here grants a role.

import { liveApproval, normalizeZip, type CouncilApproval } from "./home.ts";
import { townSlug, type ZipCorrection } from "./zcta.ts";

export type GateResult<T> = { ok: true; row: T } | { ok: false; error: string };

export function addCouncilApproval(
  roles: { council: boolean },
  actor: string,
  draft: { entryId: string; reason: string },
  now: number,
  id: string,
  knownEntry: boolean,
): GateResult<CouncilApproval> {
  if (!roles.council) return { ok: false, error: "Only a council member can approve a post for Home." };
  const entryId = draft.entryId.trim();
  if (!knownEntry || !entryId) return { ok: false, error: "That post is not on the board." };
  const reason = draft.reason.trim();
  if (!reason) return { ok: false, error: "A council approval needs a reason." };
  return {
    ok: true,
    row: { id, entryId, reason, by: actor.trim() || "Council", at: now, revokedAt: null },
  };
}

/** Appends a newer log row. The original approval stays in the log. */
export function revokeCouncilApproval(
  roles: { admin: boolean },
  actor: string,
  approvals: readonly CouncilApproval[],
  entryId: string,
  now: number,
  id: string,
): GateResult<CouncilApproval> {
  if (!roles.admin) return { ok: false, error: "Only an admin can revoke a council approval." };
  const live = liveApproval(entryId, approvals);
  if (!live) return { ok: false, error: "There is no live approval to revoke." };
  return {
    ok: true,
    row: {
      id,
      entryId: live.entryId,
      reason: live.reason,
      by: actor.trim() || "Admin",
      at: now,
      revokedAt: now,
    },
  };
}

export function proposeZipCorrection(
  isAdmin: boolean,
  actor: string,
  input: { zip: string; name: string; state: string },
  now: number,
  id: string,
): GateResult<ZipCorrection> {
  if (!isAdmin) return { ok: false, error: "Only an admin can correct a ZIP." };
  const zip = normalizeZip(input.zip);
  if (!zip) return { ok: false, error: "Enter a five-digit ZIP." };
  const name = input.name.trim();
  const state = input.state.trim().toUpperCase();
  if (!name) return { ok: false, error: "Enter the town name." };
  if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: "Enter a two-letter state." };
  const townId = townSlug(name, state);
  if (!townId) return { ok: false, error: "Enter the town name." };
  return { ok: true, row: { id, zip, townId, name, state, by: actor.trim() || "Admin", at: now } };
}

export function proposeZipClear(isAdmin: boolean, actor: string, zipInput: string, now: number, id: string): GateResult<ZipCorrection> {
  if (!isAdmin) return { ok: false, error: "Only an admin can correct a ZIP." };
  const zip = normalizeZip(zipInput);
  if (!zip) return { ok: false, error: "Enter a five-digit ZIP." };
  return { ok: true, row: { id, zip, townId: "", name: "", state: "", by: actor.trim() || "Admin", at: now } };
}
