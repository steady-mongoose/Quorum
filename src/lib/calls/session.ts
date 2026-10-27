import { apiFetch } from "../api-base.ts";
import { MALFORMED_LEFT, RECORDING_LEFT } from "./media.ts";
import { ignoreRemoteOffer, isPolitePeer, needsRollback } from "./negotiate.ts";
import {
  parseCallJoin,
  parseCallPoll,
  claimsRecording,
  refusesRecording,
  type CallIceServer,
  type CallPeerRow,
  type CallWire,
} from "./status.ts";

export type CallTrack = { kind: string };
export type CallStream = { getTracks(): CallTrack[] };

type IceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
};

export interface CallPeerConnection {
  signalingState: string;
  connectionState: string;
  remoteDescription: { type: string } | null;
  onicecandidate: ((event: { candidate: IceCandidate | null }) => void) | null;
  ontrack: ((event: { streams: CallStream[] }) => void) | null;
  addTrack(track: CallTrack, stream: CallStream): void;
  createOffer(): Promise<{ type: string; sdp: string }>;
  createAnswer(): Promise<{ type: string; sdp: string }>;
  setLocalDescription(description?: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(description: { type: string; sdp?: string }): Promise<void>;
  addIceCandidate(candidate: IceCandidate): Promise<void>;
  setConfiguration?: (config: { iceServers: CallIceServer[] }) => void;
  getSenders?: () => Array<{
    track: { kind: string } | null;
    getParameters: () => { encodings?: Array<{ maxBitrate?: number; maxFramerate?: number }> };
    setParameters: (params: {
      encodings?: Array<{ maxBitrate?: number; maxFramerate?: number }>;
    }) => Promise<void>;
  }>;
  close(): void;
}

export type CallRequest = (
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
) => Promise<{ status: number; body: unknown }>;

export type RemotePeer = {
  id: string;
  name: string;
  connectionState: string;
  stream: CallStream | null;
};

type Slot = {
  id: string;
  name: string;
  generation: number;
  polite: boolean;
  makingOffer: boolean;
  pc: CallPeerConnection;
  pending: IceCandidate[];
  stream: CallStream | null;
};

async function apiRequest(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const response = await apiFetch(path, {
    method: init.method,
    credentials: "include",
    cache: "no-store",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    keepalive: path.endsWith("/leave"),
  });
  const body = (await response.json().catch(() => null)) as unknown;
  return { status: response.status, body };
}

function browserConnection(iceServers: CallIceServer[]): CallPeerConnection {
  const pc = new RTCPeerConnection({
    iceServers: iceServers as RTCIceServer[],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  });
  return pc as unknown as CallPeerConnection;
}

function descriptionFrom(payload: Record<string, unknown>, kind: "offer" | "answer") {
  if (payload.type !== kind || typeof payload.sdp !== "string" || !payload.sdp.startsWith("v=0")) {
    return null;
  }
  return { type: kind, sdp: payload.sdp };
}

function iceFrom(payload: Record<string, unknown>): IceCandidate | null {
  const candidate = payload.candidate;
  if (typeof candidate === "string" && candidate) return { candidate };
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const row = candidate as { candidate?: unknown; sdpMid?: unknown; sdpMLineIndex?: unknown };
  if (typeof row.candidate !== "string" || !row.candidate) return null;
  return {
    candidate: row.candidate,
    sdpMid: typeof row.sdpMid === "string" ? row.sdpMid : null,
    sdpMLineIndex: typeof row.sdpMLineIndex === "number" ? row.sdpMLineIndex : null,
  };
}

/**
 * One peer connection per other person in the room. The larger id offers.
 * Media stays in the browser. This object never records.
 */
type RoomCallOptions = {
  roomId: string;
  /** Defaults to `/api/calls/rooms/{roomId}`. DM calls pass `/api/calls/dm/{threadId}`. */
  basePath?: string;
  selfId: string;
  cursor: number;
  iceServers: CallIceServer[];
  localStream: CallStream;
  request?: CallRequest;
  createConnection?: (iceServers: CallIceServer[]) => CallPeerConnection;
  onPeers?: (peers: RemotePeer[]) => void;
  onStopped?: (message: string) => void;
};

export class RoomCallSession {
  private readonly slots = new Map<string, Slot>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly opts: RoomCallOptions;
  private cursor: number;
  private iceServers: CallIceServer[];
  private closed = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly base: string;

  constructor(opts: RoomCallOptions) {
    this.opts = opts;
    this.base = opts.basePath ?? `/api/calls/rooms/${opts.roomId}`;
    this.cursor = opts.cursor;
    this.iceServers = opts.iceServers;
  }

