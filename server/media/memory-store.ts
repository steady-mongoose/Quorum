import type { ObjectStore } from "./s3.ts";

type Saved = { bytes: Uint8Array; contentType: string };

/** In-memory stand-in for tests. Presigned URLs point at a fake host. */
export function createMemoryStore(): ObjectStore & { objects: Map<string, Saved> } {
  const objects = new Map<string, Saved>();
  return {
    objects,
    presignPut({ key, contentType, contentLength }) {
      return {
        url: `https://media.test/${key}`,
        headers: { "content-type": contentType, "content-length": String(contentLength) },
      };
    },
    presignGet({ key, contentType, filename }) {
      const query = new URLSearchParams({
        "response-content-disposition": `attachment; filename="${filename}"`,
        "response-content-type": contentType,
        "response-cache-control": "private, no-store",
      });
      return `https://media.test/${key}?${query.toString()}`;
    },
    async head(key) {
      const found = objects.get(key);
      if (!found) return null;
      return { byteSize: found.bytes.byteLength, contentType: found.contentType };
    },
    async get(key) {
      return objects.get(key)?.bytes ?? null;
    },
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType });
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
