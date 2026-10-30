import type { ReactNode } from "react";
import { LegalFooter } from "@/components/board/legal-footer";
import { useEngravedDocument } from "@/components/board/engraved-ground";
import { heroLabel } from "@/lib/board/engraved";
import { APP_NAME } from "@/lib/board/model";

/**
 * A page outside the sign-in gate: About, Privacy, or Terms. All three stand on the door's
 * whole plate, Martin's Creation of Light, with its constant light and motes (door.css section 7).
 * Every word sits on one solid card; the plate shows around it. Data savers get no plate.
 */
export function PublicDocument({ children }: { children: ReactNode }) {
  useEngravedDocument("about");
  return (
    <div className="shell min-h-dvh overflow-x-clip text-fg">
      <div className="plate-ground door-ground" role="img" aria-label={heroLabel("about") ?? undefined} />
      <div className="scrim" aria-hidden="true" />
      <main
        id="main"
        className="mx-auto w-full max-w-[64rem] min-w-0 px-[clamp(0.75rem,4vw,4rem)] py-[clamp(1.5rem,6vh,4rem)]"
      >
        <div className="card pc-card flex min-w-0 flex-col gap-8 p-[clamp(1rem,3vw,2.5rem)]">
          <p className="font-display text-3xl leading-none text-fg">
            <a href="/" className="inline-flex min-h-[44px] items-center">
              {APP_NAME}
            </a>
          </p>
          {children}
          <LegalFooter />
        </div>
      </main>
    </div>
  );
}
