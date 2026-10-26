import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  Ellipsis,
  LayoutList,
  MessageSquare,
  Phone,
  Search,
  User,
  Users,
} from "lucide-react";
import {
  MORE_ROW_PX,
  MORE_TAB,
  PHONE_TABS,
  TOUCH_MIN_PX,
  moreEntries,
  moreSheetBackdropTap,
  moreSheetDismisses,
  moreTabCurrent,
  tabAriaCurrent,
} from "@/lib/board/phone-nav";
import type { Section } from "@/lib/board/model";

const ICONS = {
  week: CalendarDays,
  rooms: LayoutList,
  find: Search,
  messages: MessageSquare,
  groups: Users,
  profile: User,
  civic: Phone,
  about: BookOpen,
} as const;

// The server bundle has no document, so it keeps useEffect. The client opens
// the sheet in useLayoutEffect, before the click that set `open` returns.
const useDialogEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * Five phone slots in one row. More opens a sheet. Groups is one row in
 * that sheet, with You, The desk when it is on, and About. showModal traps
 * focus. Escape, a backdrop tap, and a downward swipe close it.
 */
export function SectionTabs({
  current,
  deskOn,
  onSelect,
}: {
  current: Section;
  deskOn: boolean;
  onSelect: (id: Section) => void;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const entries = moreEntries(deskOn);
  const moreCurrent = moreTabCurrent(current);

  useDialogEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
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
      <nav className="tabbar" aria-label="Primary">
        {PHONE_TABS.map((item) => {
          const Icon = ICONS[item.id];
          return (
            <button
              key={item.id}
              type="button"
              aria-current={tabAriaCurrent(current === item.id)}
              onClick={() => {
                setOpen(false);
                onSelect(item.id);
              }}
            >
              <Icon className="size-6" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
        <button
          ref={moreRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={titleId}
          aria-current={tabAriaCurrent(moreCurrent)}
          onClick={() => setOpen(true)}
        >
          <Ellipsis className="size-6" aria-hidden="true" />
          {MORE_TAB.label}
        </button>
      </nav>
      {open ? (
        <dialog
          ref={dialogRef}
          id={titleId}
          className="more-sheet"
          aria-label="More"
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              moreSheetBackdropTap({
                targetIsDialog: event.target === event.currentTarget,
                clientX: event.clientX,
                clientY: event.clientY,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left,
              })
            ) {
              setOpen(false);
            }
          }}
          onTouchStart={(event) => {
            const touch = event.changedTouches[0];
            swipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchEnd={(event) => {
            const origin = swipe.current;
            swipe.current = null;
            const touch = event.changedTouches[0];
            if (!origin || !touch) return;
            if (moreSheetDismisses(touch.clientX - origin.x, touch.clientY - origin.y)) setOpen(false);
          }}
        >
          <div className="more-grab" aria-hidden="true" />
          <ul>
            {entries.map((item) => {
              const Icon = ICONS[item.id];
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="more-row"
                    style={{ minHeight: `max(${TOUCH_MIN_PX}px, ${MORE_ROW_PX}px)` }}
                    aria-current={tabAriaCurrent(current === item.id)}
                    onClick={() => {
                      setOpen(false);
                      onSelect(item.id);
                    }}
                  >
                    <Icon className="size-6" aria-hidden="true" />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </dialog>
      ) : null}
    </>
  );
}
