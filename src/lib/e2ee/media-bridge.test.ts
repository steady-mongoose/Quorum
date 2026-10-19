import assert from "node:assert/strict";
import test from "node:test";
import { installDmMediaCrypto } from "./media-bridge.ts";
import type { DmMediaCrypto } from "./media-crypto.ts";

test("registration waits for the media module", async () => {
  const crypto: DmMediaCrypto = {
    async seal() {
      return { ciphertext: new Uint8Array(), keyEnvelope: "" };
    },
    async open() {
      return new Uint8Array();
    },
  };
  assert.equal(await installDmMediaCrypto(crypto), false);
});
