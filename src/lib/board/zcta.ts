// ZIP to town. The census seed is a static file. Admin corrections live in
// the board store and win over the seed. Home asks for one ZIP, not the file.

import { normalizeZip, type ZipTown } from "./home.ts";

export type TownRecord = {
  townId: string;
  name: string;
  state: string;
};

/** Census seed row: zip -> [townId, name, state]. */
export type ZipDirectory = Readonly<Record<string, readonly [string, string, string]>>;

/**
 * An admin correction. Newest row for a ZIP wins. An empty `townId` clears
 * the ZIP so Home matches no town until a later correction sets one.
 */
export type ZipCorrection = {
  id: string;
  zip: string;
  townId: string;
  name: string;
  state: string;
  by: string;
  at: number;
};

/** Same slug the census build script writes: "Riverview" + FL -> riverview-fl. */
export function townSlug(name: string, state: string): string {
  const base = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const st = state.trim().toLowerCase();
  return base && st ? `${base}-${st}` : "";
}

export function latestZipCorrection(zip: string, corrections: readonly ZipCorrection[]): ZipCorrection | null {
  const code = normalizeZip(zip);
  if (!code) return null;
  let latest: ZipCorrection | null = null;
  for (const row of corrections) {
    if (normalizeZip(row.zip) !== code) continue;
    if (!latest || row.at > latest.at || (row.at === latest.at && row.id > latest.id)) latest = row;
  }
  return latest;
}

function fromTuple(tuple: readonly [string, string, string] | undefined): TownRecord | null {
  if (!tuple) return null;
  const [townId, name, state] = tuple;
  if (!townId.trim()) return null;
  return { townId, name, state };
}

/** The town Home should use for this ZIP, after corrections. */
export function resolvedTown(zip: string, seed: ZipDirectory, corrections: readonly ZipCorrection[] = []): TownRecord | null {
  const code = normalizeZip(zip);
  if (!code) return null;
  const correction = latestZipCorrection(code, corrections);
  if (correction) {
    if (!correction.townId.trim()) return null;
    return { townId: correction.townId, name: correction.name, state: correction.state };
  }
  return fromTuple(seed[code]);
}

/** One catalog row for the member's ZIP. Does not walk the national file. */
export function zipRowsForMember(zip: string, seed: ZipDirectory, corrections: readonly ZipCorrection[] = []): ZipTown[] {
  const code = normalizeZip(zip);
  const town = resolvedTown(zip, seed, corrections);
  if (!code || !town) return [];
  return [{ zip: code, townId: town.townId }];
}
