import type { VaultState } from "./mailbox.ts";
import type { EnvelopeWire } from "./protocol.ts";

type OpenedMessage = NonNullable<VaultState["opened"]>[number];

function signedPrekeyIds(state: VaultState): string[] {
  const device = state.device;
  return [
    device.signedPrekey?.id,
    device.previousSignedPrekey?.id,
    ...(device.previousSignedPrekeys ?? []).map((item) => item.id),
  ].filter((id): id is string => Boolean(id));
}

function oneTimePrekeyIds(state: VaultState): Set<string> {
  return new Set((state.device.prekeys ?? []).map((item) => item.id));
}

function envelopeStillReadable(state: VaultState, envelope: EnvelopeWire): boolean {
  const forThisDevice = envelope.recipientDeviceId === state.device.deviceId;
  const forBackup = Boolean(envelope.recipientUserBackup && state.backup?.boxSecret);
  if (!forThisDevice && !forBackup) return false;
  if (forThisDevice && envelope.prekeyId) return oneTimePrekeyIds(state).has(envelope.prekeyId);
  if (forThisDevice && envelope.signedPrekeyId) {
    return signedPrekeyIds(state).includes(envelope.signedPrekeyId);
  }
  if (forThisDevice && state.device.boxSecret) return true;
  return forBackup;
}

function messageStillReadable(state: VaultState, message: OpenedMessage): boolean {
  const envelopes = message.envelopes ?? [];
  if (envelopes.length === 0) return false;
  return envelopes.some((envelope) => envelopeStillReadable(state, envelope));
}

/**
 * Sign-out deletes the decrypted cache. This is true when every cached message
 * used a key this device no longer holds, so a later read cannot open it.
 */
export function signOutClearsReadHistory(state: VaultState | null): boolean {
  const opened = state?.opened ?? [];
  if (!state || opened.length === 0) return false;
  return !opened.some((message) => messageStillReadable(state, message));
}
