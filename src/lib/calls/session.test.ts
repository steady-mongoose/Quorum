import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  RoomCallSession,
  type CallPeerConnection,
  type CallRequest,
  type CallStream,
} from "./session.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const sdp = "v=0\r\noffer\r\n";

class FakeConnection implements CallPeerConnection {
  signalingState = "stable";
  connectionState = "new";
  remoteDescription: { type: string } | null = null;
  onicecandidate: CallPeerConnection["onicecandidate"] = null;
  ontrack: CallPeerConnection["ontrack"] = null;
  addTrack(): void {}
  async createOffer() {
    return { type: "offer", sdp };
  }
  async createAnswer() {
    return { type: "answer", sdp: "v=0\r\nanswer\r\n" };
  }
  async setLocalDescription(description?: { type: string; sdp?: string }) {
    if (description?.type === "rollback") {
      this.signalingState = "stable";
      return;
    }
    this.signalingState = description?.type === "offer" ? "have-local-offer" : "stable";
    this.onicecandidate?.({
      candidate: {
        candidate: "candidate:1 1 UDP 1 203.0.113.4 9 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    });
  }
  async setRemoteDescription(description: { type: string }) {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
    if (description.type === "answer") this.connectionState = "connected";
  }
  async addIceCandidate(): Promise<void> {}
  close(): void {
    this.connectionState = "closed";
    this.signalingState = "closed";
  }
}

const localStream: CallStream = { getTracks: () => [{ kind: "audio" }, { kind: "video" }] };

test("the larger id offers, the smaller id answers, and neither records", async () => {
  const box: {
    from: string;
    body: {
      to: string;
      kind: string;
      payload: { type?: string; sdp?: string; candidate?: unknown };
    };
  }[] = [];
  const requestFor =
    (from: string): CallRequest =>
    async (path, init) => {
      if (path.endsWith("/signal") && init.body) {
        box.push({ from, body: init.body as (typeof box)[number]["body"] });
      }
      return { status: 200, body: { ok: true, record: false } };
    };
  let built = 0;
  const make = (selfId: string) =>
    new RoomCallSession({
      roomId: "shop",
      selfId,
      cursor: 0,
      iceServers: [],
      localStream,
      request: requestFor(selfId),
      createConnection: () => {
        built += 1;
        return new FakeConnection();
      },
    });

  const ada = make("ada");
  const bob = make("bob");
  await ada.syncPeers([{ id: "bob", name: "Bob", generation: 1 }]);
  await bob.syncPeers([{ id: "ada", name: "Ada", generation: 1 }]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const offer = box.find((item) => item.from === "bob" && item.body.kind === "offer");
  assert.ok(offer);
  assert.equal(offer.body.payload.sdp?.startsWith("v=0"), true);
  assert.equal(
    box.some((item) => item.from === "ada" && item.body.kind === "offer"),
    false,
  );

  await ada.acceptSignal({ id: 1, from: "bob", kind: "offer", payload: offer.body.payload });
  const answer = box.find((item) => item.from === "ada" && item.body.kind === "answer");
  assert.ok(answer);
  await bob.acceptSignal({
    id: 2,
    from: "ada",
    kind: "answer",
    payload: answer.body.payload,
  });
  const ice = box.find((item) => item.body.kind === "ice");
  assert.ok(ice);

  await bob.syncPeers([{ id: "ada", name: "Ada", generation: 2 }]);
  assert.equal(built, 3);

  let stopped = "";
  const wary = new RoomCallSession({
    roomId: "shop",
    selfId: "ada",
    cursor: 0,
    iceServers: [],
    localStream,
    onStopped: (message) => {
      stopped = message;
    },
    request: async (path) => {
      if (path.endsWith("/leave")) return { status: 200, body: { ok: true, record: false } };
      return {
        status: 200,
        body: {
          record: true,
          peers: [],
          signals: [{ id: 1, from: "bob", kind: "offer", payload: { type: "offer", sdp } }],
          cursor: 1,
        },
      };
    },
    createConnection: () => new FakeConnection(),
  });
  await wary.pollOnce();
  assert.match(stopped, /not recorded/);
  ada.close();
  bob.close();
});

test("a peer who disappears from the roster is disconnected", async () => {
  const connections: FakeConnection[] = [];
  const seen: string[][] = [];
  const session = new RoomCallSession({
    roomId: "shop",
    selfId: "ada",
    cursor: 0,
    iceServers: [],
    localStream,
    onPeers: (peers) => {
      seen.push(peers.map((peer) => peer.id));
    },
    request: async (path) => {
      if (path.includes("?")) {
        return {
          status: 200,
          body: {
            peers: [{ id: "cara", name: "Cara", generation: 1 }],
            signals: [],
            cursor: 1,
            record: false,
          },
        };
      }
      return { status: 200, body: { ok: true, record: false } };
    },
    createConnection: () => {
      const connection = new FakeConnection();
      connections.push(connection);
      return connection;
    },
  });
  await session.syncPeers([
    { id: "bob", name: "Bob", generation: 1 },
    { id: "cara", name: "Cara", generation: 1 },
  ]);
  assert.equal(connections.length, 2);
  await session.pollOnce();
  assert.equal(connections[0]?.connectionState, "closed");
  assert.equal(connections[1]?.connectionState, "new");
  assert.deepEqual(seen.at(-1), ["cara"]);
  session.close();
});

test("the call page and the relay do not record or use a vendor STUN server", () => {
  const files = [
    "src/lib/calls/session.ts",
    "src/lib/calls/ice.ts",
    "src/components/board/room-call.tsx",
    "server/calls/routes.ts",
    "server/calls/store.ts",
    "deploy/coturn.sh",
    "deploy/docker-compose.yml",
  ];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const banned of ["MediaRecorder", "getDisplayMedia", "stun.l.google.com", "recordRtc"]) {
      assert.equal(text.includes(banned), false, `${file} mentions ${banned}`);
    }
  }
});
