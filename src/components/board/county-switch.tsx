import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { COUNTIES, countyName, type CountyId } from "@/lib/board/counties";
import { menuFocusIndex } from "@/lib/board/phone-nav";

// The server bundle has no document, so it keeps useEffect. The client opens
// the dialog in useLayoutEffect, before the click that set `open` returns.
const useDialogEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * The county in the header. Looking at another county saves nothing. A native
 * select draws its list in the browser's own colors, so this is a dialog, the
 * same as desktop More: Escape closes it and returns focus here, and arrow keys
 * move between the rows.
 */
export function CountySwitch({
  county,
  onChange,
}: {
  county: CountyId;
  onChange: (county: CountyId) => void;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  useDialogEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const button = buttonRef.current;
    if (button) {
      const rect = button.getBoundingClientRect();
      dialog.style.top = `${rect.bottom + 6}px`;
      dialog.style.left = `${Math.max(8, rect.left)}px`;
    }
    if (!dialog.open) dialog.showModal();
    const currentRow = dialog.querySelector<HTMLButtonElement>('[aria-current="true"]');
    (currentRow ?? dialog.querySelector("button"))?.focus();
    return () => {
      if (dialog.open) dialog.close();
      buttonRef.current?.focus();
    };
  }, [open]);

  return (
    <div className="mast-county">
      <button
        ref={buttonRef}
        type="button"
        className="mast-county-button"
        aria-label={`County: ${countyName(county)}. Change county`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => setOpen(true)}
      >
        {countyName(county)}
        <ChevronDown className="size-4" aria-hidden="true" />
      </button>
      {open ? (
        <dialog
          ref={dialogRef}
          id={dialogId}
          aria-label="County"
          className="county-menu"
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
          <ul>
            {COUNTIES.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={item.id === county ? "true" : undefined}
                  onClick={() => {
                    setOpen(false);
                    if (item.id !== county) onChange(item.id);
                  }}
                >
                  {item.name}
                  {item.id === county ? <Check className="size-4" aria-hidden="true" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </dialog>
      ) : null}
    </div>
  );
}
