import { Link } from "@tanstack/react-router";
import { LegalFooter } from "@/components/board/legal-footer";
import { btnSignal } from "@/components/quorum/bits";

/** Unknown addresses. Styled like the rest of Avouch Social, with a way back to the door. */
export function NotFoundPage() {
  return (
    <div className="shell min-h-dvh overflow-x-clip text-fg">
      {/* The door's plate and its constant light (door.css section 7); the words sit on a solid card. */}
      <div className="plate-ground door-ground" aria-hidden="true" />
      <div className="scrim" aria-hidden="true" />
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-4 py-16 sm:px-6">
        <div className="card pc-card flex flex-col gap-6 p-6 sm:p-8">
          <p className="text-xs font-semibold tracking-widest text-muted uppercase">Avouch Social</p>
          <h1 className="illum font-display text-4xl text-fg sm:text-5xl">
            This page is not on the board.
          </h1>
          <p className="max-w-prose text-base text-muted">
            That address does not match a page here. The door is at the front of Avouch Social.
          </p>
          <Link to="/" className={btnSignal + " self-start"}>
            Back to the door
          </Link>
          <LegalFooter />
        </div>
      </main>
    </div>
  );
}
