import { useEffect } from "react";

/**
 * Sticky and fixed layers on phones (Josh, 29 Oct 2026: on Rooms the category chips stuck 128px down
 * under a ~69px header, so the list scrolled through the gap and showed above the chips).
 *
 * useMastHeight measures the sticky header (.mast-bar) and publishes its height as --mast-h on :root,
 * so the chip row (.room-chips) and html's scroll-padding-top sit flush under it at any width, font
 * size or safe-area inset. It also marks <html data-keyboard="open"> while the on-screen keyboard
 * covers the page (visualViewport), so the phone tab bar and the 20-minute line step aside.
 */

export const MAST_SELECTOR = ".mast-bar";
export const MAST_VAR = "--mast-h";
/** A visual viewport this much shorter than the layout viewport means the keyboard is up. */
export const KEYBOARD_MIN_PX = 120;

/** Whole pixels, so sub-pixel layout never leaves a hairline gap under the header. */
export function mastHeightValue(height: number): string | null {
  if (!Number.isFinite(height) || height <= 0) return null;
  return `${Math.ceil(height)}px`;
}

/** True when the visual viewport (minus pinch zoom) is well short of the layout viewport. */
export function keyboardOpen(layoutHeight: number, visualHeight: number, scale = 1): boolean {
  if (!(layoutHeight > 0) || !(visualHeight > 0)) return false;
  if (scale > 1.01) return false; // a pinch zoom shrinks the visual viewport too; that is not the keyboard
  return layoutHeight - visualHeight > KEYBOARD_MIN_PX;
}

export function useMastHeight(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    const cleanups: Array<() => void> = [];

    const header = document.querySelector<HTMLElement>(MAST_SELECTOR);
    if (header) {
      const apply = () => {
        const value = mastHeightValue(header.getBoundingClientRect().height);
        if (value && root.style.getPropertyValue(MAST_VAR) !== value) {
          root.style.setProperty(MAST_VAR, value);
        }
      };
      apply();
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(apply);
        observer.observe(header);
        cleanups.push(() => observer.disconnect());
      } else {
        window.addEventListener("resize", apply);
        cleanups.push(() => window.removeEventListener("resize", apply));
      }
    }

    const viewport = window.visualViewport;
    if (viewport) {
      const sync = () => {
        if (keyboardOpen(window.innerHeight, viewport.height, viewport.scale)) {
          root.dataset.keyboard = "open";
        } else {
          delete root.dataset.keyboard;
        }
      };
      sync();
      viewport.addEventListener("resize", sync);
      cleanups.push(() => {
        viewport.removeEventListener("resize", sync);
        delete root.dataset.keyboard;
      });
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);
}
