import sodium, { type Sodium } from "libsodium-wrappers-sumo";

export type { Sodium };

let ready: Promise<Sodium> | null = null;

/** One libsodium instance for the page and for the API process. */
export function loadSodium(): Promise<Sodium> {
  if (!ready) ready = sodium.ready.then(() => sodium);
  return ready;
}
