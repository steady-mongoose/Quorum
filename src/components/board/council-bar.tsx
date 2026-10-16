import { useState } from "react";
import { btnQuiet, btnSignal, fieldClass } from "@/components/quorum/bits";
import { COUNCIL_APPROVED_LABEL, liveApproval } from "@/lib/board/home";
import { useBoard } from "@/lib/board/store";

/** Reason field for a council member, and revoke for an admin. Hidden otherwise. */
export function CouncilBar({ entryId }: { entryId: string }) {
  const council = useBoard((state) => state.council);
  const admin = useBoard((state) => state.admin);
  const approvals = useBoard((state) => state.councilApprovals);
  const approveForHome = useBoard((state) => state.approveForHome);
  const revokeApproval = useBoard((state) => state.revokeApproval);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const live = liveApproval(entryId, approvals);
  if (!council && !(admin && live)) return null;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs tracking-widest text-muted uppercase">Council</span>
      {live ? (
        <p className="text-sm text-muted">
          {COUNCIL_APPROVED_LABEL} by {live.by}. {live.reason}
        </p>
      ) : null}
      {council && !live ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={fieldClass}
            placeholder="Why this should sit above the usual order"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label="Council reason"
          />
          <button
            type="button"
            className={btnSignal}
            onClick={() => {
              const result = approveForHome(entryId, reason);
              setError(result.ok ? "" : result.error);
              if (result.ok) setReason("");
            }}
          >
            Approve for Home
          </button>
        </div>
      ) : null}
      {live && admin ? (
        <button
          type="button"
          className={btnQuiet + " self-start"}
          onClick={() => {
            const result = revokeApproval(entryId);
            setError(result.ok ? "" : result.error);
          }}
        >
          Revoke approval
        </button>
      ) : null}
      {error ? <p className="text-sm text-signal">{error}</p> : null}
    </div>
  );
}
