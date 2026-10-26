/**
 * The vault is JSON, sealed with AES-GCM under a non-extractable WebCrypto key.
 * IndexedDB holds the key and the ciphertext. The key cannot be exported, so a
 * script cannot copy the raw key out of the browser. A script that is already
 * running can still ask WebCrypto to decrypt, which is the limit of this wrap.
 */

const VERSION = 1;

export type SealedVault = {
  version: number;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
};

export async function createVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function bytes(value: Uint8Array): BufferSource {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

export async function sealVault(key: CryptoKey, json: string): Promise<SealedVault> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bytes(iv) },
    key,
    bytes(new TextEncoder().encode(json)),
  );
  return { version: VERSION, iv, ciphertext };
}

export async function openVault(key: CryptoKey, sealed: SealedVault): Promise<string> {
  if (sealed.version !== VERSION)
    throw new Error("This key backup on the device is not recognized.");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes(sealed.iv) },
    key,
    sealed.ciphertext,
  );
  return new TextDecoder().decode(plain);
}
