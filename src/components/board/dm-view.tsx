import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { btnQuiet, btnSignal, fieldClass, Kicker, useNow } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { DM_RETENTION_DAYS, formatWhen } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

/**
 * Messages: two names, plain text, gone after 30 days. No groups. You can
 * only open one with someone you have been on an "I went" list with, or who
 * replied to your post. Strangers do not get a line in.
 */
export function DmView() {
  const me = useBoard((state) => state.me);
  const threads = useBoard((state) => state.threads);
  const messages = useBoard((state) => state.messages);
  const openThread = useBoard((state) => state.openThread);
  const setOpenThread = useBoard((state) => state.setOpenThread);
  const sendDm = useBoard((state) => state.sendDm);
  const now = useNow();
  const [text, setText] = useState("");
  const name = me.trim();
  const mine = threads.filter((thread) => thread.between.includes(name));
  const thread = mine.find((item) => item.id === openThread) ?? null;

  if (!name) {
    return (
      <div className="flex flex-col gap-3">
        <Kicker>Messages</Kicker>
        <h1 className="font-display text-4xl text-fg">Put your name on your posts first.</h1>
        <p className="max-w-2xl text-base text-muted">Messages go between two names. Set yours under About.</p>
      </div>
    );
  }

  if (thread) {
    const other = thread.between.find((item) => item !== name) ?? "";
    const rows = messages.filter((message) => message.threadId === thread.id).sort((a, b) => a.at - b.at);
    return (
      <div className="flex flex-col gap-4">
        <button type="button" className={cn(btnQuiet, "self-start px-0")} onClick={() => setOpenThread(null)}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          All messages
        </button>
        <h1 className="font-display text-3xl text-fg">{other}</h1>
        <p className="text-sm text-muted">Plain text on the box. Gone after {DM_RETENTION_DAYS} days. Arrange the Thursday, then go.</p>
        <ul className="flex flex-col gap-2">
          {rows.length === 0 ? <li className="text-sm text-muted">Nothing yet.</li> : null}
          {rows.map((message) => (
            <li
              key={message.id}
              className={cn(
                "max-w-xl rounded-md border border-line px-3 py-2",
                message.from === name ? "self-end bg-raised" : "self-start bg-surface",
              )}
            >
              <p className="text-base text-fg">{message.text}</p>
              <p className="mt-1 text-xs text-muted">
                {message.from} · {now ? formatWhen(message.at, now.getTime()) : ""}
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
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <Kicker>Messages</Kicker>
        <h1 className="max-w-xl font-display text-4xl text-fg">Two names. Thirty days. No groups.</h1>
        <p className="max-w-2xl text-base text-muted">
          You can message someone you have been on an "I went" list with, or who replied to your
          post. Open one from their post or their card. Messages are plain text on the box and are
          gone after {DM_RETENTION_DAYS} days. There is no group message: a group without a steward is
          where the screenshot gets taken.
        </p>
      </section>
      {mine.length === 0 ? (
        <p className="text-sm text-muted">No messages. Go somewhere, mark it, and the line opens.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {mine.map((item) => {
            const other = item.between.find((person) => person !== name) ?? "";
            const last = messages
              .filter((message) => message.threadId === item.id)
              .sort((a, b) => b.at - a.at)[0];
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-1 rounded-md border border-line bg-surface px-3 py-3 text-left"
                  onClick={() => setOpenThread(item.id)}
                >
                  <span className="text-base font-semibold text-fg">{other}</span>
                  <span className="text-sm text-muted">
                    {last ? `${last.from === name ? "You: " : ""}${last.text}` : "Nothing yet."}
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
