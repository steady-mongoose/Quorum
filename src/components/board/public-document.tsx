import type { ReactNode } from "react";
import { LegalFooter } from "@/components/board/legal-footer";
import { useEngravedDocument } from "@/components/board/engraved-ground";
import { heroLabel } from "@/lib/board/engraved";
import { APP_NAME } from "@/lib/board/model";

/**
 * A page outside the sign-in gate: About, Privacy, or Terms. All three carry
 * the About plate, Rembrandt's Three Trees, set after the first paint and
 * never under reduced data, the same way the board sets its plates.
 */
export function PublicDocument({ children }: { children: ReactNode }) {
  useEngravedDocument("about");
  return (
    <div className="shell min-h-dvh overflow-x-clip bg-bg text-fg">
      <div className="hero-band full" role="img" aria-label={heroLabel("about") ?? undefined} />
      <main
        id="main"
        className="mx-auto flex w-full max-w-[72rem] min-w-0 flex-col gap-8 px-[clamp(1rem,4vw,4rem)] py-8"
      >
        <p className="font-display text-3xl leading-none text-fg">
          <a href="/" className="inline-flex min-h-[44px] items-center">
            {APP_NAME}
          </a>
        </p>
        {children}
        <LegalFooter />
      </main>
    </div>
  );
}
