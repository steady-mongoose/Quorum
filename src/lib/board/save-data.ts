/**
 * Data saver. `prefers-reduced-data` ships in no browser, so the door's engravings and plate light are
 * gated on `navigator.connection.saveData` instead: when it is on, <html data-save-data="1"> is set and
 * door.css drops the plate, its light and motes, and the ghosted section engravings.
 * Runs from a module, not an inline <script>, because the CSP is script-src 'self'.
 */
type SaveDataNavigator = { connection?: { saveData?: boolean } };

export function markSaveData(
  nav: SaveDataNavigator | undefined = typeof navigator === "undefined"
    ? undefined
    : (navigator as unknown as SaveDataNavigator),
  root: HTMLElement | undefined = typeof document === "undefined"
    ? undefined
    : document.documentElement,
): boolean {
  if (!nav?.connection?.saveData || !root) return false;
  root.dataset.saveData = "1";
  return true;
}
