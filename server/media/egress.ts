import { createServer, Socket, type Server } from "node:net";

export type EgressTarget = { host: string; port: number };

/**
 * The only host the media proxy will open. Everything else has no route
 * because the worker network is internal.
 */
export function egressTarget(env: NodeJS.ProcessEnv): EgressTarget {
  const host = (env.EGRESS_ALLOW_HOST?.trim() || env.MEDIA_S3_HOST?.trim() || "").replace(
    /\.$/,
    "",
  );
  const port = Number(env.EGRESS_ALLOW_PORT?.trim() || env.MEDIA_S3_PORT?.trim() || "443");
  if (!host || host.includes("/") || host.includes(" ")) {
    throw new Error("Set MEDIA_S3_HOST to the storage hostname before starting the media proxy.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Set MEDIA_S3_PORT to the storage port before starting the media proxy.");
  }
  return { host, port };
}

function pipe(left: Socket, right: Socket): void {
  left.on("error", () => right.destroy());
  right.on("error", () => left.destroy());
  left.pipe(right);
  right.pipe(left);
}

/** TCP forwarder. It dials one host and one port, and no other destination. */
export function startEgressProxy(target: EgressTarget, listenPort = target.port): Promise<Server> {
  const server = createServer((client) => {
    const upstream = new Socket();
    upstream.connect(target.port, target.host);
    upstream.once("connect", () => pipe(client, upstream));
    upstream.once("error", () => client.destroy());
    client.once("error", () => upstream.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "0.0.0.0", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
