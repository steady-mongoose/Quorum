import { useEffect, useRef, useState } from "react";
import { btnSignal, fieldClass } from "@/components/quorum/bits";
import { AccountDoor } from "@/components/board/account-door";
import { LegalFooter } from "@/components/board/legal-footer";
import { codeFromSearch } from "@/lib/board/invite-entry";
import { cn } from "@/lib/cn";
import { APP_NAME, formatDate } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { useServerSession } from "@/lib/server-session-state";

/** How the app works, in the order a new member meets it. Each line is a rule the app keeps. */
const HOW = [
  {
    term: "Getting in",
    what: "A member who knows you gives you an invite code to a real gathering. Enter your name and the code to join.",
  },
  {
    term: "Going",
    what: "Say you're going to a gathering. You see that you're going. Only the room's admins see the full list.",
  },
  {
    term: "Roll call",
    what: "After the gathering, the host records who came.",
  },
  {
    term: "Messages",
    what: "You can message people you've shared a room with. No one else can message you.",
  },
  {
    term: "No feed",
    what: "No likes, reshares, scores, or algorithm. Posts show in the order they were written.",
  },
];

/** How rooms work. */
const ROOMS = [
  {
    term: "One organization each",
    what: "A room is built around one local organization, such as a church, a club, a philosophical society, a Christian business, or a trade group like carpenters or ham radio operators. What's posted in a room stays in that room.",
  },
  {
    term: "By invitation",
    what: "You join a room only when someone already in it invites you from inside the app.",
  },
  {
    term: "A steward",
    what: "Every room has a steward who keeps it on track and removes posts that break the rules.",
  },
];

function Terms({ rows }: { rows: { term: string; what: string }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
      {rows.map((row) => (
        <div key={row.term} className="contents">
          <dt className="font-semibold text-fg">{row.term}</dt>
          <dd className="text-muted">{row.what}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The door. Members join by invitation: a host's code to one card, or
 * the founder code on a new box. Nothing else is on this page.
 */
export function Door() {
  const server = useServerSession();
  const redeemInvite = useBoard((state) => state.redeemInvite);
  const rooms = useBoard((state) => state.rooms);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [outcome, setOutcome] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const live = server.mode === "live";
  const apiDown = server.configured && server.mode === "demo";
  const [checking, setChecking] = useState(false);
  const demoNote = server.configured ? null : (
    <p className="door-demo text-sm text-muted">
      The server did not answer. This browser is in demo mode. Nothing you type here is saved on the
      server.
    </p>
  );

  useEffect(() => {
    const fromUrl = codeFromSearch(window.location.search);
    if (fromUrl) setCode(fromUrl);
  }, []);

  return (
    <div className="flex flex-col gap-10">
      <div className="door-columns grid gap-10 py-6 lg:grid-cols-[minmax(0,7fr)_minmax(22rem,5fr)] lg:items-start lg:gap-16 lg:py-10">
        <div className="door-main flex max-w-3xl flex-col gap-8">
          <section className="door-hero card flex flex-col gap-3 p-6">
            <h1 className="illum font-display text-4xl leading-tight text-balance text-fg sm:text-5xl lg:text-6xl">
              Welcome to {APP_NAME}
            </h1>
            <p className="max-w-prose text-base text-muted lg:text-lg">
              {live ? (
                <>
                  {APP_NAME} is a community you join by invitation. A member who knows you gives you
                  an invite code. Once you're in, you join each room by an invite from inside the
                  app.
                </>
              ) : apiDown ? (
                <>Invite codes can't be checked right now. Try again in a moment.</>
              ) : (
                <>
                  {APP_NAME} is a community you join by invitation. A member who knows you gives you
                  an invite code. Enter your name and that code to come in. Once you're in, you join
                  each room by an invite from inside the app.
                </>
              )}
            </p>
          </section>

          <section className="door-week card flex flex-col gap-3 p-6">
            <h2 className="text-base font-semibold text-fg">How it works</h2>
            <Terms rows={HOW} />
          </section>

          <section className="door-rooms card flex flex-col gap-3 p-6">
            <h2 className="text-base font-semibold text-fg">The rooms</h2>
            <Terms rows={ROOMS} />
            <p className="max-w-prose text-sm text-muted">
              {rooms
                .filter((room) => room.id !== "dispatch")
                .map((room) => room.name)
                .join(" · ")}
            </p>
          </section>
        </div>

        <div className="door-side flex flex-col gap-6 lg:sticky lg:top-28 lg:order-last">
          {apiDown ? (
            <section
              id="sign-in"
              className="card flex flex-col gap-3 rounded-lg border border-signal bg-surface p-6"
            >
              <h2 className="text-2xl text-fg">Sign in</h2>
              <p role="status" className="text-sm text-muted">
                Sign-in is unavailable right now.
              </p>
              <button
                type="button"
                className={cn(btnSignal, "self-start min-h-[44px]")}
                aria-disabled={checking}
                onClick={() => {
                  if (checking) return;
                  setChecking(true);
                  void server.recheck().finally(() => setChecking(false));
                }}
              >
                Try again
              </button>
            </section>
          ) : null}
          {live ? (
            <>
              <p className="text-base text-fg">Already a member? Sign in below.</p>
              <AccountDoor />
            </>
          ) : (
            <form
              id="open-the-door"
              className="card flex flex-col gap-3 rounded-lg border border-signal bg-surface p-6"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) {
                  setOutcome({ kind: "error", text: "Please add your name." });
                  nameRef.current?.focus();
                  return;
                }
                const result = redeemInvite(code, name);
                if (result === null) {
                  setOutcome({
                    kind: "error",
                    text: "That invite code has already been used or has expired. Ask the member who invited you for a new one.",
                  });
                  codeRef.current?.focus();
                } else if (result === "founder") setOutcome(null);
                else
                  setOutcome({
                    kind: "success",
                    text: `You're on the list for ${result.name}, ${formatDate(result.next)}.`,
                  });
              }}
            >
              {demoNote}
              <h2 className="text-2xl text-fg">Enter your invite code</h2>
              <label className="flex flex-col gap-2 text-base text-fg">
                Your name, as people know you
                <input
                  id="door-name"
                  ref={nameRef}
                  aria-invalid={outcome?.text === "Please add your name." || undefined}
                  className={fieldClass}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </label>
              <label className="flex flex-col gap-2 text-base text-fg">
                Invite code
                <input
                  id="door-code"
                  ref={codeRef}
                  aria-invalid={
                    (outcome?.kind === "error" && outcome.text !== "Please add your name.") ||
                    undefined
                  }
                  className={cn(fieldClass, "font-mono tracking-widest uppercase")}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <button type="submit" className={cn(btnSignal, "self-start min-h-[44px]")}>
                Join
              </button>
              {outcome ? (
                <p
                  role={outcome.kind === "error" ? "alert" : "status"}
                  className={cn("text-sm", outcome.kind === "error" ? "text-fg" : "text-muted")}
                >
                  {outcome.text}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}
