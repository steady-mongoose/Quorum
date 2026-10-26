import assert from "node:assert/strict";
import test from "node:test";
import { installDmMediaCrypto } from "./media-bridge.ts";
import type { DmMediaCrypto } from "./media-crypto.ts";
import { clearDmMediaCrypto, getDmMediaCrypto } from "../media/e2e.ts";

test("registration reaches the media module on the board", async () => {
  clearDmMediaCrypto();
  const crypto: DmMediaCrypto = {
    async seal() {
      return { ciphertext: new Uint8Array(), keyEnvelope: "" };
    },
    async open() {
      return new Uint8Array();
    },
  };
  assert.equal(await installDmMediaCrypto(crypto), true);
  assert.equal(getDmMediaCrypto(), crypto);
  clearDmMediaCrypto();
});
