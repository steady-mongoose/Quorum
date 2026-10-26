import type { Section } from "./model.ts";

/** Phone slots, in order. More is the fifth and holds the rest. */
export const PHONE_TABS = [
  { id: "week", label: "This week" },
  { id: "rooms", label: "Rooms" },
  { id: "find", label: "Find" },
  { id: "messages", label: "Messages" },
] as const;

export const MORE_TAB = { id: "more", label: "More" } as const;

/** Groups, then You, then The desk, then About. The desk is listed only when it is on. */
export const MORE_ENTRIES = [
  { id: "groups", label: "Groups" },
  { id: "profile", label: "You" },
  { id: "civic", label: "The desk" },
  { id: "about", label: "About" },
] as const;

/** Six header items. The desk and About sit in the desktop More menu. */
export const DESKTOP_NAV = [
  { id: "week", label: "This week" },
  { id: "rooms", label: "Rooms" },
  { id: "groups", label: "Groups" },
  { id: "find", label: "Find" },
  { id: "messages", label: "Messages" },
  { id: "profile", label: "You" },
] as const;

/** The desk, then About. The desk is listed only when it is on. */
export const DESKTOP_MORE = [
  { id: "civic", label: "The desk" },
  { id: "about", label: "About" },
] as const;

/** Every phone control stays at least this tall and wide. */
export const TOUCH_MIN_PX = 44;
/** One tab slot. Taller than the 44px floor. */
export const TAB_SLOT_PX = 56;
/** One row in the More sheet. Taller than the 44px floor. */
export const MORE_ROW_PX = 48;

export function meetsTouchFloor(px: number): boolean {
  return px >= TOUCH_MIN_PX;
}

export function moreEntries(deskOn: boolean) {
  return MORE_ENTRIES.filter((item) => item.id !== "civic" || deskOn);
}

export function desktopNav(_deskOn: boolean) {
  return DESKTOP_NAV;
}

export function desktopMore(deskOn: boolean) {
  return DESKTOP_MORE.filter((item) => item.id !== "civic" || deskOn);
}

/** Groups, You, The desk, and About light the phone More tab. */
export function moreTabCurrent(section: Section): boolean {
  return section === "groups" || section === "profile" || section === "civic" || section === "about";
}

/** The desk and About light the desktop More button. */
export function desktopMoreCurrent(section: Section): boolean {
  return section === "civic" || section === "about";
}

/**
 * Arrow keys move through a menu. Home and End jump to the ends.
 * A missing focus index starts at the first item going down, and the last going up.
 */
export function menuFocusIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown" || key === "ArrowRight") {
    return current < 0 ? 0 : (current + 1) % count;
  }
  if (key === "ArrowUp" || key === "ArrowLeft") {
    return current < 0 ? count - 1 : (current - 1 + count) % count;
  }
  return null;
}

export function tabAriaCurrent(active: boolean): "page" | undefined {
  return active ? "page" : undefined;
}

/** A downward swipe closes the sheet. A sideways move does not. */
export function moreSheetDismisses(dx: number, dy: number): boolean {
  return dy >= MORE_ROW_PX && dy > Math.abs(dx);
}

/**
 * A backdrop tap closes the sheet. Chrome fires that click on the dialog.
 * A press inside the sheet, including its rows, stays open.
 */
export function moreSheetBackdropTap(input: {
  targetIsDialog: boolean;
  clientX: number;
  clientY: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}): boolean {
  if (input.targetIsDialog) return true;
  return (
    input.clientY < input.top ||
    input.clientY > input.bottom ||
    input.clientX < input.left ||
    input.clientX > input.right
  );
}
