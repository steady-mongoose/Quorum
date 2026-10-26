import type { Section } from "./model.ts";

/** Phone slots, in order. More is the fifth and holds the rest. */
export const PHONE_TABS = [
  { id: "week", label: "This week" },
  { id: "rooms", label: "Rooms" },
  { id: "find", label: "Find" },
  { id: "messages", label: "Messages" },
] as const;

export const MORE_TAB = { id: "more", label: "More" } as const;

/**
 * One entry that slots into the More sheet. Groups is not a phone tab.
 * You, The desk, and About stay with it.
 */
export const MORE_ENTRIES = [
  { id: "groups", label: "Groups" },
  { id: "profile", label: "You" },
  { id: "civic", label: "The desk" },
  { id: "about", label: "About" },
] as const;

/** Desktop keeps every section in the header, including Groups. */
export const DESKTOP_NAV = [
  { id: "week", label: "This week" },
  { id: "rooms", label: "Rooms" },
  { id: "groups", label: "Groups" },
  { id: "find", label: "Find" },
  { id: "civic", label: "The desk" },
  { id: "messages", label: "Messages" },
  { id: "profile", label: "You" },
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

export function desktopNav(deskOn: boolean) {
  return DESKTOP_NAV.filter((item) => item.id !== "civic" || deskOn);
}

/** Groups, You, The desk, and About light the More tab. */
export function moreTabCurrent(section: Section): boolean {
  return (
    section === "groups" || section === "profile" || section === "civic" || section === "about"
  );
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
