import { useState } from "react";
import { btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { useServerSession } from "@/lib/server-session-state";

/** A member makes a server invite. The code is shown once. */
export function ServerInvite() {
  const server = useServerSession();
  const [maxUses, setMaxUses] = useState("1");
  const [code, setCode] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  if (server.mode !== "live" || !server.user) return null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">Invite someone</h2>
      <p className="max-w-prose text-sm text-muted">
        Signed in as {server.user.name}. A code is single-use unless you set a higher limit, up to
        20. The server records who invited whom. The code is shown once.
      </p>
      <label className="flex max-w-xs flex-col gap-2 text-sm text-muted">
        How many people can use it
        <input
          className={fieldClass}
          inputMode="numeric"
          value={maxUses}
          onChange={(event) => setMaxUses(event.target.value)}
        />
      </label>
      <button
        type="button"
        className={cn(btnSignal, "self-start")}
        onClick={() => {
          setOutcome(null);
          const parsed = Number(maxUses);
          void server.createInvite({ maxUses: parsed }).then((result) => {
            if (!result.ok) {
              setCode(null);
              setOutcome(result.message);
              return;
            }
            setCode(result.code);
          });
        }}
      >
        Make a code
      </button>
      {code ? <p className="font-mono text-lg tracking-widest text-fg">{code}</p> : null}
      {outcome ? <p className="text-sm text-muted">{outcome}</p> : null}
    </section>
  );
}
