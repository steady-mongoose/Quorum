import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createAccountFactory, readSessionUser } from "./accounts.ts";
import { createClosedAuth } from "./auth.ts";
import { readHostConfig } from "./config.ts";
import { createPool, pgDb } from "./db.ts";
import { createApp } from "./http.ts";

async function toRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "127.0.0.1";
  const proto =
    String(req.headers["x-forwarded-proto"] ?? "http")
      .split(",")[0]
      ?.trim() || "http";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  const method = req.method ?? "GET";
  const chunks: Buffer[] = [];
  if (method !== "GET" && method !== "HEAD") {
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  return new Request(`${proto}://${host}${req.url ?? "/"}`, { method, headers, body });
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
  const app = createApp({
    db: pgDb(pool),
    origins: config.origins,
    now: () => new Date(),
    createUser: createAccountFactory(auth, config.baseURL, "invite"),
    readSession: (headers) => readSessionUser(auth, headers),
    forwardAuth: (request) => auth.handler(request),
  });
  const server = createServer(async (req, res) => {
    try {
      await send(res, await app(await toRequest(req)));
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
