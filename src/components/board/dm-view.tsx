import { useEffect, useMemo, useState, type ComponentType } from "react";
import { btnSignal, fieldClass, Kicker, When } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { DM_DEMO_NOTICE } from "@/lib/e2ee/copy";
import {
  DAY,
  DM_RETENTION_DAYS,
  dmTextError,
  formatWhen,
  otherIn,
  type DmMessage,
} from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { SharedMediaFigure } from "@/components/board/media-share";
import { useServerSession } from "@/lib/server-session-state";
import { ConversationBack, ConversationHeading } from "@/components/board/conversation-top";

function LiveMailbox() {
  const [Mailbox, setMailbox] = useState<ComponentType | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("./encrypted-mailbox").then((mod) => {
      if (!cancelled) setMailbox(() => mod.EncryptedMailbox);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!Mailbox) return <p className="text-sm text-muted">Preparing encryption.</p>;
  return <Mailbox />;
}

/** Two names, plain text, gone after 30 days. No groups. Signed-in mail is encrypted first. */
export function DmView() {
  const session = useServerSession();
  const me = useBoard((state) => state.me.trim());
  const threads = useBoard((state) => state.threads);
  const messages = useBoard((state) => state.messages);
  const openThread = useBoard((state) => state.openThread);
  const setOpenThread = useBoard((state) => state.setOpenThread);
  const sendDm = useBoard((state) => state.sendDm);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const mine = threads.filter((thread) => thread.between.includes(me));
  const thread = mine.find((item) => item.id === openThread) ?? null;
  // The retention promise holds at render time too, not only on send or reload.
  const cutoff = Date.now() - DM_RETENTION_DAYS * DAY;
  const byThread = useMemo(() => {
    const map = new Map<string, DmMessage[]>();
    for (const message of messages.filter((m) => m.at >= cutoff).sort((a, b) => a.at - b.at)) {
      (map.get(message.threadId) ?? map.set(message.threadId, []).get(message.threadId)!).push(
        message,
      );
    }
    return map;
  }, [messages, cutoff]);

  if (session.mode === "pending") {
    return <p className="text-sm text-muted">Checking the server.</p>;
  }
  if (session.mode === "live" && session.user) return <LiveMailbox />;

  if (!me) {
    return (
      <div className="plate plate--hero flex flex-col gap-3">
        <Kicker>Messages</Kicker>
        <h1 className="illum font-display text-4xl text-fg">Add your name first.</h1>
        <p className="max-w-2xl text-base text-muted">Messages go between two names. Yours is set under About.</p>
      </div>
    );
  }

  if (thread) {
    const other = otherIn(thread, me);
    const rows = byThread.get(thread.id) ?? [];
    return (
      <div className="flex flex-col gap-4 lg:max-w-3xl">
        <div className="plate plate--hero flex flex-col gap-2">
          <ConversationBack onAllMessages={() => setOpenThread(null)} />
          <ConversationHeading name={other} className="illum font-display text-3xl text-fg" />
          <p className="text-sm text-muted">Plain text, deleted after {DM_RETENTION_DAYS} days.</p>
        </div>
        <ul className="flex flex-col gap-2">
          {rows.length === 0 ? <li className="text-sm text-muted">Nothing yet.</li> : null}
          {rows.map((message) => (
            <li
              key={message.id}
              className={cn(
                "card max-w-xl rounded-md border border-line px-3 py-2",
                message.from === me ? "self-end bg-raised" : "self-start bg-surface",
              )}
            >
              {message.text ? <p className="text-base text-fg">{message.text}</p> : null}
              {(message.media ?? []).map((item) => (
                <SharedMediaFigure key={item.id} item={item} />
              ))}
              <p className="mt-1 text-[0.8125rem] text-muted">
                {message.from} · <When at={message.at} format={formatWhen} />
              </p>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const issue = dmTextError(text);
            if (issue) {
              setProblem(issue);
              return;
            }
            setProblem("");
            sendDm(thread.id, text);
            setText("");
          }}
        >
          <input
            className={fieldClass}
            value={text}
            placeholder={`To ${other}`}
            aria-label={`Message to ${other}`}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className={btnSignal}>
            Send
          </button>
        </form>
        {problem ? <p className="text-sm text-muted">{problem}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="plate plate--hero flex flex-col gap-3">
        <Kicker>Messages</Kicker>
        <h1 className="illum max-w-xl font-display text-4xl text-balance text-fg lg:text-5xl">Messages</h1>
        <p className="max-w-prose text-base text-muted">
          You can message someone who posts in one of your rooms, someone you have been on an "I
          went" list with, or someone who replied to your post. Open one from their post or their
          card. {DM_DEMO_NOTICE}
        </p>
      </section>
      {mine.length === 0 ? (
        <p className="card px-4 py-3 text-sm text-muted">No messages yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 lg:max-w-2xl">
          {mine.map((item) => {
            const last = byThread.get(item.id)?.at(-1);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-label={`Conversation with ${otherIn(item, me)}`}
                  className="card flex min-h-[44px] w-full flex-col items-start gap-1 rounded-md border border-line bg-surface px-3 py-3 text-left"
                  onClick={() => setOpenThread(item.id)}
                >
                  <span className="text-base font-semibold text-fg">{otherIn(item, me)}</span>
                  <span className="text-sm text-muted">
                    {last
                      ? `${last.from === me ? "You: " : ""}${last.text || (last.media?.length ? "Picture" : "")}`
                      : "No messages yet."}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
