import { btnSignal } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { focusAuthenticator } from "@/lib/board/focus-authenticator";

/**
 * The page-wide nudge for an owner, admin or steward with no authenticator.
 * "Set it up" opens You and focuses the Authenticator heading, the same way
 * "Turn it on under You" does on Groups.
 */
export function MfaBanner({ onSetUp }: { onSetUp: () => void }) {
  return (
    <div className="mfa-banner mb-4 flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-prose text-sm text-fg">
        Turn on an authenticator before you moderate, grant a role, approve a reset, or export.
      </p>
      <button
        type="button"
        className={cn(btnSignal, "w-full sm:w-auto")}
        onClick={() => {
          onSetUp();
          focusAuthenticator();
        }}
      >
        Set it up
      </button>
    </div>
  );
}