  async syncPeers(peers: CallPeerRow[]): Promise<void> {
    const seen = new Set<string>();
    const opening: Promise<void>[] = [];
    for (const peer of peers) {
      if (peer.id === this.opts.selfId) continue;
      seen.add(peer.id);
      const slot = this.slots.get(peer.id);
      if (slot && slot.generation === peer.generation) {
        slot.name = peer.name;
        continue;
      }
      if (slot) this.drop(peer.id);
      opening.push(this.enqueue(peer.id, () => this.openPeer(peer)));
    }
    for (const id of [...this.slots.keys()]) {
      if (!seen.has(id)) this.drop(id);
    }
    await Promise.all(opening);
    this.emit();
  }

  async acceptSignal(signal: CallWire): Promise<void> {
    await this.enqueue(signal.from, () => this.applySignal(signal));
  }

  start(): void {
    const loop = () => {
      if (this.closed) return;
      void this.pollOnce().finally(() => {
        if (this.closed) return;
        this.timer = setTimeout(loop, this.delay());
      });
    };
    this.timer = setTimeout(loop, 400);
  }

  async pollOnce(): Promise<void> {
    if (this.closed) return;
    try {
      const response = await this.request(`${this.base}?since=${this.cursor}`, { method: "GET" });
      if (this.closed) return;
      if (this.badRecording(response.body)) return;
      if (response.status === 409) {
        await this.rejoin();
        return;
      }
      if (response.status === 401 || response.status === 403) {
        this.fail(
          this.opts.basePath ? "You can't join this call." : "You have not stood in that room.",
        );
        return;
      }
      if (response.status >= 400) return;
      const parsed = parseCallPoll(response.body);
      if (!parsed) {
        this.fail("The call server sent something this page will not use.");
        return;
      }
      if (parsed.iceServers) this.applyIce(parsed.iceServers);
      await this.syncPeers(parsed.peers);
      for (const signal of parsed.signals) await this.acceptSignal(signal);
      this.cursor = parsed.cursor;
      this.emit();
    } catch {
      // The next poll tries again. The call is not stored anywhere.
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const id of [...this.slots.keys()]) this.drop(id);
    void this.request(`${this.base}/leave`, {
      method: "POST",
      body: {},
    }).catch(() => undefined);
  }

  private request(path: string, init: { method: "GET" | "POST"; body?: unknown }) {
    return (this.opts.request ?? apiRequest)(path, init);
  }

  private createConnection(iceServers: CallIceServer[]) {
    return (this.opts.createConnection ?? browserConnection)(iceServers);
  }

  private delay(): number {
    for (const slot of this.slots.values()) {
      if (slot.pc.connectionState !== "connected") return 500;
    }
    return 2000;
  }

  private enqueue(id: string, task: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const reported = prev.then(task, task);
    this.chains.set(
      id,
      reported.then(
        () => undefined,
        () => undefined,
      ),
    );
    return reported;
  }

  private async openPeer(peer: CallPeerRow): Promise<void> {
    if (this.closed) return;
    const pc = this.createConnection(this.iceServers);
    const slot: Slot = {
      id: peer.id,
      name: peer.name,
      generation: peer.generation,
      polite: isPolitePeer(this.opts.selfId, peer.id),
      makingOffer: false,
      pc,
      pending: [],
      stream: null,
    };
    this.slots.set(peer.id, slot);
    pc.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (!candidate?.candidate) return;
      void this.enqueue(peer.id, () =>
        this.postSignal(peer.id, "ice", {
          candidate: {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          },
        }),
      );
    };
    pc.ontrack = (event) => {
      slot.stream = event.streams[0] ?? null;
      this.emit();
    };
    for (const track of this.opts.localStream.getTracks())
      pc.addTrack(track, this.opts.localStream);
    if (!slot.polite) await this.sendOffer(slot);
  }

  private async sendOffer(slot: Slot): Promise<void> {
    slot.makingOffer = true;
    try {
      const offer = await slot.pc.createOffer();
      await slot.pc.setLocalDescription(offer);
      await this.capVideo(slot.pc);
      await this.postSignal(slot.id, "offer", { type: "offer", sdp: offer.sdp });
    } finally {
      slot.makingOffer = false;
    }
  }

