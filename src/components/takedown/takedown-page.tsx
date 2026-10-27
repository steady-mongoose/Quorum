import { useId, useRef, useState } from "react";
import { btnSignal, fieldClass } from "@/components/quorum/bits";
import { apiFetch } from "@/lib/api-base";

export type TakedownSubmit = (body: Record<string, unknown>) => Promise<
  { ok: true; id: string; mailed: boolean } | { ok: false; error: string }
>;

export const submitTakedownRequest: TakedownSubmit = async (body) => {
  try {
    const response = await apiFetch("/api/takedown", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as
      | { request?: { id?: string; mailed?: boolean }; error?: string }
      | null;
    if (response.ok && json?.request?.id) {
      return { ok: true, id: json.request.id, mailed: json.request.mailed === true };
    }
    return { ok: false, error: json?.error || "The request was not sent. Try again." };
  } catch {
    return { ok: false, error: "The request was not sent. Check your connection and try again." };
  }
};

export const GOOD_FAITH_STATEMENT =
  "I state in good faith that this image or video shows me, or a person I am authorized to act for, " +
  "in an intimate way, and that it was published without consent.";

/** The public page: how removal works, and the request form. No account needed. */
export function TakedownPage({ submit = submitTakedownRequest }: { submit?: TakedownSubmit }) {
  const [sent, setSent] = useState<{ id: string; mailed: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const base = useId();
  const field = (name: string) => `${base}-${name}`;

  return (
    <main id="main" className="mx-auto flex w-full max-w-[44rem] flex-col gap-6 px-4 py-10 text-fg">
      <h1 className="text-3xl">Request removal of intimate images</h1>
      <section aria-labelledby={field("how")} className="flex flex-col gap-3 text-base">
        <h2 id={field("how")} className="text-xl">
          How this works
        </h2>
        <ol className="flex list-decimal flex-col gap-2 pl-6">
          <li>
            Fill in the form below. You do not need an Avouch account. You can ask for yourself or
            for someone you are authorized to act for.
          </li>
          <li>We show you a request ID and email it to you.</li>
          <li>
            Within 48 hours, an Avouch admin reviews the request. If the image or video is on Avouch,
            we remove it and every identical copy.
          </li>
          <li>We block the same file from being uploaded again.</li>
          <li>Every step is recorded. Reply to our email with your request ID to add anything.</li>
        </ol>
        <p className="text-sm text-muted">
          Messages between members are end-to-end encrypted, so we cannot search them. If the image
          was sent to you in a message, describe who sent it and when.
        </p>
      </section>

      {sent ? (
        <section className="card flex flex-col gap-2 rounded-lg border border-signal bg-surface p-6">
          <h2 ref={doneRef} tabIndex={-1} className="text-xl">
            Request received
          </h2>
          <p role="status">
            Your request ID is <strong>{sent.id}</strong>. Keep it.
          </p>
          <p className="text-sm text-muted">
            {sent.mailed
              ? "We emailed it to you as well."
              : "We could not email you a copy right now, so write the ID down."}
          </p>
        </section>
      ) : (
        <form
          className="card flex flex-col gap-4 rounded-lg border border-line bg-surface p-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const elements = event.currentTarget.elements;
            const item = (key: string) => elements.namedItem(key) as HTMLInputElement | null;
            const text = (key: string) => item(key)?.value ?? "";
            setBusy(true);
            void submit({
              name: text("name"),
              email: text("email"),
              phone: text("phone"),
              contentUrl: text("contentUrl"),
              description: text("description"),
              goodFaith: item("goodFaith")?.checked === true,
              signature: text("signature"),
            }).then((result) => {
              setBusy(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setError("");
              setSent({ id: result.id, mailed: result.mailed });
              window.setTimeout(() => doneRef.current?.focus(), 0);
            });
          }}
        >
          <h2 className="text-xl">Your request</h2>
          <label className="flex flex-col gap-1 text-sm" htmlFor={field("name")}>
            Your name
            <input id={field("name")} name="name" required autoComplete="name" className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor={field("email")}>
            Email for our reply
            <input
              id={field("email")}
              name="email"
              type="email"
              required
              autoComplete="email"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor={field("phone")}>
            Phone (optional)
            <input id={field("phone")} name="phone" type="tel" autoComplete="tel" className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor={field("contentUrl")}>
            Link to the image or video on Avouch
            <input id={field("contentUrl")} name="contentUrl" type="url" className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor={field("description")}>
            Or describe where it is: the room, the post, who posted it, and when
            <textarea id={field("description")} name="description" rows={4} className={fieldClass} />
          </label>
          <label className="flex min-h-[44px] items-start gap-3 text-sm" htmlFor={field("goodFaith")}>
            <input
              id={field("goodFaith")}
              name="goodFaith"
              type="checkbox"
              required
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span>{GOOD_FAITH_STATEMENT}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor={field("signature")}>
            Signature: type your full name
            <input id={field("signature")} name="signature" required className={fieldClass} />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <button type="submit" className={`${btnSignal} min-h-[44px] self-start`} disabled={busy}>
            {busy ? "Sending…" : "Send request"}
          </button>
        </form>
      )}
      <p className="text-sm">
        <a className="underline" href="/">
          Back to Avouch
        </a>
      </p>
    </main>
  );
}
