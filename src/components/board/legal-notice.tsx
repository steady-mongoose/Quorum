/** Shown until counsel writes the notice. Not legal text. */
export const LEGAL_NOTICE_PLACEHOLDER = "This notice is being finalized.";

export function LegalNotice({ title }: { title: "Privacy" | "Terms" }) {
  return (
    <article className="flex max-w-prose flex-col gap-3">
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">Placeholder</p>
      <h1 className="illum font-display text-4xl text-fg sm:text-5xl">{title}</h1>
      <p className="text-base text-fg">{LEGAL_NOTICE_PLACEHOLDER}</p>
    </article>
  );
}
