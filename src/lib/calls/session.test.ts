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
  assert.equal(
    stopped,
    "This call tried to start recording, so you left it. Avouch Social calls are never recorded.",
  );
  let stoppedOdd = "";
  const odd = new RoomCallSession({
    roomId: "shop",
    selfId: "ada",
    cursor: 0,
    iceServers: [],
    localStream,
    onStopped: (message) => {
      stoppedOdd = message;
    },
    request: async (path) => {
      if (path.endsWith("/leave")) return { status: 200, body: { ok: true, record: false } };
      return {
        status: 200,
        body: {
          peers: [],
          signals: [{ id: 1, from: "bob", kind: "offer", payload: { type: "offer", sdp } }],
          cursor: 1,
        },
      };
    },
    createConnection: () => new FakeConnection(),
  });
  await odd.pollOnce();
  assert.equal(stoppedOdd, "The call stopped because of a problem on our end. Try joining again.");
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

function scripted(polls: unknown[], posted: string[]): CallRequest {
  return async (path) => {
    if (!path.includes("?")) {
      posted.push(path);
      return { status: 200, body: { ok: true, record: false } };
    }
    return {
      status: 200,
      body: polls.shift() ?? { peers: [], signals: [], cursor: 0, record: false },
    };
  };
}

test("the other person hanging up ends the call on this side too", async () => {
  const posted: string[] = [];
  const ended: string[] = [];
  const session = new RoomCallSession({
    roomId: "dm:t",
    basePath: "/api/calls/dm/t",
    selfId: "ada",
    cursor: 0,
    iceServers: [],
    localStream,
    onEnded: (message) => ended.push(message),
    request: scripted([{ peers: [], signals: [], cursor: 0, record: false }], posted),
    createConnection: () => new FakeConnection(),
  });
  await session.syncPeers([{ id: "ben", name: "Ben", generation: 1 }]);
  await session.pollOnce();
  assert.deepEqual(ended, ["Ben left. The call ended."]);
  assert.ok(posted.includes("/api/calls/dm/t/leave"), "this side leaves cleanly");
  await session.pollOnce();
  assert.equal(ended.length, 1, "told once");
});

test("waiting alone is not an ended call; a decline is", async () => {
  const posted: string[] = [];
  const ended: string[] = [];
  const session = new RoomCallSession({
    roomId: "dm:t",
    basePath: "/api/calls/dm/t",
    selfId: "ada",
    cursor: 0,
    iceServers: [],
    localStream,
    onEnded: (message) => ended.push(message),
    request: scripted(
      [
        { peers: [], signals: [], cursor: 0, record: false },
        {
          peers: [],
          signals: [],
          cursor: 0,
          rings: [{ kind: "declined", to: "ben", name: "Ben" }],
          record: false,
        },
      ],
      posted,
    ),
    createConnection: () => new FakeConnection(),
  });
  await session.syncPeers([]);
  await session.pollOnce();
  assert.deepEqual(ended, [], "still ringing");
  await session.pollOnce();
  assert.deepEqual(ended, ["Ben declined the call."]);
  assert.ok(posted.includes("/api/calls/dm/t/leave"));
});

test("a room ring nobody answers ends the call once no ring is left out", async () => {
  const ended: string[] = [];
  const session = new RoomCallSession({
    roomId: "shop",
    selfId: "host",
    cursor: 0,
    iceServers: [],
    localStream,
    onEnded: (message) => ended.push(message),
    request: scripted(
      [
        {
          peers: [],
          signals: [],
          cursor: 0,
          rings: [{ kind: "missed", name: "Ada" }],
          record: false,
        },
      ],
      [],
    ),
    createConnection: () => new FakeConnection(),
  });
  await session.pollOnce();
  assert.deepEqual(ended, ["Ada didn't answer."]);
});

