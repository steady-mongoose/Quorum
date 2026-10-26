import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDmMediaCrypto,
  getDmMediaCrypto,
  registerDmMediaCrypto,
  type DmMediaCrypto,
} from "./e2e.ts";

test("message encryption starts unset and can be registered", () => {
  clearDmMediaCrypto();
  assert.equal(getDmMediaCrypto(), null);
  const crypto: DmMediaCrypto = {
    async seal(input) {
      return { ciphertext: input.bytes, keyEnvelope: "wrapped" };
    },
    async open(input) {
      return input.ciphertext;
    },
  };
  registerDmMediaCrypto(crypto);
  assert.equal(getDmMediaCrypto(), crypto);
  clearDmMediaCrypto();
  assert.equal(getDmMediaCrypto(), null);
});
