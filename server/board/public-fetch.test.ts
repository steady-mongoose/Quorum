import assert from "node:assert/strict";
import test from "node:test";
import { readPublicPage, type AddressRecord, type PinnedRequest } from "./public-fetch.ts";

function lookup(records: Record<string, AddressRecord[]>) {
  return async (hostname: string) => {
    const found = records[hostname];
    if (!found) throw new Error(`no dns for ${hostname}`);
    return found;
  };
}

test("a site fetch pins the resolved address and skips private answers", async () => {
  const calls: PinnedRequest[] = [];
  const ok = await readPublicPage("https://grace.example/about", {
    lookup: lookup({ "grace.example": [{ address: "93.184.216.34", family: 4 }] }),
    request: async (target) => {
      calls.push(target);
      return {
        status: 200,
        headers: { get: () => null },
        body: new TextEncoder().encode("avouch-token"),
      };
    },
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.match(ok.body, /avouch-token/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.address, "93.184.216.34");
  assert.equal(calls[0]?.hostname, "grace.example");
  assert.equal(calls[0]?.port, 443);

  const mixed = await readPublicPage("https://grace.example/about", {
    lookup: lookup({
      "grace.example": [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    }),
    request: async () => {
      throw new Error("private answer must not be fetched");
    },
  });
  assert.equal(mixed.ok, false);

  const loopback = await readPublicPage("https://grace.example/about", {
    lookup: lookup({ "grace.example": [{ address: "127.0.0.1", family: 4 }] }),
    request: async () => {
      throw new Error("loopback must not be fetched");
    },
  });
  assert.equal(loopback.ok, false);
});

test("a redirect is not followed, and a private location is refused", async () => {
  let calls = 0;
  const looked: string[] = [];
  const redirected = await readPublicPage("https://grace.example/about", {
    lookup: async (hostname) => {
      looked.push(hostname);
      if (hostname === "grace.example") return [{ address: "93.184.216.34", family: 4 }];
      if (hostname === "meta.example") return [{ address: "169.254.169.254", family: 4 }];
      throw new Error(hostname);
    },
    request: async () => {
      calls += 1;
      return {
        status: 302,
        headers: {
          get: (name) => (name === "location" ? "https://meta.example/latest" : null),
        },
        body: null,
      };
    },
  });
  assert.equal(redirected.ok, false);
  assert.equal(calls, 1);
  assert.equal(looked.includes("meta.example"), true);

  const nip = await readPublicPage("http://church.nip.io/", {
    lookup: async () => {
      throw new Error("rebinding name must not be resolved");
    },
    request: async () => {
      throw new Error("rebinding name must not be fetched");
    },
  });
  assert.equal(nip.ok, false);

  const port = await readPublicPage("https://grace.example:22/", {
    request: async () => {
      throw new Error("a non-web port must not be fetched");
    },
  });
  assert.equal(port.ok, false);
});

test("a page over 64KB is refused", async () => {
  const huge = await readPublicPage("https://grace.example/", {
    lookup: lookup({ "grace.example": [{ address: "93.184.216.34", family: 4 }] }),
    request: async () => ({
      status: 200,
      headers: { get: () => null },
      body: null,
      tooBig: true,
    }),
  });
  assert.equal(huge.ok, false);
});
