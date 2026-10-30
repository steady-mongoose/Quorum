import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlaceLookup,
  DEFAULT_PLACE_LOOKUP_URL,
  matchesKind,
  parseSearchBody,
  readPlaceLookupConfig,
  safeProviderUrl,
  toSuggestions,
  type PlaceLookupConfig,
} from "./lookup.ts";

function feature(
  id: number,
  name: string,
  lon: number,
  lat: number,
  extra: Record<string, unknown> = {},
) {
  return {
    type: "Feature",
    properties: {
      osm_type: "N",
      osm_id: id,
      osm_key: "amenity",
      osm_value: "place_of_worship",
      name,
      street: "Main Street",
      housenumber: "10",
      city: "Brandon",
      state: "Florida",
      postcode: "33511",
      countrycode: "US",
      ...extra,
    },
    geometry: { type: "Point", coordinates: [lon, lat] },
  };
}

const BRANDON = { lat: 27.9378, lon: -82.2859 };

const sample = {
  type: "FeatureCollection",
  features: [
    feature(1, "Far Church", -81.95, 28.04),
    feature(2, "Near Church", -82.29, 27.94),
    feature(3, "Hardware Store", -82.29, 27.94, { osm_key: "shop", osm_value: "hardware" }),
    feature(4, "Egypt Church", 30.9, 31.1, { countrycode: "EG" }),
    feature(2, "Near Church", -82.29, 27.94),
    feature(5, "", -82.29, 27.94),
    {
      properties: {
        osm_type: "X",
        osm_id: 9,
        osm_key: "amenity",
        osm_value: "place_of_worship",
        name: "Bad",
        countrycode: "US",
      },
    },
  ],
};

function config(overrides: Partial<PlaceLookupConfig> = {}): PlaceLookupConfig {
  return {
    ...readPlaceLookupConfig({}),
    minIntervalMs: 0,
    ...overrides,
  };
}

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(body: unknown = sample) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetch };
}

test("church filter keeps places of worship in the country, nearest first, once each", () => {
  const rows = toSuggestions(sample, "church", "US", BRANDON);
  assert.deepEqual(
    rows.map((row) => row.ref),
    ["node/2", "node/1"],
  );
  assert.equal(rows[0]?.name, "Near Church");
  assert.equal(rows[0]?.address, "10 Main Street, Brandon, Florida 33511");
  assert.ok((rows[0]?.distanceKm ?? 99) < 2);
  assert.ok((rows[1]?.distanceKm ?? 0) > 30);
});

test("organization filter allows clubs and associations but not shops", () => {
  assert.equal(matchesKind("organization", "club", "sport"), true);
  assert.equal(matchesKind("organization", "office", "association"), true);
  assert.equal(matchesKind("organization", "amenity", "community_centre"), true);
  assert.equal(matchesKind("organization", "shop", "hardware"), false);
  assert.equal(matchesKind("church", "amenity", "community_centre"), false);
  assert.equal(matchesKind("church", "amenity", "place_of_worship"), true);
});

