import { useEffect, useState } from "react";
import { btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { AccountDoor } from "@/components/board/account-door";
import { codeFromSearch } from "@/lib/board/invite-entry";
import { cn } from "@/lib/cn";
import { APP_NAME, formatDate } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { useServerSession } from "@/lib/server-session-state";

/** What a typical week looks like. Nothing from any real card; the shape only. */
const WEEK = [
  { day: "Sunday", what: "Church, then lunch together. Someone hosts; you bring a dish." },
  {
    day: "Tuesday",
    what: "The homeschool co-op. The church's list of families who need dinners this week.",
  },
  { day: "Thursday", what: "Shop night. Some say new people welcome; those are where to start." },
  {
    day: "Second Tuesday",
    what: "Debate night at the brewery. One question, two sides, anyone welcome.",
  },
  {
    day: "Second Wednesday",
    what: "Book night: one book, a few chapters, the host says what to read next.",
  },
  {
    day: "One morning",
    what: "The group phone call: everyone phones one official with the same message in the same hour.",
  },
];

/**
 * The door. The platform is invite-only: a host's code to one card, or
 * the founder code on a new box. Nothing else is on this page.
 */
export function Door() {
  const server = useServerSession();
  const redeemInvite = useBoard((state) => state.redeemInvite);
  const rooms = useBoard((state) => state.rooms);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  const live = server.mode === "live";
  const apiDown = server.configured && server.mode === "demo";
  const [checking, setChecking] = useState(false);
  const demoNote = server.configured ? null : (
    <p className="door-demo text-sm text-muted">
      The server did not answer. This browser is in demo mode. Nothing you type here is saved on
      the server.
    </p>
  );

  useEffect(() => {
    const fromUrl = codeFromSearch(window.location.search);
    if (fromUrl) setCode(fromUrl);
  }, []);

  return (
    <div className="door-columns grid gap-10 py-6 lg:grid-cols-[minmax(0,7fr)_minmax(22rem,5fr)] lg:items-start lg:gap-16 lg:py-10">
      <div className="door-side flex flex-col gap-6 lg:sticky lg:top-28 lg:order-last">
        {apiDown ? (
          <section id="sign-in" className="card flex flex-col gap-3 rounded-lg border border-signal bg-surface p-6">
            <h2 className="text-2xl text-fg">Sign in</h2>
            <p className="text-sm text-muted">Sign-in is unavailable right now.</p>
            <button
              type="button"
              className={cn(btnSignal, "self-start")}
              disabled={checking}
              onClick={() => {
                setChecking(true);
                void server.recheck().finally(() => setChecking(false));
              }}
            >
              Try again
            </button>
          </section>
        ) : null}
        {live ? (
          <AccountDoor />
        ) : (
          <form
            id="open-the-door"
            className="card flex flex-col gap-3 rounded-lg border border-signal bg-surface p-6"
            onSubmit={(event) => {
              event.preventDefault();
              const result = redeemInvite(code, name);
              if (result === null)
                setOutcome(
                  "That code is spent or stale, or the name is blank. Ask the host for another.",
                );
              else if (result === "founder") setOutcome(null);
              else setOutcome(`You're on the list for ${result.name}, ${formatDate(result.next)}.`);
            }}
          >
            {demoNote}
            <h2 className="text-2xl text-fg">Open the door</h2>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Your name, as people know you
              <input
                id="door-name"
                className={fieldClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              The code
              <input
                id="door-code"
                className={cn(fieldClass, "font-mono tracking-widest uppercase")}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="off"
              />
            </label>
            <button type="submit" className={cn(btnSignal, "self-start")}>
              Open the door
            </button>
            {outcome ? <p className="text-sm text-muted">{outcome}</p> : null}
          </form>
        )}

      </div>

      <div className="door-main flex max-w-3xl flex-col gap-8">
        <section className="door-hero card flex flex-col gap-3 p-6">
          <Kicker>Invite only</Kicker>
          <h1 className="illum font-display text-4xl leading-tight text-balance text-fg sm:text-5xl lg:text-6xl">
            Someone brought you here for one thing.
          </h1>
          <p className="max-w-prose text-base text-muted lg:text-lg">
            {live ? (
              <>
                {APP_NAME} is invite only. Have an account? Sign in. New here? A host gives you a
                code for one meeting: a shop night, a book table, a meal after church. Membership is
                by invitation only.
              </>
            ) : apiDown ? (
              <>Invite codes can't be checked right now. Try again in a moment.</>
            ) : (
              <>
                {APP_NAME} is invite only. A host gives you a code for one meeting: a shop night, a
                book table, a meal after church. Enter your name and the code, and you are in and
                on the list for that meeting. There is no sign-up form and nothing to browse until
                then.
              </>
            )}
          </p>
        </section>

        <section className="door-week card flex flex-col gap-3 p-6">
          <h2 className="text-base font-semibold text-fg">What a typical week looks like</h2>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
            {WEEK.map((row) => (
              <div key={row.day} className="contents">
                <dt className="font-semibold text-fg">{row.day}</dt>
                <dd className="text-muted">{row.what}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="door-rooms card flex flex-col gap-2 p-6">
          <h2 className="text-base font-semibold text-fg">The rooms</h2>
          <p className="max-w-prose text-sm text-muted">
            {rooms
              .filter((room) => room.id !== "dispatch")
              .map((room) => room.name)
              .join(" · ")}
          </p>
        </section>
      </div>
    </div>
  );
}