test("in a room call with others still there, a leave or decline is a note, not the end", async () => {
  const ended: string[] = [];
  const notes: string[] = [];
  const session = new RoomCallSession({
    roomId: "shop",
    selfId: "ada",
    cursor: 0,
    iceServers: [],
    localStream,
    onEnded: (message) => ended.push(message),
    onNote: (message) => notes.push(message),
    request: scripted(
      [
        {
          peers: [{ id: "cara", name: "Cara", generation: 1 }],
          signals: [],
          cursor: 0,
          rings: [{ kind: "declined", name: "Dan" }],
          record: false,
        },
      ],
      [],
    ),
    createConnection: () => new FakeConnection(),
  });
  await session.syncPeers([
    { id: "bob", name: "Bob", generation: 1 },
    { id: "cara", name: "Cara", generation: 1 },
  ]);
  await session.pollOnce();
  assert.deepEqual(ended, []);
  assert.deepEqual(notes, ["Bob left the call.", "Dan declined the call."]);
  session.close();
});

test("S2: a room call alone stays open through a decline while another ring is out", async () => {
  const posted: string[] = [];
  const ended: string[] = [];
  const notes: string[] = [];
  const seen: string[] = [];
  const session = new RoomCallSession({
    roomId: "shop",
    selfId: "host",
    cursor: 0,
    iceServers: [],
    localStream,
    onEnded: (message) => ended.push(message),
    onNote: (message) => notes.push(message),
    onOutcome: (o) => seen.push(`${o.kind}:${o.name}`),
    request: scripted(
      [
        {
          peers: [],
          signals: [],
          cursor: 0,
          rings: [{ kind: "declined", name: "Ben" }],
          ringsOut: true,
          record: false,
        },
        {
          peers: [],
          signals: [],
          cursor: 0,
          rings: [{ kind: "missed", name: "Eve" }],
          ringsOut: false,
          record: false,
        },
      ],
      posted,
    ),
    createConnection: () => new FakeConnection(),
  });
  await session.pollOnce();
  assert.deepEqual(ended, [], "Eve is still being rung, so the call stays open");
  assert.deepEqual(notes, ["Ben declined the call."]);
  assert.equal(
    posted.includes("/api/calls/rooms/shop/leave"),
    false,
    "no leave, so Eve's ring stays",
  );
  await session.pollOnce();
  assert.deepEqual(ended, ["Eve didn't answer."], "every ring resolved, nobody else here");
  assert.deepEqual(seen, ["declined:Ben", "missed:Eve"]);
});

test("S2: a room call where the last person leaves stays open while a ring is out", async () => {
  const ended: string[] = [];
  const notes: string[] = [];
  const session = new RoomCallSession({
    roomId: "shop",
    selfId: "host",
    cursor: 0,
    iceServers: [],
    localStream,
    onEnded: (message) => ended.push(message),
    onNote: (message) => notes.push(message),
    request: scripted([{ peers: [], signals: [], cursor: 0, ringsOut: true, record: false }], []),
    createConnection: () => new FakeConnection(),
  });
  await session.syncPeers([{ id: "ben", name: "Ben", generation: 1 }]);
  await session.pollOnce();
  assert.deepEqual(ended, []);
  assert.deepEqual(notes, ["Ben left the call."]);
  session.close();
});

test("a DM call alone ends on a decline even if the server says a ring is out", async () => {
  const ended: string[] = [];
  const session = new RoomCallSession({
    roomId: "dm:t",
    basePath: "/api/calls/dm/t",
    selfId: "ada",
    cursor: 0,
    iceServers: [],
    localStream,
    onEnded: (message) => ended.push(message),
    request: scripted(
      [
        {
          peers: [],
          signals: [],
          cursor: 0,
          rings: [{ kind: "declined", name: "Ben" }],
          ringsOut: true,
          record: false,
        },
      ],
      [],
    ),
    createConnection: () => new FakeConnection(),
  });
  await session.pollOnce();
  assert.deepEqual(ended, ["Ben declined the call."]);
});
