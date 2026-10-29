/**
 * Who can message a member. The server and the settings screen share these
 * words. A refusal from this setting and a refusal from a block return the
 * same status and the same body, so nobody can tell which one stopped them.
 */
export const MESSAGE_FROM = ["rooms", "conversations", "none"] as const;
export type MessageFrom = (typeof MESSAGE_FROM)[number];
export const DEFAULT_MESSAGE_FROM: MessageFrom = "rooms";

export const MESSAGE_FROM_CHOICES: {
  value: MessageFrom;
  label: string;
  hint: string;
  saved: string;
}[] = [
  {
    value: "rooms",
    label: "People in my rooms or meetings",
    hint: "Anyone who shares a room with you or has been to a meeting with you can start a conversation.",
    saved: "Saved. People in your rooms or meetings can message you.",
  },
  {
    value: "conversations",
    label: "Only people I've messaged before",
    hint: "People you've written to can keep the conversation going. Nobody new can start one; they see the same notice.",
    saved: "Saved. Only people you've messaged before can message you.",
  },
  {
    value: "none",
    label: "No one",
    hint: "Nobody can start or continue a conversation with you, and you can't write in your conversations either. They stay here to read. People who try see the same notice.",
    saved: "Saved. No one can message you.",
  },
];

export const MESSAGE_SETTING_LEGEND = "Who can message you";
export const MESSAGE_SETTING_INTRO =
  "If someone you've turned away tries to message you, they see \u201cThis member isn't taking messages right now.\u201d They aren't told it was your choice, and it looks the same as a block.";

/** Shown to a member who chose "No one", in place of their composer. */
export const MESSAGES_OFF =
  "You've turned off messages. To write here, change Who can message you in your profile.";

/** The one note for a refusal from a block or from this setting. */
export const NOT_TAKING_MESSAGES = "This member isn't taking messages right now.";

export function parseMessageFrom(value: unknown): MessageFrom | null {
  return typeof value === "string" && (MESSAGE_FROM as readonly string[]).includes(value)
    ? (value as MessageFrom)
    : null;
}

type Transport = {
  post(
    path: string,
    body: unknown,
    options?: { keepalive?: boolean },
  ): Promise<{ status: number; body: unknown }>;
  get(path: string): Promise<{ status: number; body: unknown }>;
};

type Loaded = { ok: true; messageFrom: MessageFrom } | { ok: false; message: string };

function loaded(response: { status: number; body: unknown }, fallback: string): Loaded {
  const body = response.body as Record<string, unknown> | null;
  if (response.status >= 200 && response.status < 300) {
    const value = parseMessageFrom(body?.messageFrom);
    if (value) return { ok: true, messageFrom: value };
  }
  const error = body && typeof body.error === "string" ? body.error : fallback;
  return { ok: false, message: error };
}

/** Your own Messages setting. */
export async function readMessageSetting(transport: Transport): Promise<Loaded> {
  return loaded(await transport.get("/api/dm/settings"), "Your Messages setting did not load.");
}

export async function saveMessageSetting(
  transport: Transport,
  messageFrom: MessageFrom,
): Promise<Loaded> {
  return loaded(
    // keepalive: a choice saved as the page closes still reaches the server.
    await transport.post("/api/dm/settings", { messageFrom }, { keepalive: true }),
    "Your Messages setting was not saved.",
  );
}
