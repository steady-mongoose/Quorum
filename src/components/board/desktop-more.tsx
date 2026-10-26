import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { pill } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  MORE_TAB,
  desktopMore,
  desktopMoreCurrent,
  menuFocusIndex,
  tabAriaCurrent,
} from "@/lib/board/phone-nav";
import type { Section } from "@/lib/board/model";

// The server bundle has no document, so it keeps useEffect. The client opens
// the dialog in useLayoutEffect, before the click that set `open` returns.
const useDialogEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * Desktop More holds The desk and About. The dialog traps focus. Escape
 * closes it and returns focus here. Arrow keys move between the rows.
 */
export function DesktopMore({
  current,
  deskOn,
  onSelect,
  itemClassName,
  iconClassName,
}: {
  current: Section;
  deskOn: boolean;
  onSelect: (id: Section) => void;
  itemClassName?: string;
  iconClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const entries = desktopMore(deskOn);
  const active = desktopMoreCurrent(current);

  useDialogEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const button = moreRef.current;
    if (button) {
      const rect = button.getBoundingClientRect();
      dialog.style.position = "fixed";
      dialog.style.margin = "0";
      dialog.style.inset = "auto";
      dialog.style.top = `${rect.bottom + 8}px`;
      dialog.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    }
    if (!dialog.open) dialog.showModal();
    const currentRow = dialog.querySelector<HTMLButtonElement>('[aria-current="page"]');
    (currentRow ?? dialog.querySelector("button"))?.focus();
    return () => {
      if (dialog.open) dialog.close();
      moreRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={moreRef}
        type="button"
        className={pill(active, itemClassName)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-current={tabAriaCurrent(active)}
        onClick={() => setOpen(true)}
      >
        <Ellipsis className={cn("size-4", iconClassName)} aria-hidden="true" />
        {MORE_TAB.label}
      </button>
      {open ? (
        <dialog
          ref={dialogRef}
          id={dialogId}
          aria-label="More"
          className="w-56 rounded-lg border border-line bg-surface p-2 text-fg"
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
          onKeyDown={(event) => {
            const dialog = dialogRef.current;
            if (!dialog) return;
            const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = menuFocusIndex(index, buttons.length, event.key);
            if (next === null) return;
            event.preventDefault();
            buttons[next]?.focus();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <ul className="flex flex-col gap-1">
            {entries.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={pill(current === item.id, "w-full justify-start")}
                  aria-current={tabAriaCurrent(current === item.id)}
                  onClick={() => {
                    setOpen(false);
                    onSelect(item.id);
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </dialog>
      ) : null}
    </>
  );
}
