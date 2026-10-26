import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as en from "@zxcvbn-ts/language-en";

const zxcvbn = new ZxcvbnFactory({
  translations: en.translations,
  graphs: common.adjacencyGraphs,
  dictionary: { ...common.dictionary, ...en.dictionary },
});

/** Shared mailbox bounds. The 30-day lifetime is the existing message rule. */

export const DM_RETENTION_DAYS = 30;
export const DM_RETENTION_MS = DM_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Plain text only, and short enough to stay inside one API request. */
export const DM_TEXT_MAX = 4000;

/** One member, several browsers. Not a group chat. */
export const DM_MAX_DEVICES = 8;

export const DM_PREKEY_BATCH = 10;
export const DM_PREKEY_STOCK_MAX = 30;

/** Their devices, our devices, and one backup envelope for each member. */
export const DM_MAX_ENVELOPES = DM_MAX_DEVICES * 2 + 2;

/** Argon2id floor: libsodium interactive (2 passes, 64 MiB). There is no weaker option. */
export const BACKUP_OPSLIMIT_MIN = 2;
export const BACKUP_OPSLIMIT_MAX = 4;
export const BACKUP_MEMLIMIT_MIN = 67_108_864;
export const BACKUP_MEMLIMIT_MAX = 268_435_456;
export const BACKUP_OPSLIMIT_INTERACTIVE = 2;
export const BACKUP_MEMLIMIT_INTERACTIVE = 67_108_864;

/** One-time key fetches for a single recipient, on top of the account-wide cap. */
export const DM_BUNDLE_TARGET_MAX = 4;

/** Replace a signed prekey once it has been in use for a week. */
export const SIGNED_PREKEY_ROTATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Stop offering a signed prekey for new messages after 30 days. */
export const SIGNED_PREKEY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const BODY_CIPHER_MAX_BYTES = 16_384;
export const WRAP_CIPHER_MAX_BYTES = 128;

export function dmTextError(text: string): string | null {
  const body = text.trim();
  if (!body) return "Write a message first.";
  if ([...body].length > DM_TEXT_MAX) return `Keep it under ${DM_TEXT_MAX} characters.`;
  return null;
}

function passphraseScore(passphrase: string): number {
  return zxcvbn.check(passphrase).score;
}

export function passphraseError(passphrase: string): string | null {
  if (passphrase.length < 12) return "Use at least 12 characters.";
  if (passphrase.length > 128) return "Use at most 128 characters.";
  const words = passphrase
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length >= 4) return null;
  if (passphraseScore(passphrase) < 3) {
    return "Use a stronger passphrase. Four words, or a longer phrase, works.";
  }
  return null;
}
