import { useEffect, useId, useState } from "react";
import { browserTransport } from "@/lib/e2ee/browser";
import {
  MESSAGE_FROM_CHOICES,
  readMessageSetting,
  saveMessageSetting,
  type MessageFrom,
} from "@/lib/e2ee/message-setting";

/**
 * Who can message you. Someone you turn away sees the same note as when a
 * member has blocked them, so they cannot tell which it was.
 */
export function MessageSetting() {
  const name = useId();
  const [value, setValue] = useState<MessageFrom | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void readMessageSetting(browserTransport()).then((result) => {
      if (cancelled) return;
      if (result.ok) setValue(result.messageFrom);
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(next: MessageFrom) {
    if (pending || value === null || next === value) return;
    const before = value;
    setValue(next);
    setPending(true);
    setNotice("");
    setError("");
    const result = await saveMessageSetting(browserTransport(), next);
    setPending(false);
    if (result.ok) {
      setValue(result.messageFrom);
      setNotice("Saved.");
    } else {
      setValue(before);
      setError(result.message);
    }
  }

  return (
    <section className="flex w-full flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5 md:max-w-xl xl:max-w-3xl">
      <fieldset className="flex flex-col gap-3" aria-busy={value === null || pending}>
        <legend className="mb-1 text-2xl text-fg">Messages</legend>
        <p className="max-w-prose text-sm text-muted">
          Choose who can message you. People you turn away are not told why. They see the same
          note as when someone isn't taking messages.
        </p>
        {MESSAGE_FROM_CHOICES.map((choice) => (
          <label
            key={choice.value}
            className="flex min-h-[44px] items-start gap-3 text-sm text-fg"
          >
            <input
              type="radio"
              className="mt-0.5 size-5 shrink-0"
              name={name}
              value={choice.value}
              checked={value === choice.value}
              onChange={() => void choose(choice.value)}
            />
            <span className="flex flex-col gap-0.5">
              <span>{choice.label}</span>
              <span className="text-muted">{choice.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p role="status" className="text-sm text-muted">
        {notice}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-fg">
          {error}
        </p>
      ) : null}
    </section>
  );
}
