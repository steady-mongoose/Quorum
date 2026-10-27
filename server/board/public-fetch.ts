import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { blockedAddress, pageTarget, type PageTarget } from "../../src/lib/board/public-page.ts";

const PAGE_ERROR = "The page did not show the code.";
const PAGE_CAP = 65_536;

export type AddressRecord = { address: string; family: 4 | 6 };

export type PageLookup = (hostname: string) => Promise<AddressRecord[]>;

export type PinnedRequest = PageTarget & { address: string; family: 4 | 6 };

export type PageResponse = {
  status: number;
  headers: { get(name: string): string | null };
  body: Uint8Array | null;
  tooBig?: boolean;
};

export type PageRequest = (target: PinnedRequest) => Promise<PageResponse>;

export async function dnsAddresses(hostname: string): Promise<AddressRecord[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
}

export async function pinAddress(
  hostname: string,
  lookupFn: PageLookup,
): Promise<{ ok: true; address: string; family: 4 | 6 } | { ok: false; error: string }> {
  if (isIP(hostname)) {
    if (blockedAddress(hostname)) return { ok: false, error: PAGE_ERROR };
    return { ok: true, address: hostname, family: isIP(hostname) === 6 ? 6 : 4 };
  }
  let records: AddressRecord[] = [];
  try {
    records = await lookupFn(hostname);
  } catch {
    return { ok: false, error: PAGE_ERROR };
  }
  if (records.length === 0 || records.some((record) => blockedAddress(record.address))) {
    return { ok: false, error: PAGE_ERROR };
  }
  const first = records[0];
  if (!first) return { ok: false, error: PAGE_ERROR };
  return { ok: true, address: first.address, family: first.family };
}

function hostHeader(hostname: string, port: number): string {
  const shown = hostname.includes(":") ? `[${hostname}]` : hostname;
  if (port === 80 || port === 443) return shown;
  return `${shown}:${port}`;
}

function headerGet(message: http.IncomingMessage): { get(name: string): string | null } {
  return {
    get(name: string) {
      const value = message.headers[name.toLowerCase()];
      if (Array.isArray(value)) return value[0] ?? null;
      return value ?? null;
    },
  };
}

function defaultRequest(target: PinnedRequest): Promise<PageResponse> {
  const lib = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: PageResponse) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = lib.request(
      {
        host: target.address,
        port: target.port,
        method: "GET",
        path: target.path,
        servername: isIP(target.hostname) ? undefined : target.hostname,
        headers: {
          accept: "text/html, text/plain",
          host: hostHeader(target.hostname, target.port),
        },
        timeout: 4_000,
      },
      (message) => {
        const chunks: Buffer[] = [];
        let received = 0;
        message.on("data", (chunk: Buffer) => {
          received += chunk.byteLength;
          if (received > PAGE_CAP) {
            message.destroy();
            finish({
              status: message.statusCode ?? 0,
              headers: headerGet(message),
              body: null,
              tooBig: true,
            });
            return;
          }
          chunks.push(chunk);
        });
        message.on("end", () => {
          finish({
            status: message.statusCode ?? 0,
            headers: headerGet(message),
            body: Buffer.concat(chunks),
          });
        });
        message.on("error", (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    req.end();
  });
}

async function refuseRedirect(
  location: string,
  base: string,
  lookupFn: PageLookup,
): Promise<{ ok: false; error: string }> {
  let next: URL;
  try {
    next = new URL(location, base);
  } catch {
    return { ok: false, error: PAGE_ERROR };
  }
  const target = pageTarget(next.href);
  if (!target.ok) return target;
  return pinAddress(target.target.hostname, lookupFn).then((pinned) =>
    pinned.ok ? { ok: false, error: PAGE_ERROR } : pinned,
  );
}

/**
 * Fetch one public page. DNS is resolved here, private answers are refused,
 * and the connection uses the address that was checked. Redirects are not followed.
 */
export async function readPublicPage(
  url: string,
  deps: { lookup?: PageLookup; request?: PageRequest } = {},
): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  const target = pageTarget(url);
  if (!target.ok) return target;
  const lookupFn = deps.lookup ?? dnsAddresses;
  const pinned = await pinAddress(target.target.hostname, lookupFn);
  if (!pinned.ok) return pinned;
  try {
    const response = await (deps.request ?? defaultRequest)({
      ...target.target,
      address: pinned.address,
      family: pinned.family,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) return refuseRedirect(location, url, lookupFn);
      return { ok: false, error: PAGE_ERROR };
    }
    if (response.tooBig || response.status < 200 || response.status >= 300 || !response.body) {
      return { ok: false, error: PAGE_ERROR };
    }
    return { ok: true, body: new TextDecoder().decode(response.body) };
  } catch {
    return { ok: false, error: PAGE_ERROR };
  }
}
