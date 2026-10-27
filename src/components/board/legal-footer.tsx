const LINK = "inline-flex min-h-[44px] items-center text-signal underline";

/** About, Privacy, and Terms. Each link is a 44px target. */
export function LegalFooter() {
  return (
    <footer>
      <nav aria-label="About, privacy, and terms" className="flex flex-wrap gap-x-4">
        <a href="/about" className={LINK}>
          About
        </a>
        <a href="/privacy" className={LINK}>
          Privacy
        </a>
        <a href="/terms" className={LINK}>
          Terms
        </a>
      </nav>
    </footer>
  );
}
