import type { ReactNode } from "react";
import { LegalFooter } from "@/components/board/legal-footer";
import { PublicNav } from "@/components/board/public-nav";
import { useEngravedDocument } from "@/components/board/engraved-ground";
import { heroLabel } from "@/lib/board/engraved";

/**
 * A page outside the sign-in gate: About, Privacy, or Terms. Each stands on a whole plate with the door's
 * constant light and motes (door.css section 7): About on the door's own Martin, Privacy and Terms on
 * Dürer's Saint Jerome in His Study (`art="jerome"`). Every word sits on one solid card; the plate shows
 * around it. Data savers get no plate.
 */
export function PublicDocument({
  children,
  art = "martin",
  wide = false,
}: {
  children: ReactNode;
  art?: "martin" | "jerome";
  wide?: boolean;
}) {
  useEngravedDocument("about");
  const jerome = art === "jerome";
  return (
    <div className="shell min-h-dvh overflow-x-clip text-fg">
      <div
        className={jerome ? "plate-ground door-ground doc-jerome" : "plate-ground door-ground"}
        role="img"
        aria-label={heroLabel(jerome ? "rooms" : "about") ?? undefined}
      />
      <div className="scrim" aria-hidden="true" />
      <PublicNav />
      <main
        id="main"
        className={`mx-auto w-full ${wide ? "max-w-[72rem]" : "max-w-[64rem]"} min-w-0 px-[clamp(0.75rem,4vw,4rem)] py-[clamp(1.5rem,6vh,4rem)]`}
      >
        <div className="card pc-card flex min-w-0 flex-col gap-8 p-[clamp(1rem,3vw,2.5rem)]">
          {children}
          <LegalFooter />
        </div>
      </main>
    </div>
  );
}
