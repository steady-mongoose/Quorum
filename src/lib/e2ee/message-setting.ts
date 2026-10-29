/**
 * Who can message a member. The server and the settings screen share these
 * words. A refusal from this setting and a refusal from a block return the
 * same status and the same body, so nobody can tell which one stopped them.
 */
export const MESSAGE_FROM = ["rooms", "conversations", "none"] as const;
export type MessageFrom = (typeof MESSAGE_FROM)[number];
export const DEFAULT_MESSAGE_FROM: MessageFrom = "rooms";

export const MESSAGE_FROM_CHOICES: { value: MessageFrom; label: string; hint: string }[] = [
  {
    value: "rooms",
    label: "Anyone in my rooms",
    hint: "People in your rooms and people you've been to a meeting with.",
  },
  {
    value: "conversations",
    label: "Only people I've messaged before",
    hint: "Only people you already have a conversation with. Nobody new can start one.",
  },
  {
    value: "none",
    label: "No one",
    hint: "Nobody can message you. You can still write to others, but they can't reply until you change this.",
  },
];

/** The one note for a refusal from a block or from this setting. */
export const NOT_TAKING_MESSAGES = "This member isn't taking messages right now.";

export function parseMessageFrom(value: unknown): MessageFrom | null {
  return typeof value === "string" && (MESSAGE_FROM as readonly string[]).includes(value)
    ? (value as MessageFrom)
    : null;
}

type Transport = {
  post(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
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
    await transport.post("/api/dm/settings", { messageFrom }),
    "Your Messages setting was not saved.",
  );
}
