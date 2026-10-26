import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  acceptPublicGathering,
  isGatheringId,
  publicDateLabel,
  publicGatheringHtml,
  publicGatheringJson,
  publicGatheringMeta,
  readPublicGathering,
} from "./public-gathering.ts";

const ID = "3f2a9c1e-8241-4c3e-9a11-8241abcd1234";
const SHARED = {
  title: "Saturday lifts",
  date: "2026-10-24",
  time: "7 a.m.",
  town: "Riverview",
};

function metaContents(html: string): string[] {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
}

test("a shared page is the title, the date, the time, and the town, with noindex", () => {
  assert.equal(publicDateLabel("2026-10-24"), "October 24, 2026");
  const page = publicGatheringHtml(SHARED, ID);
  assert.equal(page.status, 200);
  assert.match(page.body, /<meta name="robots" content="noindex">/);
  assert.match(page.body, /Saturday lifts/);
  assert.match(page.body, /October 24, 2026/);
  assert.match(page.body, /7 a\.m\./);
  assert.match(page.body, /Riverview/);
  assert.match(page.body, /Avouch is invite-only/);
  assert.match(page.body, /hero-band/);
  assert.match(page.body, /gathering-kicker/);
  assert.match(page.body, /data-section="week"/);
  assert.equal(page.body.includes("Dale"), false);
  assert.equal(page.body.includes("1010"), false);
  const payload = publicGatheringJson(SHARED);
  assert.equal(payload.status, 200);
  assert.deepEqual(Object.keys(payload.body).sort(), ["date", "time", "title", "town"]);
});

test("preview tags are built from the public fields only", () => {
  const page = publicGatheringHtml(SHARED, ID);
  const tags = metaContents(page.body).join("\n");
  assert.match(tags, /property="og:title" content="Saturday lifts"/);
  assert.match(tags, /property="og:description" content="October 24, 2026 · 7 a\.m\. · Riverview"/);
  assert.match(tags, /property="og:type" content="website"/);
  assert.match(tags, /property="og:url" content="https:\/\/avouchsocial\.com\/e\/3f2a9c1e-8241-4c3e-9a11-8241abcd1234"/);
  assert.match(tags, /name="twitter:card" content="summary"/);
  assert.match(tags, /name="twitter:title" content="Saturday lifts"/);
  assert.match(tags, /name="twitter:description" content="October 24, 2026 · 7 a\.m\. · Riverview"/);
  for (const tag of metaContents(page.body)) {
    assert.equal(/Dale|Josh|Pete|1010|plates|address|going|posts|host/.test(tag), false, tag);
  }
  const meta = publicGatheringMeta(SHARED, ID);
  const serialized = JSON.stringify(meta);
  assert.equal(/Dale|1010|Josh/.test(serialized), false);
});

test("an unshared gathering is a 404 and still noindex", () => {
  const page = publicGatheringHtml(null, ID);
  assert.equal(page.status, 404);
  assert.match(page.body, /noindex/);
  assert.match(page.body, /not shared/);
  assert.match(page.body, /hero-band/);
  assert.match(page.body, /gathering-kicker/);
  assert.equal(page.body.includes("Saturday"), false);
  assert.equal(page.body.includes('property="og:title"'), false);
  const payload = publicGatheringJson(null);
  assert.equal(payload.status, 404);
  assert.deepEqual(payload.body, { error: "Not found." });
});

test("a short id is not a gathering id", () => {
  assert.equal(isGatheringId("1"), false);
  assert.equal(isGatheringId("s-lifts"), false);
  assert.equal(isGatheringId(ID), true);
});

test("a street, a member list, and a post cannot become the public page", () => {
  const street = acceptPublicGathering({
    title: "Grace Bible Church of Brandon",
    date: "2026-10-25",
    time: "10:30",
    town: "1010 E Brandon Blvd",
  });
  assert.equal(street.ok, false);
  const named = acceptPublicGathering({
    title: "Saturday lifts",
    date: "2026-10-24",
    time: "7 a.m.",
    town: "Dale has the address",
  });
  assert.equal(named.ok, false);
  const phone = acceptPublicGathering({
    title: "Saturday lifts",
    date: "2026-10-24",
    time: "Call 813-662-9622",
    town: "Riverview",
  });
  assert.equal(phone.ok, false);
  const extra = readPublicGathering({
    title: "Saturday lifts",
    date: "2026-10-24",
    time: "7 a.m.",
    town: "Riverview",
    host: "Dale",
    going: ["Josh", "Pete"],
    place: "Dale's garage, 1010 E Brandon Blvd",
    posts: ["Josh came and brought the plates."],
    members: ["Josh"],
  });
  assert.deepEqual(extra, SHARED);
  assert.equal(extra && "host" in extra, false);
  assert.equal(extra && "going" in extra, false);
  assert.equal(extra && "posts" in extra, false);
  const page = publicGatheringHtml(extra, ID);
  assert.equal(page.body.includes("Josh"), false);
  assert.equal(page.body.includes("Pete"), false);
  assert.equal(page.body.includes("1010"), false);
  assert.equal(page.body.includes("plates"), false);
  for (const tag of metaContents(page.body)) {
    assert.equal(/Dale|Josh|Pete|1010|plates/.test(tag), false, tag);
  }
});

test("the public route is noindex and does not keep loading a missing id", () => {
  const route = readFileSync(new URL("../../routes/e/$id.tsx", import.meta.url), "utf8");
  const http = readFileSync(new URL("../../../server/http.ts", import.meta.url), "utf8");
  const view = readFileSync(new URL("../../components/board/public-gathering-view.tsx", import.meta.url), "utf8");
  const share = readFileSync(new URL("../../components/board/gathering-share.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("./gathering-public.ts", import.meta.url), "utf8");
  assert.match(route, /noindex|publicGatheringMeta/);
  assert.match(route, /notFound\(\)/);
  assert.match(route, /PublicGatheringLoading/);
  assert.match(route, /PublicGatheringMissing/);
  assert.equal(route.includes("useEffect"), false);
  assert.equal(route.includes("sharePublic"), false);
  assert.equal(/\bgoing\b|\.place\b|\bposts\b/.test(route), false);
  assert.match(view, /hero-band/);
  assert.match(view, /gathering-kicker/);
  assert.match(view, /Loading\./);
  assert.match(client, /AbortSignal\.timeout/);
  assert.match(client, /JSON\.stringify\(\{ shared: input\.shared \}\)/);
  assert.match(share, /loadGathering/);
  assert.match(http, /handlePublicGathering/);
  assert.match(http, /Sign in first/);
});
