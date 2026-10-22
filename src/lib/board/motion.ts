import { flushSync } from "react-dom";

/** The room whose chip and page title share one view-transition name. */
let armedRoom: string | null = null;
const listeners = new Set<() => void>();

function publish(next: string | null) {
  armedRoom = next;
  for (const listener of listeners) listener();
}

export function armRoom(room: string) {
  publish(room);
}

export function clearArmedRoom() {
  publish(null);
}

export function getArmedRoom(): string | null {
  return armedRoom;
}

export function subscribeArmedRoom(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/** Drop leftover names so two chips never share one transition. */
export function clearChipNames(except?: HTMLElement) {
  if (typeof document === "undefined") return;
  for (const el of document.querySelectorAll<HTMLElement>("button")) {
    if (el !== except && el.style.viewTransitionName) el.style.viewTransitionName = "";
  }
}

export function withViewTransition(update: () => void) {
  const finish = () =>
    window.setTimeout(() => {
      clearArmedRoom();
      clearChipNames();
    }, 480);
  const doc = document as TransitionDocument;
  if (typeof doc.startViewTransition === "function") {
    const transition = doc.startViewTransition(() => {
      flushSync(update);
    });
    void transition.finished.finally(finish);
    return;
  }
  update();
  finish();
}
