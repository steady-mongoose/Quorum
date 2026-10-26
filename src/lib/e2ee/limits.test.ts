import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DM_ABOUT_NOTICE,
  DM_DEMO_NOTICE,
  DM_ENCRYPTED_NOTICE,
  DM_KEYS_MISSING,
  DM_PASSPHRASE_WARNING,
  DM_SAFETY_HINT,
  DM_SIGNOUT_HISTORY_WARNING,
} from "./copy.ts";
import { DM_RETENTION_DAYS, DM_TEXT_MAX, dmTextError, passphraseError } from "./limits.ts";

test("the passphrase checker uses the named zxcvbn exports", () => {
  const source = readFileSync(new URL("./limits.ts", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../../../.github/workflows/test.yml", import.meta.url), "utf8");
  assert.match(source, /import \{ ZxcvbnFactory \} from "@zxcvbn-ts\/core"/);
  assert.match(source, /import \* as common from "@zxcvbn-ts\/language-common"/);
  assert.match(source, /import \* as en from "@zxcvbn-ts\/language-en"/);
  assert.equal(source.includes("import core from"), false);
  assert.equal(source.includes("import common from"), false);
  assert.equal(source.includes("import english from"), false);
  assert.match(workflow, /npm run build/);
});

test("message limits stay two people, plain text, and 30 days", () => {
  assert.equal(DM_RETENTION_DAYS, 30);
  assert.equal(dmTextError("  "), "Write a message first.");
  assert.equal(dmTextError("Thursday"), null);
  assert.match(dmTextError("a".repeat(DM_TEXT_MAX + 1)) ?? "", /4000/);
  assert.equal(passphraseError("short"), "Use at least 12 characters.");
  assert.equal(passphraseError("a long enough passphrase"), null);
  assert.match(passphraseError("aaaaaaaaaaaa") ?? "", /stronger passphrase/);
});

test("message copy is English and does not add a feed, likes, reshares, or scores", () => {
  for (const line of [
    DM_DEMO_NOTICE,
    DM_ENCRYPTED_NOTICE,
    DM_ABOUT_NOTICE,
    DM_SAFETY_HINT,
    DM_KEYS_MISSING,
    DM_PASSPHRASE_WARNING,
    DM_SIGNOUT_HISTORY_WARNING,
  ]) {
    assert.equal(line.toLowerCase().includes("like"), false);
    assert.equal(line.toLowerCase().includes("reshare"), false);
    assert.equal(line.toLowerCase().includes("score"), false);
    assert.equal(line.toLowerCase().includes("algorithm"), false);
  }
  assert.equal(
    DM_ENCRYPTED_NOTICE,
    "Messages are encrypted on your device before they're sent and deleted after 30 days.",
  );
  assert.equal(DM_KEYS_MISSING, "Not yet encrypted.");
  assert.equal(
    DM_PASSPHRASE_WARNING,
    "If you forget this passphrase, nobody can recover your messages.",
  );
  assert.equal(DM_ENCRYPTED_NOTICE.includes("plain text"), false);
  assert.equal(DM_ENCRYPTED_NOTICE.includes("not encrypted"), false);
  assert.match(DM_DEMO_NOTICE, /not encrypted/);
  assert.match(DM_DEMO_NOTICE, /this device/);
  assert.match(DM_ABOUT_NOTICE, /ciphertext/);
  assert.match(DM_ABOUT_NOTICE, /same meeting/);
  assert.match(DM_ABOUT_NOTICE, /30 days/);
  assert.match(DM_SAFETY_HINT, /backup key/);
});

test("the mailbox copy matches the screen and the controls stay tappable", () => {
  const mailbox = readFileSync(
    new URL("../../components/board/encrypted-mailbox.tsx", import.meta.url),
    "utf8",
  );
  const demo = readFileSync(new URL("../../components/board/dm-view.tsx", import.meta.url), "utf8");
  assert.match(mailbox, /DM_ENCRYPTED_NOTICE/);
  assert.match(mailbox, /DM_KEYS_MISSING/);
  assert.equal(mailbox.match(/\{DM_PASSPHRASE_WARNING\}/g)?.length, 2);
  assert.equal(mailbox.includes("If you forget this passphrase"), false);
  assert.equal(mailbox.includes("If you lose this passphrase"), false);
  assert.match(mailbox, /type=\{showPassphrase \? "text" : "password"\}/);
  assert.match(mailbox, /autoComplete="new-password"/);
  assert.match(mailbox, /autoComplete="current-password"/);
  assert.match(mailbox, /Show passphrase/);
  assert.match(mailbox, /aria-describedby=\{mismatch \? mismatchId : undefined\}/);
  assert.match(mailbox, /role="alert"/);
  assert.match(mailbox, /aria-busy=\{busy\}/);
  assert.match(mailbox, /Sending…/);
  assert.match(mailbox, /Saving…/);
  assert.match(mailbox, /aria-label=\{`Conversation with \$\{/);
  assert.match(mailbox, /text-\[0\.8125rem\]/);
  assert.equal(mailbox.includes("text-xs"), false);
  const media = readFileSync(new URL("../../components/board/media-share.tsx", import.meta.url), "utf8");
  assert.match(media, /figcaption className="mt-1 text-\[0\.8125rem\]/);
  assert.equal(media.includes('figcaption className="mt-1 text-xs'), false);
  assert.equal(mailbox.includes("plain text, not encrypted"), false);
  assert.equal(demo.includes("MessagePictureNote"), false);
  assert.equal(demo.includes("plain text, not encrypted"), false);
  assert.match(demo, /Demo only: not encrypted, deleted after \{DM_RETENTION_DAYS\} days\./);
  assert.match(demo, /min-h-\[44px\]/);
  assert.match(demo, /aria-label=\{`Conversation with \$\{/);
});
