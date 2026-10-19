import { KEY_ENVELOPE_MAX } from "./limits.ts";

/**
 * End-to-end pictures and video for direct messages.
 *
 * A separate messaging change owns the private keys. This file is the boundary
 * it should implement. Register that implementation with `registerDmMediaCrypto`.
 * Until one is registered, the page does not send pictures in messages.
 *
 * What that change needs to do:
 * 1. Strip location and EXIF on the device before encryption. `stripImageMetadata`
 *    does that for pictures. Video metadata has to be removed on the device too.
 *    This server cannot read ciphertext, so the media worker does not transcode it.
 * 2. Encrypt the bytes with a content key, then wrap that key for the other member.
 * 3. Put the wrapped key in `keyEnvelope`, an opaque string of at most
 *    {@link KEY_ENVELOPE_MAX} characters. This server stores that string and
 *    returns it. It does not parse it.
 * 4. Upload through `uploadDmCipher`. The bytes on the wire are
 *    `application/octet-stream`. The size and the declared type still have to
 *    fit the server limits.
 * 5. On read, `GET /api/media/:id` returns a short-lived signed URL plus the
 *    same `keyEnvelope`, and only to the two members on the row. Download the
 *    ciphertext and call `open`.
 *
 * Room pictures do not use this. The server strips those and makes a thumbnail.
 */
export { KEY_ENVELOPE_MAX };

export type DmMediaSealInput = {
  bytes: Uint8Array;
  kind: "image" | "video";
  contentType: string;
  peerUserId: string;
};

export type DmMediaSealed = {
  ciphertext: Uint8Array;
  keyEnvelope: string;
};

export type DmMediaCrypto = {
  seal(input: DmMediaSealInput): Promise<DmMediaSealed>;
  open(input: {
    ciphertext: Uint8Array;
    keyEnvelope: string;
    peerUserId: string;
  }): Promise<Uint8Array>;
};

let current: DmMediaCrypto | null = null;

export function registerDmMediaCrypto(crypto: DmMediaCrypto): void {
  current = crypto;
}

export function getDmMediaCrypto(): DmMediaCrypto | null {
  return current;
}

/** Tests reset the registry. The messaging change does not need this. */
export function clearDmMediaCrypto(): void {
  current = null;
}
