/** Shown until counsel writes the notice. Not legal text. */
export const LEGAL_NOTICE_PLACEHOLDER =
  "We are finishing this notice. It will be posted here before anyone is asked to agree to it.";

export const LEGAL_NOTICE_UPDATED = "Last updated: not yet published.";

export function LegalNotice({ title }: { title: "Privacy" | "Terms" }) {
  return (
    <article className="flex max-w-prose flex-col gap-3">
      <h1 className="illum font-display text-4xl text-fg sm:text-5xl">{title}</h1>
      <p className="text-base text-fg">{LEGAL_NOTICE_PLACEHOLDER}</p>
      <p className="text-sm text-muted">{LEGAL_NOTICE_UPDATED}</p>
    </article>
  );
}
