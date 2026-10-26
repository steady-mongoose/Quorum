// A ZIP does not create a room. A member asks. An admin decides, in writing.
// The request row stays after the decision.

import { isEnglish, oneSentence, SENTENCE_ERROR } from "./text.ts";
import { nameSlug, townSlug } from "./home.ts";

export type RoomKind = "town" | "congregation" | "region";

export type RoomRequestDraft = {
  kind: RoomKind;
  name: string;
  state: string;
  townId: string;
  congregationId: string;
  regionId: string;
  roomId: string;
};

const ROOM_ID = /^[a-z0-9-]{1,32}$/;

export function planRoomRequest(input: {
  kind: string;
  name: string;
  state: string;
  takenRoomIds: readonly string[];
  takenTownIds: readonly string[];
  takenCongregationIds: readonly string[];
  takenRegionIds: readonly string[];
  openTownIds: readonly string[];
  openCongregationIds: readonly string[];
  openRegionIds: readonly string[];
}): { ok: true; draft: RoomRequestDraft } | { ok: false; error: string } {
  const kind = input.kind.trim();
  if (kind !== "town" && kind !== "congregation" && kind !== "region") {
    return { ok: false, error: "Ask for a town, a congregation, or a wider region." };
  }
  const name = input.name.trim();
  if (!name || name.length > 80 || !isEnglish(name)) return { ok: false, error: "Name the place in English." };
  if (kind === "town") {
    const state = input.state.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: "Enter a two-letter state." };
    const townId = townSlug(name, state);
    const roomId = `town-${townId}`;
    if (!townId || !ROOM_ID.test(roomId)) return { ok: false, error: "Use a shorter town name." };
    if (input.takenTownIds.includes(townId) || input.takenRoomIds.includes(roomId)) {
      return { ok: false, error: "That town already has a room." };
    }
    if (input.openTownIds.includes(townId)) return { ok: false, error: "That town already has an open request." };
    return {
      ok: true,
      draft: { kind, name, state, townId, congregationId: "", regionId: "", roomId },
    };
  }
  const slug = nameSlug(name);
  const prefix = kind === "congregation" ? "cong-" : "region-";
  const roomId = `${prefix}${slug}`;
  if (!slug || !ROOM_ID.test(roomId)) return { ok: false, error: "Use a shorter name." };
  if (kind === "congregation") {
    if (input.takenCongregationIds.includes(slug) || input.takenRoomIds.includes(roomId)) {
      return { ok: false, error: "That congregation already has a room." };
    }
    if (input.openCongregationIds.includes(slug)) {
      return { ok: false, error: "That congregation already has an open request." };
    }
    return {
      ok: true,
      draft: { kind, name, state: "", townId: "", congregationId: slug, regionId: "", roomId },
    };
  }
  if (input.takenRegionIds.includes(slug) || input.takenRoomIds.includes(roomId)) {
    return { ok: false, error: "That region already has a room." };
  }
  if (input.openRegionIds.includes(slug)) return { ok: false, error: "That region already has an open request." };
  return {
    ok: true,
    draft: { kind, name, state: "", townId: "", congregationId: "", regionId: slug, roomId },
  };
}

export function planRoomDecision(input: {
  admin: boolean;
  actorId: string;
  requesterId: string;
  open: boolean;
  decision: string;
  note: string;
}): { ok: true; decision: "approved" | "refused"; note: string } | { ok: false; error: string } {
  if (!input.admin) return { ok: false, error: "An admin decides a room request." };
  if (!input.open) return { ok: false, error: "That request is not open." };
  if (!input.actorId || input.actorId === input.requesterId) {
    return { ok: false, error: "Someone else decides a room request." };
  }
  if (input.decision !== "approved" && input.decision !== "refused") {
    return { ok: false, error: "Approve the request or refuse it." };
  }
  const note = oneSentence(input.note);
  if (!note) return { ok: false, error: SENTENCE_ERROR };
  return { ok: true, decision: input.decision, note };
}

export function planZipCorrection(input: {
  admin: boolean;
  zip: string;
  name: string;
  state: string;
  clear: boolean;
}):
  | { ok: true; zip: string; townId: string; name: string; state: string }
  | { ok: false; error: string } {
  if (!input.admin) return { ok: false, error: "Only an admin can correct a ZIP." };
  const zip = input.zip.trim();
  const code = /^(\d{5})(?:-\d{4})?$/.exec(zip)?.[1] ?? "";
  if (!code) return { ok: false, error: "Enter a five-digit ZIP." };
  if (input.clear) return { ok: true, zip: code, townId: "", name: "", state: "" };
  const name = input.name.trim();
  const state = input.state.trim().toUpperCase();
  if (!name || name.length > 80 || !isEnglish(name)) return { ok: false, error: "Enter the town name in English." };
  if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: "Enter a two-letter state." };
  const townId = townSlug(name, state);
  if (!townId) return { ok: false, error: "Enter the town name." };
  return { ok: true, zip: code, townId, name, state };
}
