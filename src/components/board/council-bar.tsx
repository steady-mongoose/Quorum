import { useState } from "react";
import { btnQuiet, btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { checklistFor } from "@/lib/board/council";
import type { Post } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";

/** A council member logs one reason. Only an admin can take the label back. */
export function CouncilBar({ post }: { post: Post }) {
  const remote = useBoard((state) => state.remote);
  const councilMember = useBoard((state) => state.council);
  const admin = useBoard((state) => state.admin);
  const setCouncil = useBoard((state) => state.setCouncil);
  const [checks, setChecks] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const reasonId = `council-reason-${post.id}`;

  if (post.council) {
    return (
      <div className="mt-2">
        <p className="text-[0.8125rem] text-muted">{post.council.reason}</p>
        <ul className="mt-1 list-disc pl-5 text-sm text-muted">
          {post.council.checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {remote && admin ? (
          <button
            type="button"
            className={cn(btnQuiet, "mt-2 px-0")}
            onClick={() => {
              setError("");
              void setCouncil(post.id, { action: "revoke", reason: "", checklist: [] }).then((result) => {
                if (!result.ok) setError(result.error ?? "That approval was not saved.");
              });
            }}
          >
            Revoke council approval
          </button>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-[#f0b4a4]">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (!remote || !councilMember || !post.subject || post.parentId) return null;

  return (
    <form
      className="mt-3 flex flex-col gap-2 border-t border-line pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        void setCouncil(post.id, { action: "approve", reason, checklist: checks }).then((result) => {
          if (!result.ok) setError(result.error ?? "That approval was not saved.");
        });
      }}
    >
      {checklistFor(post.subject).map((item) => (
        <label key={item} className="flex min-h-[44px] items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="size-5"
            checked={checks.includes(item)}
            onChange={() =>
              setChecks((current) =>
                current.includes(item) ? current.filter((row) => row !== item) : [...current, item],
              )
            }
          />
          {item}
        </label>
      ))}
      <label className="flex flex-col gap-2 text-[0.8125rem] text-muted" htmlFor={reasonId}>
        Council review
        <input
          id={reasonId}
          className={fieldClass}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <button type="submit" className={btnSignal}>
        Council-approved
      </button>
      {error ? (
        <p role="alert" className="text-sm text-[#f0b4a4]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
