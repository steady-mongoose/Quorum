import { createHash, createHmac } from "node:crypto";
import type { MediaConfig } from "./config.ts";

export type PresignInput = {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  endpoint: string;
  bucket: string;
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresIn: number;
  now: Date;
  forcePathStyle: boolean;
  contentType?: string;
  /** Signed on PUT so the browser cannot send a larger body. */
  contentLength?: number;
  /** Signed response overrides for GET. The object itself is private. */
  responseContentType?: string;
  responseContentDisposition?: string;
  responseCacheControl?: string;
};

export type SignedRequest = {
  url: string;
  headers: Record<string, string>;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

export function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

/** Encode one path segment or query value the way SigV4 requires. */
export function awsUriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => awsUriEncode(segment))
    .join("/");
}

function amzDates(now: Date): { amz: string; stamp: string } {
  const amz = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return { amz, stamp: amz.slice(0, 8) };
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${awsUriEncode(key)}=${awsUriEncode(params[key] ?? "")}`)
    .join("&");
}

export function canonicalRequest(input: {
  method: string;
  canonicalUri: string;
  query: string;
  headers: Array<[string, string]>;
  signedHeaders: string;
}): string {
  const headerBlock = input.headers.map(([name, value]) => `${name}:${value}\n`).join("");
  return [
    input.method,
    input.canonicalUri,
    input.query,
    headerBlock,
    input.signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
}

/**
 * Query-string SigV4 for an S3-compatible store. PUT signs content-type and
 * content-length, so a client cannot swap the type or send a larger body.
 * GET signs the response type, attachment disposition, and no-store cache.
 */
export function presignRequest(input: PresignInput): SignedRequest {
  const endpoint = new URL(input.endpoint);
  const { amz, stamp } = amzDates(input.now);
  const host = input.forcePathStyle ? endpoint.host : `${input.bucket}.${endpoint.host}`;
  const canonicalUri = input.forcePathStyle
    ? `/${encodeKey(input.bucket)}/${encodeKey(input.key)}`
    : `/${encodeKey(input.key)}`;
  const scope = `${stamp}/${input.region}/s3/aws4_request`;
  const headers: Array<[string, string]> = [];
  if (input.contentLength !== undefined)
    headers.push(["content-length", String(input.contentLength)]);
  if (input.contentType && input.method !== "GET")
    headers.push(["content-type", input.contentType]);
  headers.push(["host", host]);
  headers.sort((a, b) => a[0].localeCompare(b[0]));
  const signedHeaders = headers.map(([name]) => name).join(";");
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(input.expiresIn),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  if (input.responseCacheControl) params["response-cache-control"] = input.responseCacheControl;
  if (input.responseContentDisposition) {
    params["response-content-disposition"] = input.responseContentDisposition;
  }
  if (input.responseContentType) params["response-content-type"] = input.responseContentType;
  const query = canonicalQuery(params);
  const request = canonicalRequest({
    method: input.method,
    canonicalUri,
    query,
    headers,
    signedHeaders,
  });
  const stringToSign = ["AWS4-HMAC-SHA256", amz, scope, sha256Hex(request)].join("\n");
  const signature = hmac(
    signingKey(input.secretAccessKey, stamp, input.region),
    stringToSign,
  ).toString("hex");
  const base = `${endpoint.protocol}//${host}${canonicalUri}`;
  const headersOut: Record<string, string> = {};
  if (input.contentLength !== undefined) headersOut["content-length"] = String(input.contentLength);
  if (input.contentType && input.method !== "GET") headersOut["content-type"] = input.contentType;
  return { url: `${base}?${query}&X-Amz-Signature=${signature}`, headers: headersOut };
}

export function attachmentName(contentType: string): string {
  if (contentType === "video/mp4") return "video.mp4";
  if (contentType === "image/jpeg") return "picture.jpg";
  return "message.bin";
}

export type StoredHead = { byteSize: number; contentType: string };

export type ObjectStore = {
  presignPut(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresIn: number;
    now: Date;
  }): {
    url: string;
    headers: Record<string, string>;
  };
  presignGet(input: {
    key: string;
    expiresIn: number;
    now: Date;
    contentType: string;
    filename: string;
  }): string;
  head(key: string): Promise<StoredHead | null>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function enabled(config: MediaConfig): Extract<MediaConfig, { enabled: true }> {
  if (!config.enabled) throw new Error("Picture storage is not set up.");
  return config;
}

export function createS3Store(
  config: Extract<MediaConfig, { enabled: true }>,
  fetchImpl: FetchLike = fetch,
): ObjectStore {
  const sign = (
    method: PresignInput["method"],
    key: string,
    expiresIn: number,
    contentType?: string,
  ) =>
    presignRequest({
      method,
      endpoint: config.endpoint,
      bucket: config.bucket,
      key,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      expiresIn,
      now: new Date(),
      forcePathStyle: config.forcePathStyle,
      contentType,
    });

  async function call(
    method: PresignInput["method"],
    key: string,
    init?: { body?: Uint8Array; contentType?: string },
  ): Promise<Response> {
    const signed = sign(method, key, 60, init?.contentType);
    const response = await fetchImpl(signed.url, {
      method,
      headers: signed.headers,
      body: init?.body ? Buffer.from(init.body) : undefined,
    });
    if ((method === "HEAD" || method === "DELETE") && response.status === 404) return response;
    if (!response.ok) {
      throw new Error(`Object storage returned ${response.status}.`);
    }
    return response;
  }

  return {
    presignPut({ key, contentType, contentLength, expiresIn, now }) {
      return presignRequest({
        method: "PUT",
        endpoint: config.endpoint,
        bucket: config.bucket,
        key,
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        expiresIn,
        now,
        forcePathStyle: config.forcePathStyle,
        contentType,
        contentLength,
      });
    },
    presignGet({ key, expiresIn, now, contentType, filename }) {
      return presignRequest({
        method: "GET",
        endpoint: config.endpoint,
        bucket: config.bucket,
        key,
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        expiresIn,
        now,
        forcePathStyle: config.forcePathStyle,
        responseContentType: contentType,
        responseContentDisposition: `attachment; filename="${filename}"`,
        responseCacheControl: "private, no-store",
      }).url;
    },
    async head(key) {
      const response = await call("HEAD", key);
      if (response.status === 404) return null;
      const byteSize = Number(response.headers.get("content-length") ?? "");
      if (!Number.isInteger(byteSize) || byteSize < 0) return null;
      return {
        byteSize,
        contentType:
          (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "",
      };
    },
    async get(key) {
      const response = await call("GET", key);
      return new Uint8Array(await response.arrayBuffer());
    },
    async put(key, bytes, contentType) {
      await call("PUT", key, { body: bytes, contentType });
    },
    async delete(key) {
      const response = await call("DELETE", key);
      if (response.status === 404) return;
    },
  };
}

export function storeFromConfig(config: MediaConfig, fetchImpl?: FetchLike): ObjectStore | null {
  if (!config.enabled) return null;
  return createS3Store(enabled(config), fetchImpl);
}
