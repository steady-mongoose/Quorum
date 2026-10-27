import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker, When } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  CHAT_POLL_MS,
  loadRoomChat,
  orderChat,
  removeRoomChat,
  sendRoomChat,
  type RoomChatMessage,
} from "@/lib/board/chat";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { RULE_LABEL, formatWhen, removalConfirm, type HardRule } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

const RULES = Object.keys(RULE_LABEL) as HardRule[];

/** A membership refusal closes the transcript. A steward refusal leaves it up. */
function lostRoom(error: string): boolean {
  return (
    error === "banned" ||
    error === "You are not in this room." ||
    error === "Only a member can read this room."
  );
}

function mergeChat(
  current: RoomChatMessage[],
  incoming: RoomChatMessage[],
  hidden: string[],
): RoomChatMessage[] {
  const drop = new Set(hidden);
  const byId = new Map<string, RoomChatMessage>();
  for (const message of current) {
    if (!drop.has(message.id)) byId.set(message.id, message);
  }
  for (const message of incoming) {
    if (!drop.has(message.id)) byId.set(message.id, message);
  }
  return orderChat([...byId.values()]);
}

/** One transcript per room. The server checks membership on every poll and every send. */
export function RoomChat({ roomId }: { roomId: string }) {
  const remote = useBoard((state) => state.remote);
  const admin = useBoard((state) => state.admin);
  const stewardRooms = useBoard((state) => state.stewardRooms);
  const canRemove = admin || stewardRooms.includes(roomId);
  const me = useBoard((state) => state.me.trim());
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [older, setOlder] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; rule: HardRule } | null>(null);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLLIElement | null>(null);
  const roomRef = useRef(roomId);
  const seqRef = useRef(0);
  roomRef.current = roomId;
  seqRef.current = messages.reduce((max, message) => Math.max(max, message.seq), 0);

  useEffect(() => {
    if (!remote) return;
    let stopped = false;
    setMessages([]);
    setOlder(null);
    setNote("");
    setBlocked(false);
    setRemoving(null);
    seqRef.current = 0;
    const pull = async (query?: { after?: number }) => {
      const loaded = await loadRoomChat(roomId, query);
      if (stopped || roomRef.current !== roomId) return;
      if (!loaded.ok) {
        setMessages([]);
        setOlder(null);
        seqRef.current = 0;
        setBlocked(loaded.status === 403);
        setNote(loaded.error === "banned" ? "This account is barred from the room." : loaded.error);
        return;
      }
      setBlocked(false);
      setNote("");
      setMessages((current) =>
        mergeChat(query?.after != null ? current : [], loaded.page.messages, loaded.page.hidden),
      );
      if (query?.after == null) setOlder(loaded.page.older);
    };
    void pull();
    const timer = window.setInterval(() => {
      const latest = seqRef.current;
      void pull(latest > 0 ? { after: latest } : undefined);
    }, CHAT_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [remote, roomId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, roomId]);

  if (!remote) {
    return (
      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <Kicker>Chat</Kicker>
        <h2 className="text-2xl text-fg">Room chat</h2>
        <p className="max-w-prose text-sm text-muted">
          This chat is for members of the room. Sign in on the server to read it. Lines stay in time
          order, and a removed or barred member loses access on the next check.
        </p>
      </section>
    );
  }

  function removeMessage(messageId: string, rule: HardRule) {
    void removeRoomChat(roomId, messageId, rule).then((result) => {
      if (!result.ok) {
        setNote(result.error === "banned" ? "This account is barred from the room." : result.error);
        if (lostRoom(result.error)) {
          setMessages([]);
          setOlder(null);
          setBlocked(true);
        }
        return;
      }
      setMessages((current) => current.filter((item) => item.id !== messageId));
      setRemoving(null);
      const state = useBoard.getState();
      useBoard.setState({
        removals: [
          {
            id: result.removal.id,
            postId: messageId,
            author: result.removal.author,
            reason: rule,
            at: result.removal.at,
            roomChat: true,
          },
          ...state.removals,
        ],
        bans: result.ban
          ? [
              {
                id: result.removal.id,
                author: result.removal.author,
                reason: rule,
                until: result.ban.until,
                strikes: result.ban.strikes,
                at: result.removal.at,
              },
              ...state.bans,
            ]
          : state.bans,
      });
    });
  }

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4" data-room-chat={roomId}>
      <Kicker>Chat</Kicker>
      <h2 className="text-2xl text-fg">Room chat</h2>
      <p className="max-w-prose text-sm text-muted">
        Members of this room only. Plain text, in time order. A hard removal bars the account.
      </p>
      {note ? <p className="text-sm text-danger">{note}</p> : null}
      {older ? (
        <button
          type="button"
          className="self-start text-sm text-signal underline"
          onClick={() => {
            void loadRoomChat(roomId, { before: older }).then((loaded) => {
              if (!loaded.ok) {
                setNote(
                  loaded.error === "banned"
                    ? "This account is barred from the room."
                    : loaded.error,
                );
                if (loaded.status === 403) {
                  setMessages([]);
                  setOlder(null);
                  setBlocked(true);
                }
                return;
              }
              setMessages((current) =>
                mergeChat(current, loaded.page.messages, loaded.page.hidden),
              );
              setOlder(loaded.page.older);
            });
          }}
        >
          Older lines
        </button>
      ) : null}
      <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto" aria-label="Room chat">
        {messages.length === 0 && !note ? (
          <li className="text-sm text-muted">Nothing in this room yet.</li>
        ) : null}
        {messages.map((message) => (
          <li
            key={message.id}
            data-chat-seq={message.seq}
            className={cn(
              "max-w-xl rounded-md border border-line px-3 py-2",
              message.author === me ? "self-end bg-raised" : "self-start bg-surface",
            )}
          >
            <p className="text-base text-fg">{message.text}</p>
            <p className="mt-1 text-xs text-muted">
              {message.author} · <When at={message.at} format={formatWhen} />
            </p>
            {canRemove ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {removing === message.id ? (
                  <>
                    {RULES.map((rule) => (
                      <button
                        key={rule}
                        type="button"
                        className={btnGhost}
                        onClick={() => setConfirm({ id: message.id, rule })}
                      >
                        Remove: {RULE_LABEL[rule]}
                      </button>
                    ))}
                    <button type="button" className={btnQuiet} onClick={() => setRemoving(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={cn(btnQuiet, "px-0")}
                    onClick={() => setRemoving(message.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Remove
                  </button>
                )}
              </div>
            ) : null}
          </li>
        ))}
        <li ref={bottom} />
      </ul>
      {confirm ? (
        <ConfirmDialog
          open
          {...removalConfirm(confirm.rule, "message")}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const target = confirm;
            setConfirm(null);
            removeMessage(target.id, target.rule);
          }}
        />
      ) : null}
      {blocked ? null : (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const draft = text;
            setBusy(true);
            void sendRoomChat(roomId, draft).then((result) => {
              setBusy(false);
              if (!result.ok) {
                setNote(
                  result.error === "banned"
                    ? "This account is barred from the room."
                    : result.error,
                );
                if (result.status === 403) {
                  setMessages([]);
                  setOlder(null);
                  setBlocked(true);
                }
                return;
              }
              setText("");
              setNote("");
              setMessages((current) => mergeChat(current, [result.message], []));
            });
          }}
        >
          <input
            className={fieldClass}
            value={text}
            placeholder="Write to the room"
            aria-label="Message to the room"
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className={btnSignal} disabled={busy}>
            Send
          </button>
        </form>
      )}
    </section>
  );
}
