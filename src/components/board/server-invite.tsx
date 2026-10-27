import { useEffect, useRef, useState } from "react";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { INVITE_HASH, landOnInvite, watchInviteHash } from "@/lib/board/invite-hash";
import { useServerSession } from "@/lib/server-session-state";

export const COPIED = "Code copied.";
export const COPY_BLOCKED = "Couldn't copy. The code is selected; copy it by hand.";

/** A member makes a server invite. The code is shown once. */
export function ServerInvite() {
  const server = useServerSession();
  const [maxUses, setMaxUses] = useState("1");
  const [code, setCode] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState("");
  const codeText = useRef<HTMLParagraphElement | null>(null);

  /** When the clipboard is blocked, select the code so it can be copied by hand. */
  const selectCode = () => {
    const node = codeText.current;
    const selection = typeof window === "undefined" ? null : window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const heading = useRef<HTMLHeadingElement | null>(null);
  const live = server.mode === "live" && Boolean(server.user);

  // Arriving at /about#invite (from Find) lands focus on this section's heading.
  useEffect(() => {
    if (!live || typeof window === "undefined") return;
    const land = () => landOnInvite(window, () => heading.current);
    // The router sets the hash with pushState, which fires no hashchange; look again next tick.
    let stop = watchInviteHash(window, land);
    const later = window.setTimeout(() => {
      stop();
      stop = watchInviteHash(window, land);
    }, 50);
    return () => {
      window.clearTimeout(later);
      stop();
    };
  }, [live]);

  if (server.mode !== "live" || !server.user) return null;

  return (
    <section id={INVITE_HASH} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 ref={heading} tabIndex={-1} className="text-2xl text-fg">
        Invite someone
      </h2>
      <p className="max-w-prose text-sm text-muted">
        Signed in as {server.user.name}. A code is single-use unless you set a higher limit, up to
        20. To invite a group, make one code and raise the number. You can make five codes a minute.
        The server records who invited whom. The code is shown once.
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
            setCopyNote("");
            setCode(result.code);
          });
        }}
      >
        Make a code
      </button>
      {code ? (
        <div className="flex flex-wrap items-center gap-3">
          <p ref={codeText} id="invite-code" className="font-mono text-lg tracking-widest text-fg select-all">
            {code}
          </p>
          <button
            type="button"
            className={cn(btnGhost, "min-h-[44px]")}
            aria-label="Copy code"
            aria-describedby="invite-code"
            onClick={() => {
              // Clear first so a second copy is announced again.
              setCopyNote("");
              const say = (text: string) => window.setTimeout(() => setCopyNote(text), 50);
              const done = () => say(COPIED);
              const blocked = () => {
                selectCode();
                say(COPY_BLOCKED);
              };
              const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
              if (!clip?.writeText) return blocked();
              void clip.writeText(code).then(done, blocked);
            }}
          >
            Copy code
          </button>
        </div>
      ) : null}
      <p className="text-sm text-muted" role="status">
        {copyNote}
      </p>
      {outcome ? (
        <p className="text-sm text-fg" role="alert">
          {outcome}
        </p>
      ) : null}
    </section>
  );
}
