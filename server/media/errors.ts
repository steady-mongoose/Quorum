/** A permanent media failure. The worker does not retry these. */
export class MediaReject extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaReject";
  }
}
