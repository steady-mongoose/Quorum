/**
 * English only. These lines match the mailbox:
 * signed-in text is sealed on the device, a demo that is not signed in is not,
 * messages last 30 days, and there is no feed, like, reshare, or score.
 */

export const DM_DEMO_NOTICE =
  "This demo keeps messages on this device. They are not encrypted. Sign in and messages are encrypted on your device before they're sent and deleted after 30 days.";

export const DM_ENCRYPTED_NOTICE =
  "Messages are encrypted on your device before they're sent and deleted after 30 days.";

export const DM_KEYS_MISSING = "Not yet encrypted.";

export const DM_PASSPHRASE_WARNING =
  "If you forget this passphrase, nobody can recover your messages.";

/** Who you can message. The server holds the same rule. */
export const MESSAGE_RULE =
  "You can message someone in one of your rooms, or someone you have been to a meeting with.";

export const DM_ABOUT_NOTICE =
  "People in your rooms and people who have been to the same meeting as you can message you. Nobody else can. A new member of a room waits three days before starting a conversation there. You can block anyone, and they are not told. Only people from the same meeting can see your profile. Messages are encrypted on your device before they're sent and deleted after 30 days. The server stores ciphertext and public keys, not the text. Two people only.";

export const DM_SAFETY_HINT =
  "Compare this number with the other person, in person or on a call. A new device or a new backup key changes the number. If it does not match, do not send.";

export const DM_SIGNOUT_HISTORY_WARNING =
  "Signing out clears your read history here. This device won't be able to open those messages again.";
