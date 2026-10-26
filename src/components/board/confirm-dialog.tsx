import { useEffect, useId, useRef, type ReactNode } from "react";
import { btnGhost, btnSignal } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";

/**
 * A modal confirmation. Escape and the cancel button dismiss it. Focus
 * starts on the safe action so Enter does not confirm a wipe. A destructive
 * confirm uses the danger token. A grant uses the neutral button.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  tone = "danger",
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  tone?: "danger" | "neutral";
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirming = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      confirming.current = false;
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      if (!dialog.open) return;
      confirming.current = true;
      dialog.close();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="w-[min(28rem,calc(100%-2rem))] rounded-lg border border-line bg-surface p-5 text-fg backdrop:bg-bg/80"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={() => {
        if (confirming.current) {
          confirming.current = false;
          return;
        }
        onCancel();
      }}
    >
      <h2 id={titleId} className="text-2xl text-fg">
        {title}
      </h2>
      <p id={descriptionId} className="mt-2 max-w-prose text-sm text-muted">
        {description}
      </p>
      {children}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(
            btnGhost,
            "min-h-[44px]",
            tone === "danger" && "border-danger/60 text-danger",
          )}
          disabled={confirmDisabled}
          onClick={() => {
            if (confirmDisabled) return;
            confirming.current = true;
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
        <button
          ref={cancelRef}
          type="button"
          className={cn(btnSignal, "min-h-[44px]")}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
      </div>
    </dialog>
  );
}
