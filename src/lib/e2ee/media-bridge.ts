import type { DmMediaCrypto } from "./media-crypto.ts";

/**
 * Hand the mailbox crypto to the media page. That page lives in the media
 * change and is absent until it lands. A missing module leaves pictures off.
 */
export async function installDmMediaCrypto(crypto: DmMediaCrypto): Promise<boolean> {
  try {
    const specifier = "../media/e2e.ts";
    const loaded = (await import(/* @vite-ignore */ specifier)) as {
      registerDmMediaCrypto?: (crypto: DmMediaCrypto) => void;
    };
    if (typeof loaded.registerDmMediaCrypto !== "function") return false;
    loaded.registerDmMediaCrypto(crypto);
    return true;
  } catch {
    return false;
  }
}
