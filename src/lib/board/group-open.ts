/**
 * Whether a single group is open on the Groups page. GroupsView keeps the open id in its own state;
 * the shell reads this flag to set <body data-view="group">, so the sheet can give a group its plate.
 */
let open = false;
const listeners = new Set<() => void>();

export function setGroupOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

export function getGroupOpen(): boolean {
  return open;
}

export function subscribeGroupOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
