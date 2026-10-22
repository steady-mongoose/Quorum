import { useEffect } from "react";

/**
 * One short pulse on a primary action. A read, a nav pill, and a second
 * pulse in the same press do not fire. The browser honours the OS switch.
 */
export function PrimaryHaptic() {
  useEffect(() => {
    let last = 0;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".btn-primary, .btn-rsvp")) return;
      const now = performance.now();
      if (now - last < 400) return;
      last = now;
      navigator.vibrate?.(8);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
  return null;
}
