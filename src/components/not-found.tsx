import { Link } from "@tanstack/react-router";
import { btnSignal } from "@/components/quorum/bits";

/** Unknown addresses. Styled like the rest of Avouch Social, with a way back to the door. */
export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">Avouch Social</p>
      <h1 className="illum font-display text-4xl text-fg sm:text-5xl">This page is not on the board.</h1>
      <p className="max-w-prose text-base text-muted">
        That address does not match a page here. The door is at the front of Avouch Social.
      </p>
      <Link to="/" className={btnSignal + " self-start"}>
        Back to the door
      </Link>
    </main>
  );
}
