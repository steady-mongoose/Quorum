import assert from "node:assert/strict";
import test from "node:test";
import { createVaultKey, openVault, sealVault } from "./vault-wrap.ts";

test("the vault wrapping key cannot be exported, and the ciphertext opens", async () => {
  const key = await createVaultKey();
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, "AES-GCM");
  const sealed = await sealVault(key, '{"userId":"member"}');
  assert.equal(new TextDecoder().decode(sealed.ciphertext).includes("member"), false);
  assert.equal(await openVault(key, sealed), '{"userId":"member"}');
  const other = await createVaultKey();
  await assert.rejects(openVault(other, sealed));
});
