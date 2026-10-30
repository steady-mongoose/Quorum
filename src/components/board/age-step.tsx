import { useEffect, useRef, useState } from "react";
import { btnSignal } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { AGE_SIGNUP_ERROR, AGE_SIGNUP_LABEL, AGE_STEP_BODY, AGE_STEP_TITLE } from "@/lib/board/age";
import { useServerSession } from "@/lib/server-session-state";

export const AGE_STEP_ERROR_ID = "age-step-error";

/**
 * Shown once, after sign-in, to a member whose account was made before the
 * 18+ check. No skip and no timer. The server holds every member route until
 * this is sent with a ticked box.
 */
export function AgeStep() {
  const server = useServerSession();
  const [adult, setAdult] = useState(false);
  const [ageError, setAgeError] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const box = useRef<HTMLInputElement>(null);

  // Land on the heading, not the box: nothing is announced as an error on arrival.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <form
      id="age-step"
      noValidate
      className="mx-auto my-6 flex w-full max-w-xl flex-col gap-4 rounded-lg border border-signal bg-surface p-5 sm:my-10 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        // aria-disabled, not disabled, so focus stays on Continue while it works.
        if (pending) return;
        setOutcome(null);
        if (!adult) {
          setAgeError(true);
          box.current?.focus();
          return;
        }
        setAgeError(false);
        setPending(true);
        void server.confirmAge(true).then((result) => {
          setPending(false);
          if (!result.ok) {
            setOutcome(result.message ?? "The server did not accept that.");
            return;
          }
          // The step unmounts; land on the view's heading, or the main region.
          requestAnimationFrame(() => focusView());
        });
      }}
    >
      <h1 ref={heading} tabIndex={-1} className="font-display text-3xl leading-tight text-fg sm:text-4xl">
        {AGE_STEP_TITLE}
      </h1>
      <p className="max-w-prose text-base text-muted">{AGE_STEP_BODY}</p>
      <label className="flex min-h-[44px] items-center gap-3 text-sm text-fg">
        <input
          type="checkbox"
          className="check-gilt"
          ref={box}
          checked={adult}
          aria-invalid={ageError ? true : undefined}
          aria-describedby={ageError ? AGE_STEP_ERROR_ID : undefined}
          onChange={(event) => {
            setAdult(event.target.checked);
            if (event.target.checked) setAgeError(false);
          }}
        />
        {AGE_SIGNUP_LABEL}
      </label>
      {ageError ? (
        <p id={AGE_STEP_ERROR_ID} role="alert" className="text-sm text-danger">
          {AGE_SIGNUP_ERROR}
        </p>
      ) : null}
      {outcome ? (
        <p role="alert" className="text-sm text-danger">
          {outcome}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          className={cn(btnSignal, "min-h-[44px]")}
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
        >
          Continue
        </button>
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center px-1 text-sm text-signal underline"
          aria-disabled={signingOut || undefined}
          onClick={() => {
            if (signingOut) return;
            setSigningOut(true);
            void server.signOut().finally(() => setSigningOut(false));
          }}
        >
          Sign out
        </button>
      </div>
    </form>
  );
}

/** The view's own heading when it takes focus, otherwise #main. */
function focusView(): void {
  const heading = document.querySelector<HTMLElement>("#main h1[tabindex]");
  const target = heading ?? document.getElementById("main");
  target?.focus();
}