test("the search sends the filter, a User-Agent, and no member detail", async () => {
  const { calls, fetch } = fakeFetch();
  const lookup = createPlaceLookup({ config: config(), fetch });
  const result = await lookup.search("user-secret-id", {
    q: "Epiphany",
    kind: "church",
    near: { lat: 27.937812345, lon: -82.285912345 },
    nearText: "",
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  const url = new URL(call.url);
  assert.equal(url.origin, DEFAULT_PLACE_LOOKUP_URL);
  assert.equal(url.pathname, "/api/");
  assert.deepEqual(url.searchParams.getAll("osm_tag"), ["amenity:place_of_worship"]);
  assert.equal(url.searchParams.get("q"), "epiphany");
  // Rounded to two places. The exact point never leaves the server.
  assert.equal(url.searchParams.get("lat"), "27.94");
  assert.equal(url.searchParams.get("lon"), "-82.29");
  assert.equal(call.url.includes("27.9378"), false);
  assert.equal(call.url.includes("user-secret-id"), false);
  const headers = new Headers(call.init?.headers);
  assert.match(headers.get("user-agent") ?? "", /^AvouchSocial-PlaceLookup\/1\.0 /);
  assert.equal(headers.has("cookie"), false);
  assert.equal(headers.has("authorization"), false);
  assert.equal(call.init?.credentials, "omit");
  assert.equal(call.init?.referrerPolicy, "no-referrer");
});

test("repeat words come from a short cache that holds no member, words, or point", async () => {
  const { calls, fetch } = fakeFetch();
  let clock = 1_000_000;
  const lookup = createPlaceLookup({ config: config(), fetch, now: () => clock });
  const input = { q: "Epiphany", kind: "church" as const, near: null, nearText: "" };
  await lookup.search("ann", input);
  await lookup.search("bob", { ...input, q: "epiphany" });
  assert.equal(calls.length, 1);
  const seen = lookup.inspect();
  for (const key of [...seen.cacheKeys, ...seen.limiterKeys, ...seen.pickKeys]) {
    assert.match(key, /^[0-9a-f]+$/, "every key is a hash");
    assert.equal(key.includes("ann"), false);
    assert.equal(key.includes("bob"), false);
    assert.equal(key.includes("epiphany"), false);
  }
  clock += 11 * 60 * 1000;
  await lookup.search("ann", input);
  assert.equal(calls.length, 2, "an answer older than 10 minutes is fetched again");
});

test("a search sorted by a location or a town is never cached", async () => {
  const { calls, fetch } = fakeFetch();
  const lookup = createPlaceLookup({ config: config(), fetch });
  const near = { q: "Epiphany", kind: "church" as const, near: BRANDON, nearText: "" };
  await lookup.search("ann", near);
  await lookup.search("ann", near);
  assert.equal(calls.length, 2);
  const town = { q: "Epiphany", kind: "church" as const, near: null, nearText: "33511" };
  await lookup.search("ann", town);
  assert.equal(calls.length, 4, "the town and the search each call the provider");
  assert.deepEqual(lookup.inspect().cacheKeys, []);
});

test("only places a member's own search returned can be saved, for an hour", async () => {
  const { fetch } = fakeFetch();
  let clock = 0;
  const lookup = createPlaceLookup({ config: config(), fetch, now: () => clock });
  await lookup.search("ann", { q: "Church", kind: "church", near: BRANDON, nearText: "" });
  assert.deepEqual(lookup.picked("ann", "node/2"), {
    ref: "node/2",
    name: "Near Church",
    address: "10 Main Street, Brandon, Florida 33511",
  });
  assert.equal(lookup.picked("bob", "node/2"), null, "another member's search does not count");
  assert.equal(lookup.picked("ann", "node/3"), null, "a filtered-out shop is not a pick");
  assert.equal(lookup.picked("ann", "node/999"), null);
  clock += 61 * 60 * 1000;
  assert.equal(lookup.picked("ann", "node/2"), null);
});

test("each client IP is rate-limited across members", async () => {
  const { fetch } = fakeFetch();
  const lookup = createPlaceLookup({
    config: config({ ipLimit: { windowMs: 60_000, max: 2 } }),
    fetch,
    now: () => 0,
  });
  const input = { q: "Grace", kind: "church" as const, near: null, nearText: "" };
  assert.equal((await lookup.search("ann", input, "203.0.113.8")).ok, true);
  assert.equal((await lookup.search("bob", input, "203.0.113.8")).ok, true);
  const third = await lookup.search("cat", input, "203.0.113.8");
  assert.equal(third.ok, false);
  if (!third.ok) assert.equal(third.status, 429);
  assert.equal((await lookup.search("cat", input, "198.51.100.4")).ok, true);
  for (const key of lookup.inspect().limiterKeys) assert.equal(key.includes("203.0"), false);
});

test("the provider queue has a cap and a deadline, and answers 429 past them", async () => {
  const { calls, fetch } = fakeFetch();
  const lookup = createPlaceLookup({
    config: config({ minIntervalMs: 250, queueMax: 3, queueWaitMs: 1000 }),
    fetch,
    now: () => 0,
    // Never resolves, so calls stay queued.
    sleep: () => new Promise<void>(() => undefined),
  });
  const results = Array.from({ length: 6 }, (_, i) =>
    lookup.search(`m${i}`, { q: `Church ${i}`, kind: "church", near: null, nearText: "" }),
  );
  // Call 0 runs at once; 1-3 wait (250, 500, 750 ms); 4 is past the cap.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    Promise.all([results[0], results[4], results[5]]),
    new Promise<null>((done) => {
      timer = setTimeout(() => done(null), 2000);
    }),
  ]);
  clearTimeout(timer);
  assert.ok(settled, "busy calls answer at once instead of waiting");
  const [first, fifth, sixth] = settled!;
  assert.equal(first.ok, true);
  for (const busy of [fifth, sixth]) {
    assert.equal(busy.ok, false);
    if (!busy.ok) {
      assert.equal(busy.status, 429);
      assert.match(busy.error, /busy/);
      assert.equal(busy.retryAfter, 2);
    }
  }
  assert.equal(calls.length, 1);
});

test("a wait longer than the deadline is refused even under the cap", async () => {
  const { fetch } = fakeFetch();
  const lookup = createPlaceLookup({
    config: config({ minIntervalMs: 2000, queueMax: 10, queueWaitMs: 1000 }),
    fetch,
    now: () => 0,
    sleep: () => new Promise<void>(() => undefined),
  });
  const input = { q: "Grace", kind: "church" as const, near: null, nearText: "" };
  assert.equal((await lookup.search("a", input)).ok, true);
  const late = await lookup.search("b", { ...input, q: "Other" });
  assert.equal(late.ok, false);
  if (!late.ok) assert.equal(late.status, 429);
});

test("the same words at the same moment share one provider call", async () => {
  const { calls, fetch } = fakeFetch();
  const lookup = createPlaceLookup({ config: config(), fetch });
  const input = { q: "Grace", kind: "church" as const, near: null, nearText: "" };
  await Promise.all([lookup.search("a", input), lookup.search("b", input)]);
  assert.equal(calls.length, 1);
});

