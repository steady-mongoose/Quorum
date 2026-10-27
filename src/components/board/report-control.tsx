import { useEffect, useId, useRef, useState } from "react";
import { Flag } from "lucide-react";
import { btnGhost, btnQuiet, btnSignal, fieldClass } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { RULE_LABEL, type HardRule } from "@/lib/board/model";
import { REPORT_SEVERITY } from "@/lib/board/reports";

const REASONS = REPORT_SEVERITY;

export function ReportControl({
  onSubmit,
  label = "Report this post",
}: {
  label?: string;
  onSubmit: (input: { reason: HardRule; note: string }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<HardRule | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const reasonName = useId();
  const legendRef = useRef<HTMLLegendElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (open) {
      legendRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    returnFocus.current = true;
    setOpen(false);
  };

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <button
          ref={triggerRef}
          type="button"
          className={cn(btnQuiet, "self-start min-h-[44px] px-3")}
          aria-label={label}
          onClick={() => {
            setSent(false);
            setOpen(true);
          }}
        >
          <Flag className="size-4" aria-hidden="true" />
          Report
        </button>
        {sent ? (
          <p role="status" className="text-sm text-muted">
            Report sent. A steward will look at it.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!reason || pending) {
          setError("Choose a reason.");
          return;
        }
        const chosen = reason;
        setPending(true);
        void onSubmit({ reason: chosen, note }).then((result) => {
          setPending(false);
          if (!result.ok) {
            setError(result.error ?? "That report was not sent.");
            return;
          }
          setSent(true);
          close();
          setReason("");
          setNote("");
          setError("");
        });
      }}
    >
      <fieldset className="flex flex-col gap-1">
        <legend ref={legendRef} tabIndex={-1} className="text-sm text-muted">Why are you reporting this?</legend>
        {REASONS.map((item) => (
          <label key={item} className="flex min-h-[44px] items-center gap-3 text-sm text-fg">
            <input
              type="radio"
              name={reasonName}
              value={item}
              checked={reason === item}
              onChange={() => {
                setReason(item);
                setError("");
              }}
            />
            {RULE_LABEL[item]}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Note, optional
        <textarea
          className={cn(fieldClass, "min-h-20")}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnSignal} disabled={pending}>
          Send report
        </button>
        <button
          type="button"
          className={btnGhost}
          onClick={() => {
            close();
            setError("");
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
