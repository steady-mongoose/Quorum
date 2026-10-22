import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createCredentialAccount, createSignIn, readSessionUser } from "./accounts.ts";
import { createClosedAuth } from "./auth.ts";
import { readHostConfig, type HostConfig } from "./config.ts";
import { createPool, pgDb } from "./db.ts";
import { createApp } from "./http.ts";
import { readCallsConfig } from "./calls/config.ts";
import { bindCallEviction } from "./calls/evict.ts";
import { createCallStore } from "./calls/store.ts";
import { readMediaConfig } from "./media/config.ts";
import { storeFromConfig } from "./media/s3.ts";
import { startHoldSweep } from "./board/csam.ts";
import { CLIENT_IP_HEADER, resolveIncoming } from "./proxy.ts";

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

async function toRequest(req: IncomingMessage, config: HostConfig): Promise<Request> {
  const target = resolveIncoming({
    remoteAddress: req.socket.remoteAddress,
    trustedProxies: config.trustedProxies,
    forwardedFor: headerValue(req, "x-forwarded-for"),
    baseURL: config.baseURL,
    path: req.url ?? "/",
  });
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  headers.delete(CLIENT_IP_HEADER);
  headers.delete("x-forwarded-proto");
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-for");
  headers.set(CLIENT_IP_HEADER, target.clientIp);
  const method = req.method ?? "GET";
  const chunks: Buffer[] = [];
  if (method !== "GET" && method !== "HEAD") {
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  return new Request(target.url, { method, headers, body });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
  const bytes = Buffer.from(await response.arrayBuffer());
  res.end(bytes);
}

/** Dedicated-box API. Does not apply migrations. */
export function startHost(): void {
  const config = readHostConfig();
  const pool = createPool(config.databaseUrl);
  const auth = createClosedAuth({
    database: pool,
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.origins,
  });
  const now = () => new Date();
  const mediaConfig = readMediaConfig();
  const mediaStore = storeFromConfig(mediaConfig);
  startHoldSweep(pgDb(pool), mediaStore);
  console.log(
    JSON.stringify({
      event: "media-storage",
      enabled: mediaConfig.enabled,
      video: mediaConfig.enabled && mediaConfig.video,
    }),
  );
  const callsConfig = readCallsConfig();
  const callStore = createCallStore();
  bindCallEviction(callStore);
  console.log(
    JSON.stringify({
      event: "room-calls",
      enabled: callsConfig.enabled,
      stun: callsConfig.enabled && callsConfig.stunUrls.length > 0,
      turn: callsConfig.enabled && callsConfig.turnUrls.length > 0,
      reason: callsConfig.enabled ? undefined : callsConfig.reason,
    }),
  );
  const app = createApp({
    db: pgDb(pool),
    origins: config.origins,
    now,
    createAccount: createCredentialAccount(),
    signIn: createSignIn(auth, config.baseURL),
    readSession: (headers) => readSessionUser(auth, headers),
    forwardAuth: (request) => auth.handler(request),
    media: { config: mediaConfig, store: mediaStore, now },
    calls: { config: callsConfig, store: callStore, now },
  });
  const server = createServer(async (req, res) => {
    try {
      await send(res, await app(await toRequest(req, config)));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "request-failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "The server could not finish that." }));
      }
    }
  });
  server.listen(config.port, "0.0.0.0", () => {
    console.log(JSON.stringify({ event: "api-listen", port: config.port }));
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"));
if (isMain) {
  try {
    startHost();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
