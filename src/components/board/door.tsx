import { useState } from "react";
import { btnGhost, btnSignal, fieldClass, Kicker } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { APP_NAME, formatDate } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

/**
 * The door. The platform is invite-only: a host's code to one card, or
 * the founder code on a new box. Nothing else is on this page.
 */
export function Door() {
  const redeemInvite = useBoard((state) => state.redeemInvite);
  const loadSample = useBoard((state) => state.loadSample);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8 py-8 lg:py-16">
      <section className="flex flex-col gap-3">
        <Kicker>Invite only</Kicker>
        <h1 className="font-display text-4xl text-fg lg:text-5xl">Someone brought you here for one thing.</h1>
        <p className="text-base text-muted">
          {APP_NAME} opens with a code from a host, for one card: a shop night, a table, a meal after service. Put your name to it and that card opens. There is no sign-up and nothing to browse until you are in.
        </p>
      </section>

      <form
        className="flex flex-col gap-3 rounded-lg border border-signal bg-surface p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          const result = redeemInvite(code, name);
          if (result === null) setOutcome("That code is spent or stale, or the name is blank. Ask the host for another.");
          else if (result === "founder") setOutcome(null);
          else setOutcome(`You're on the list for ${result.name}, ${formatDate(result.next)}.`);
        }}
      >
        <label className="flex flex-col gap-2 text-sm text-muted">
          Your name, the one people at the table will use
          <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          The code
          <input className={cn(fieldClass, "font-mono tracking-widest uppercase")} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" />
        </label>
        <button type="submit" className={cn(btnSignal, "self-start")}>
          Open the door
        </button>
        {outcome ? <p className="text-sm text-muted">{outcome}</p> : null}
      </form>

      <section className="flex flex-col gap-2 border-t border-line pt-6">
        <p className="text-sm text-muted">Just looking at what this is? The sample week is six invented members and a week of cards. You become Josh.</p>
        <button type="button" className={cn(btnGhost, "self-start")} onClick={loadSample}>
          Load the sample week
        </button>
      </section>
    </div>
  );
}
