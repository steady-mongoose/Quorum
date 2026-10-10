import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { btnQuiet, btnSignal, fieldClass, Kicker, When } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { DAY, DM_RETENTION_DAYS, formatWhen, otherIn, type DmMessage } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

/** Two names, plain text, gone after 30 days. No groups. */
export function DmView() {
  const me = useBoard((state) => state.me.trim());
  const threads = useBoard((state) => state.threads);
  const messages = useBoard((state) => state.messages);
  const openThread = useBoard((state) => state.openThread);
  const setOpenThread = useBoard((state) => state.setOpenThread);
  const sendDm = useBoard((state) => state.sendDm);
  const [text, setText] = useState("");

  const mine = threads.filter((thread) => thread.between.includes(me));
  const thread = mine.find((item) => item.id === openThread) ?? null;
  // The retention promise holds at render time too, not only on send or reload.
  const cutoff = Date.now() - DM_RETENTION_DAYS * DAY;
  const byThread = useMemo(() => {
    const map = new Map<string, DmMessage[]>();
    for (const message of messages.filter((m) => m.at >= cutoff).sort((a, b) => a.at - b.at)) {
      (map.get(message.threadId) ?? map.set(message.threadId, []).get(message.threadId)!).push(message);
    }
    return map;
  }, [messages, cutoff]);

  if (!me) {
    return (
      <div className="flex flex-col gap-3">
        <Kicker>Messages</Kicker>
        <h1 className="font-display text-4xl text-fg">Set your name first.</h1>
        <p className="max-w-2xl text-base text-muted">Messages go between two names. Yours is set under About.</p>
      </div>
    );
  }

  if (thread) {
    const other = otherIn(thread, me);
    const rows = byThread.get(thread.id) ?? [];
    return (
      <div className="flex flex-col gap-4 lg:max-w-3xl">
        <button type="button" className={cn(btnQuiet, "self-start px-0")} onClick={() => setOpenThread(null)}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          All messages
        </button>
        <h1 className="font-display text-3xl text-fg">{other}</h1>
        <p className="text-sm text-muted">Plain text, deleted after {DM_RETENTION_DAYS} days.</p>
        <ul className="flex flex-col gap-2">
          {rows.length === 0 ? <li className="text-sm text-muted">Nothing yet.</li> : null}
          {rows.map((message) => (
            <li
              key={message.id}
              className={cn("max-w-xl rounded-md border border-line px-3 py-2", message.from === me ? "self-end bg-raised" : "self-start bg-surface")}
            >
              <p className="text-base text-fg">{message.text}</p>
              <p className="mt-1 text-xs text-muted">
                {message.from} · <When at={message.at} format={formatWhen} />
              </p>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            sendDm(thread.id, text);
            setText("");
          }}
        >
          <input className={fieldClass} value={text} placeholder={`To ${other}`} aria-label={`Message to ${other}`} onChange={(event) => setText(event.target.value)} />
          <button type="submit" className={btnSignal}>
            Send
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <Kicker>Messages</Kicker>
        <h1 className="max-w-xl font-display text-4xl text-balance text-fg lg:text-5xl">Two names. Thirty days. No groups.</h1>
        <p className="max-w-prose text-base text-muted">
          You can message someone you have been on an "I went" list with, or who replied to your post. Open one
          from their post or their card. Messages are plain text, not encrypted, and are deleted after {DM_RETENTION_DAYS} days.
        </p>
      </section>
      {mine.length === 0 ? (
        <p className="text-sm text-muted">No messages yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 lg:max-w-2xl">
          {mine.map((item) => {
            const last = byThread.get(item.id)?.at(-1);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-1 rounded-md border border-line bg-surface px-3 py-3 text-left"
                  onClick={() => setOpenThread(item.id)}
                >
                  <span className="text-base font-semibold text-fg">{otherIn(item, me)}</span>
                  <span className="text-sm text-muted">{last ? `${last.from === me ? "You: " : ""}${last.text}` : "Nothing yet."}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
