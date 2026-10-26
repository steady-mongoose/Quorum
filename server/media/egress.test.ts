import assert from "node:assert/strict";
import { connect, createServer } from "node:net";
import test from "node:test";
import { egressTarget, startEgressProxy } from "./egress.ts";

test("the proxy requires the storage host", () => {
  assert.throws(() => egressTarget({}), /storage hostname/);
  assert.deepEqual(egressTarget({ MEDIA_S3_HOST: "media.example", MEDIA_S3_PORT: "443" }), {
    host: "media.example",
    port: 443,
  });
  assert.equal(
    egressTarget({ EGRESS_ALLOW_HOST: "storage-sink", EGRESS_ALLOW_PORT: "9000" }).host,
    "storage-sink",
  );
});

test("the proxy forwards to the allowed host and no other port is involved", async () => {
  const sink = createServer((socket) => {
    socket.on("data", (chunk) => {
      if (chunk.toString("utf8").includes("ping")) socket.end("pong");
    });
  });
  await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
  const address = sink.address();
  if (!address || typeof address === "string") throw new Error("sink did not listen");
  const proxy = await startEgressProxy({ host: "127.0.0.1", port: address.port }, 0);
  const proxyAddress = proxy.address();
  if (!proxyAddress || typeof proxyAddress === "string") throw new Error("proxy did not listen");
  const reply = await new Promise<string>((resolve, reject) => {
    const socket = connect(proxyAddress.port, "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("connect", () => socket.write("ping"));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
  assert.equal(reply, "pong");
  proxy.close();
  sink.close();
});
