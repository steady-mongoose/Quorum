import { useEffect, useRef, useState } from "react";
import { btnSignal, fieldClass } from "@/components/quorum/bits";
import { COUNTIES, countyName, isCountyId } from "@/lib/board/counties";
import { useBoard } from "@/lib/board/store";
import { cn } from "@/lib/cn";

export const COUNTY_STEP_TITLE = "Which county is home?";
export const COUNTY_STEP_BODY =
  "Your rooms, groups, and week start there. You can look at any county, join a room there when someone invites you, and change this later under You. Outside these four? Pick the nearest.";

/** Asked once, after sign-in, of a member with no county. A room invite has already chosen. */
export function CountyStep() {
  const saveHomeCounty = useBoard((state) => state.saveHomeCounty);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="mx-auto my-6 flex w-full max-w-xl flex-col gap-4 rounded-lg border border-signal bg-surface p-5 sm:my-10 sm:p-6">
      <h1
        ref={heading}
        tabIndex={-1}
        className="font-display text-3xl leading-tight text-fg sm:text-4xl"
      >
        {COUNTY_STEP_TITLE}
      </h1>
      <p className="max-w-prose text-base text-muted">{COUNTY_STEP_BODY}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {COUNTIES.map((county) => (
          <button
            key={county.id}
            type="button"
            className={cn(btnSignal, "min-h-[44px]")}
            aria-disabled={pending}
            onClick={() => {
              if (pending) return;
              setPending(true);
              setError("");
              void saveHomeCounty(county.id).then((result) => {
                setPending(false);
                if (!result.ok) setError(result.error ?? "Your county was not saved.");
              });
            }}
          >
            {county.name}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Home county under You. */
export function HomeCountyField() {
  const homeCounty = useBoard((state) => state.homeCounty);
  const countiesOn = useBoard((state) => state.countiesOn);
  const saveHomeCounty = useBoard((state) => state.saveHomeCounty);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  if (!countiesOn) return null;
  return (
    <section className="mt-4 flex flex-col gap-2">
      <h2 className="text-2xl text-fg">Home county</h2>
      <label className="flex max-w-xs flex-col gap-2 text-sm text-muted">
        Where your rooms, groups, and week start
        <select
          className={cn(fieldClass, "min-h-[44px]")}
          value={homeCounty ?? ""}
          onChange={(event) => {
            const next = event.target.value;
            if (!isCountyId(next)) return;
            setNote("");
            setError("");
            void saveHomeCounty(next).then((result) => {
              if (result.ok) setNote(`Saved. Home is ${countyName(next)}.`);
              else setError(result.error ?? "Your county was not saved.");
            });
          }}
        >
          {homeCounty ? null : <option value="">Choose a county</option>}
          {COUNTIES.map((county) => (
            <option key={county.id} value={county.id}>
              {county.name}
            </option>
          ))}
        </select>
      </label>
      {note ? (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
