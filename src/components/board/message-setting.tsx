import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { browserTransport } from "@/lib/e2ee/browser";
import {
  MESSAGE_FROM_CHOICES,
  MESSAGE_SETTING_INTRO,
  MESSAGE_SETTING_LEGEND,
  readMessageSetting,
  saveMessageSetting,
  type MessageFrom,
} from "@/lib/e2ee/message-setting";

/**
 * Who can message you. Someone you turn away sees the same note as when a
 * member has blocked them, so they cannot tell which it was.
 */
/** Arrow keys move through the choices; the save waits until you settle. */
const SETTLE_MS = 800;

export function MessageSetting() {
  const name = useId();
  // What the server has; what is checked on screen.
  const [value, setValue] = useState<MessageFrom | null>(null);
  const [selected, setSelected] = useState<MessageFrom | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const saved = useRef<MessageFrom | null>(null);
  const wanted = useRef<MessageFrom | null>(null);
  const saving = useRef(false);
  const arrow = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readMessageSetting(browserTransport()).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        saved.current = result.messageFrom;
        wanted.current = result.messageFrom;
        setValue(result.messageFrom);
        setSelected(result.messageFrom);
      } else setError(result.message);
    });
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Save the latest choice. One request at a time; a newer choice made while
  // one is in flight is saved after it.
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (saving.current) return;
    const next = wanted.current;
    if (next === null || next === saved.current) return;
    saving.current = true;
    setPending(true);
    setNotice("");
    setError("");
    const result = await saveMessageSetting(browserTransport(), next);
    saving.current = false;
    if (result.ok) {
      saved.current = result.messageFrom;
      setValue(result.messageFrom);
      if (wanted.current !== result.messageFrom) {
        void flush();
        return;
      }
      setPending(false);
      setNotice(
        MESSAGE_FROM_CHOICES.find((choice) => choice.value === result.messageFrom)?.saved ??
          "Saved.",
      );
    } else {
      setPending(false);
      wanted.current = saved.current;
      setSelected(saved.current);
      setError(result.message);
    }
  }

  function choose(next: MessageFrom) {
    if (value === null) return;
    wanted.current = next;
    setSelected(next);
    if (arrow.current) {
      // Moving with the arrow keys: wait until the member settles on one.
      arrow.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SETTLE_MS);
    } else {
      void flush();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    arrow.current = event.key.startsWith("Arrow");
  }

  function onBlur(event: FocusEvent<HTMLFieldSetElement>) {
    // Leaving the group saves at once.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null) && timer.current) {
      void flush();
    }
  }

  return (
    <section className="flex w-full flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5 md:max-w-xl xl:max-w-3xl">
      <fieldset
        className="flex flex-col gap-3"
        aria-busy={value === null || pending}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        <legend className="mb-1 text-2xl text-fg">{MESSAGE_SETTING_LEGEND}</legend>
        <p className="max-w-prose text-sm text-muted">{MESSAGE_SETTING_INTRO}</p>
        {MESSAGE_FROM_CHOICES.map((choice) => {
          const hintId = `${name}-${choice.value}-hint`;
          return (
            <div key={choice.value} className="flex flex-col gap-0.5">
              <label className="flex min-h-[44px] items-start gap-3 text-sm text-fg">
                <input
                  type="radio"
                  className="mt-0.5 size-5 shrink-0"
                  name={name}
                  value={choice.value}
                  checked={selected === choice.value}
                  aria-describedby={hintId}
                  aria-disabled={value === null || pending || undefined}
                  onChange={() => choose(choice.value)}
                />
                <span>{choice.label}</span>
              </label>
              <p id={hintId} className="-mt-3 pl-8 text-sm text-muted">
                {choice.hint}
              </p>
            </div>
          );
        })}
      </fieldset>
      <p role="status" className="text-sm text-muted">
        {notice}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
