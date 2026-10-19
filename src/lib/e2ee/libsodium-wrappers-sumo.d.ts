declare module "libsodium-wrappers-sumo" {
  interface KeyPair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    keyType?: string;
  }

  interface HashState {
    state: Uint8Array;
  }

  export interface Sodium {
    ready: Promise<void>;
    base64_variants: { ORIGINAL: number };
    crypto_box_PUBLICKEYBYTES: number;
    crypto_box_SECRETKEYBYTES: number;
    crypto_sign_PUBLICKEYBYTES: number;
    crypto_sign_SECRETKEYBYTES: number;
    crypto_sign_BYTES: number;
    crypto_secretbox_KEYBYTES: number;
    crypto_secretbox_NONCEBYTES: number;
    crypto_secretbox_MACBYTES: number;
    crypto_scalarmult_BYTES: number;
    crypto_pwhash_SALTBYTES: number;
    crypto_pwhash_OPSLIMIT_MIN: number;
    crypto_pwhash_OPSLIMIT_INTERACTIVE: number;
    crypto_pwhash_OPSLIMIT_SENSITIVE: number;
    crypto_pwhash_MEMLIMIT_MIN: number;
    crypto_pwhash_MEMLIMIT_INTERACTIVE: number;
    crypto_pwhash_MEMLIMIT_MODERATE: number;
    crypto_pwhash_ALG_ARGON2ID13: number;
    crypto_box_keypair(): KeyPair;
    crypto_sign_keypair(): KeyPair;
    crypto_sign_detached(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
    crypto_sign_verify_detached(
      signature: Uint8Array,
      message: Uint8Array,
      publicKey: Uint8Array,
    ): boolean;
    crypto_scalarmult(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array;
    crypto_generichash(outLen: number, message: Uint8Array): Uint8Array;
    crypto_generichash_init(key: Uint8Array | null, outLen: number): HashState;
    crypto_generichash_update(state: HashState, message: Uint8Array): void;
    crypto_generichash_final(state: HashState, outLen: number): Uint8Array;
    crypto_secretbox_easy(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
    crypto_secretbox_open_easy(
      ciphertext: Uint8Array,
      nonce: Uint8Array,
      key: Uint8Array,
    ): Uint8Array;
    crypto_pwhash(
      keyLength: number,
      password: string | Uint8Array,
      salt: Uint8Array,
      opsLimit: number,
      memLimit: number,
      algorithm: number,
    ): Uint8Array;
    randombytes_buf(length: number): Uint8Array;
    from_string(value: string): Uint8Array;
    to_string(bytes: Uint8Array): string;
    to_base64(bytes: Uint8Array, variant: number): string;
    from_base64(value: string, variant: number): Uint8Array;
    memcmp(left: Uint8Array, right: Uint8Array): boolean;
    memzero(bytes: Uint8Array): void;
  }

  const sodium: Sodium;
  export default sodium;
}
