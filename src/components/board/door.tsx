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
    what: "Say you're going to a gathering. You see only your own answer. The host, the room's stewards, and the admins see who is going.",
  },
  {
    term: "Roll call",
    what: "In a room that takes roll, the host records who came. Only the host, the room's stewards, and the admins see it. You see your own.",
  },
  {
    term: "Messages",
    what: "You can message people in your rooms and people you've been at a gathering with. No one else can message you, and you can block anyone.",
  },
  {
    term: "No feed",
    what: "No likes, reshares, scores, or algorithm. Posts appear in the order they were written.",
  },
];

/** How rooms work. */
const ROOMS = [
  {
    term: "One group each",
    what: "A room is one church, shop, club, or county. Its posts are shown only to the room's members, its steward, and the admins. A host can choose to share a gathering by link.",
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
          <dt className="door-term">{row.term}</dt>
          <dd className="door-what text-muted">{row.what}</dd>
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
            <h1 className="illum door-title font-display text-4xl leading-tight text-balance text-fg sm:text-5xl lg:text-6xl">
              Welcome to {APP_NAME}
            </h1>
            <div className="door-rule" aria-hidden="true" />
            <p className="door-lede max-w-prose">
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
            <h2 className="door-heading text-base font-semibold text-fg">How it works</h2>
            <Terms rows={HOW} />
          </section>

          <section className="door-rooms card flex flex-col gap-3 p-6">
            <h2 id="door-rooms-heading" className="door-heading text-base font-semibold text-fg">
              The rooms
            </h2>
            <Terms rows={ROOMS} />
            <ul className="door-roomlist" role="list" aria-labelledby="door-rooms-heading">
              {rooms
                .filter((room) => room.id !== "dispatch")
                .map((room) => (
                  <li key={room.id} className="door-room">
                    {room.name}
                  </li>
                ))}
            </ul>
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
              <p className="door-aside">Already a member? Sign in below.</p>
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