  private async applySignal(signal: CallWire): Promise<void> {
    const slot = this.slots.get(signal.from);
    if (!slot || this.closed) return;
    if (signal.kind === "ice") {
      const candidate = iceFrom(signal.payload);
      if (!candidate) return;
      if (!slot.pc.remoteDescription) {
        slot.pending.push(candidate);
        return;
      }
      try {
        await slot.pc.addIceCandidate(candidate);
      } catch {
        // A candidate can belong to a description that was rolled back.
      }
      return;
    }
    if (signal.kind === "offer") {
      const description = descriptionFrom(signal.payload, "offer");
      if (!description) return;
      const state = {
        makingOffer: slot.makingOffer,
        signalingState: slot.pc.signalingState,
        polite: slot.polite,
      };
      if (ignoreRemoteOffer(state)) return;
      if (needsRollback(state)) await slot.pc.setLocalDescription({ type: "rollback" });
      await slot.pc.setRemoteDescription(description);
      await this.flush(slot);
      const answer = await slot.pc.createAnswer();
      await slot.pc.setLocalDescription(answer);
      await this.capVideo(slot.pc);
      await this.postSignal(slot.id, "answer", { type: "answer", sdp: answer.sdp });
      return;
    }
    const description = descriptionFrom(signal.payload, "answer");
    if (!description || slot.pc.signalingState !== "have-local-offer") return;
    await slot.pc.setRemoteDescription(description);
    await this.flush(slot);
  }

  private async flush(slot: Slot): Promise<void> {
    const queued = slot.pending.splice(0);
    for (const candidate of queued) {
      try {
        await slot.pc.addIceCandidate(candidate);
      } catch {
        // Ignore a candidate for a description we no longer have.
      }
    }
  }

  private async capVideo(pc: CallPeerConnection): Promise<void> {
    if (!pc.getSenders) return;
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const params = sender.getParameters();
      const encodings = params.encodings && params.encodings.length > 0 ? params.encodings : [{}];
      encodings[0] = { ...encodings[0], maxBitrate: 500_000, maxFramerate: 20 };
      try {
        await sender.setParameters({ encodings });
      } catch {
        // Some browsers refuse the cap until the connection is up.
      }
    }
  }

  private async postSignal(
    to: string,
    kind: "offer" | "answer" | "ice",
    payload: unknown,
  ): Promise<void> {
    if (this.closed) return;
    const response = await this.request(`${this.base}/signal`, {
      method: "POST",
      body: { to, kind, payload },
    });
    if (this.badRecording(response.body)) return;
    if (response.status === 409) this.drop(to);
  }

  private async rejoin(): Promise<void> {
    const response = await this.request(`${this.base}/join`, {
      method: "POST",
      body: {},
    });
    if (this.badRecording(response.body)) return;
    if (response.status === 429) return;
    if (response.status === 401 || response.status === 403) {
      this.fail(
        this.opts.basePath ? "You can't join this call." : "You have not stood in that room.",
      );
      return;
    }
    const parsed = parseCallJoin(response.body);
    if (!parsed || parsed.selfId !== this.opts.selfId) {
      this.fail("The call server sent something this page will not use.");
      return;
    }
    this.cursor = parsed.cursor;
    this.applyIce(parsed.iceServers);
    await this.syncPeers(parsed.peers);
  }

  private credentialExpiry(servers: CallIceServer[]): number {
    let expiry = 0;
    for (const server of servers) {
      const stamp = Number(server.username?.split(":")[0]);
      if (Number.isFinite(stamp)) expiry = Math.max(expiry, stamp);
    }
    return expiry;
  }

  /** New peers use the latest servers. An open connection is updated once its password is inside the last 15 minutes. */
  private applyIce(next: CallIceServer[]): void {
    const currentExpiry = this.credentialExpiry(this.iceServers);
    const nextExpiry = this.credentialExpiry(next);
    this.iceServers = next;
    const nowSec = Date.now() / 1000;
    if (nextExpiry <= currentExpiry) return;
    if (currentExpiry > 0 && currentExpiry - nowSec > 15 * 60) return;
    for (const slot of this.slots.values()) {
      slot.pc.setConfiguration?.({ iceServers: next });
    }
  }

  private badRecording(body: unknown): boolean {
    if (!refusesRecording(body)) return false;
    this.fail(claimsRecording(body) ? RECORDING_LEFT : MALFORMED_LEFT);
    return true;
  }

  private fail(message: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.opts.onStopped?.(message);
    this.close();
  }

  private drop(id: string): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.pc.onicecandidate = null;
    slot.pc.ontrack = null;
    slot.pc.close();
    this.slots.delete(id);
  }

  private emit(): void {
    this.opts.onPeers?.(
      [...this.slots.values()].map((slot) => ({
        id: slot.id,
        name: slot.name,
        connectionState: slot.pc.connectionState,
        stream: slot.stream,
      })),
    );
  }
}