test("each member is rate-limited on their own", async () => {
  const { fetch } = fakeFetch();
  let clock = 0;
  const lookup = createPlaceLookup({
    config: config({ memberLimit: { windowMs: 60_000, max: 2 } }),
    fetch,
    now: () => clock,
  });
  const input = { q: "Grace", kind: "church" as const, near: null, nearText: "" };
  assert.equal((await lookup.search("ann", input)).ok, true);
  assert.equal((await lookup.search("ann", input)).ok, true);
  const third = await lookup.search("ann", input);
  assert.equal(third.ok, false);
  if (!third.ok) {
    assert.equal(third.status, 429);
    assert.ok((third.retryAfter ?? 0) >= 1);
  }
  assert.equal((await lookup.search("bob", input)).ok, true);
  clock += 61_000;
  assert.equal((await lookup.search("ann", input)).ok, true);
});

test("provider calls are spaced out", async () => {
  const { fetch } = fakeFetch();
  let clock = 0;
  const waits: number[] = [];
  const lookup = createPlaceLookup({
    config: config({ minIntervalMs: 250 }),
    fetch,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  await lookup.search("a", { q: "One church", kind: "church", near: null, nearText: "" });
  await lookup.search("a", { q: "Two church", kind: "church", near: null, nearText: "" });
  assert.deepEqual(waits, [250]);
});

test("a city or ZIP stands in for location and the provider sees only the words", async () => {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const q = new URL(url).searchParams.get("q");
    const body =
      q === "33511"
        ? {
            features: [
              { properties: { countrycode: "EG" }, geometry: { coordinates: [30.9, 31.1] } },
              { properties: { countrycode: "US" }, geometry: { coordinates: [-82.2982, 27.9145] } },
            ],
          }
        : sample;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const lookup = createPlaceLookup({ config: config(), fetch });
  const result = await lookup.search("ann", {
    q: "church",
    kind: "church",
    near: null,
    nearText: "33511",
  });
  assert.equal(calls.length, 2);
  const second = new URL(calls[1]!);
  assert.equal(second.searchParams.get("lat"), "27.91");
  assert.equal(second.searchParams.get("lon"), "-82.30");
  assert.equal(result.ok && result.places[0]?.ref, "node/2");
});

test("a provider failure is a plain 502, not a crash", async () => {
  const lookup = createPlaceLookup({
    config: config(),
    fetch: async () => new Response("busy", { status: 503 }),
  });
  const result = await lookup.search("ann", {
    q: "Grace",
    kind: "church",
    near: null,
    nearText: "",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 502);
});

test("search body needs three letters and a kind, and ignores a bad point", () => {
  assert.equal(parseSearchBody({ q: "ab", kind: "church" }).ok, false);
  assert.equal(parseSearchBody({ q: "abc", kind: "shop" }).ok, false);
  const parsed = parseSearchBody({ q: "  Grace  ", kind: "church", near: { lat: 200, lon: 0 } });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.input.q, "Grace");
    assert.equal(parsed.input.near, null);
  }
});

test("the provider URL is an https setting with a safe default, never public Nominatim", () => {
  assert.equal(safeProviderUrl(undefined), DEFAULT_PLACE_LOOKUP_URL);
  assert.equal(safeProviderUrl("https://geo.example.org/"), "https://geo.example.org");
  assert.equal(safeProviderUrl("http://geo.example.org"), DEFAULT_PLACE_LOOKUP_URL);
  assert.equal(safeProviderUrl("https://user:pw@geo.example.org"), DEFAULT_PLACE_LOOKUP_URL);
  assert.equal(safeProviderUrl("https://nominatim.openstreetmap.org"), DEFAULT_PLACE_LOOKUP_URL);
  assert.equal(safeProviderUrl("http://127.0.0.1:2322"), "http://127.0.0.1:2322");
  assert.equal(readPlaceLookupConfig({ PLACE_LOOKUP_COUNTRY: "" }).country, "");
  assert.equal(readPlaceLookupConfig({ PLACE_LOOKUP_PER_MINUTE: "9999" }).memberLimit.max, 120);
  assert.equal(readPlaceLookupConfig({}).cacheTtlMs, 10 * 60 * 1000);
  assert.equal(readPlaceLookupConfig({}).ipLimit.max, 90);
});

test("nothing is written to the log during a search", async () => {
  const { fetch } = fakeFetch();
  const lookup = createPlaceLookup({ config: config(), fetch });
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const lines: unknown[] = [];
  console.log =
    console.info =
    console.warn =
    console.error =
      (...args: unknown[]) => {
        lines.push(args);
      };
  try {
    await lookup.search("ann", { q: "Grace", kind: "church", near: BRANDON, nearText: "" });
    await createPlaceLookup({
      config: config(),
      fetch: async () => {
        throw new Error("offline");
      },
    }).search("ann", { q: "Grace", kind: "church", near: BRANDON, nearText: "" });
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(lines, []);
});
