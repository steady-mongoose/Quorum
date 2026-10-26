/** The smaller id is polite and yields when both sides offer at once. */
export function isPolitePeer(selfId: string, remoteId: string): boolean {
  return selfId < remoteId;
}

export type Negotiation = {
  makingOffer: boolean;
  signalingState: string;
  polite: boolean;
};

export function offerCollision(state: Negotiation): boolean {
  if (state.signalingState === "closed") return false;
  return state.makingOffer || state.signalingState !== "stable";
}

/** The impolite peer keeps its own offer and drops the remote one. */
export function ignoreRemoteOffer(state: Negotiation): boolean {
  if (state.signalingState === "closed") return true;
  return offerCollision(state) && !state.polite;
}

/** The polite peer rolls its local offer back and accepts the remote one. */
export function needsRollback(state: Negotiation): boolean {
  if (state.signalingState === "closed") return false;
  return offerCollision(state) && state.polite;
}
