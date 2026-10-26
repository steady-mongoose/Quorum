import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  acceptPublicGathering,
  publicDateLabel,
  publicGatheringHtml,
  publicGatheringJson,
  readPublicGathering,
} from "./public-gathering.ts";

const SHARED = {
  title: "Saturday lifts, garage gym",
  date: "2026-10-24",
  town: "Riverview",
};

test("a shared page is the title, the date, and the town, with noindex", () => {
  assert.equal(publicDateLabel("2026-10-24"), "October 24, 2026");
  const page = publicGatheringHtml(SHARED);
  assert.equal(page.status, 200);
  assert.match(page.body, /<meta name="robots" content="noindex">/);
  assert.match(page.body, /Saturday lifts, garage gym/);
  assert.match(page.body, /October 24, 2026/);
  assert.match(page.body, /Riverview/);
  assert.equal(page.body.includes("Dale"), false);
  assert.equal(page.body.includes("1010"), false);
  assert.equal(page.body.includes("garage,"), false);
  assert.equal(/\bgoing\b|\bposts\b|\baddress\b|\bhost\b/i.test(page.body), false);
  const payload = publicGatheringJson(SHARED);
  assert.equal(payload.status, 200);
  assert.deepEqual(Object.keys(payload.body).sort(), ["date", "title", "town"]);
});

test("an unshared gathering is a 404 and still noindex", () => {
  const page = publicGatheringHtml(null);
  assert.equal(page.status, 404);
  assert.match(page.body, /noindex/);
  assert.match(page.body, /not shared/);
  assert.equal(page.body.includes("Saturday"), false);
  const payload = publicGatheringJson(null);
  assert.equal(payload.status, 404);
  assert.deepEqual(payload.body, { error: "Not found." });
});

test("a street, a member list, and a post cannot become the public page", () => {
  const street = acceptPublicGathering({
    title: "Grace Bible Church of Brandon",
    date: "2026-10-25",
    town: "1010 E Brandon Blvd",
  });
  assert.equal(street.ok, false);
  const named = acceptPublicGathering({
    title: "Saturday lifts",
    date: "2026-10-24",
    town: "Dale has the address",
  });
  assert.equal(named.ok, false);
  const extra = readPublicGathering({
    title: "Saturday lifts",
    date: "2026-10-24",
    town: "Riverview",
    host: "Dale",
    going: ["Josh", "Pete"],
    place: "Dale's garage, 1010 E Brandon Blvd",
    posts: ["Josh came and brought the plates."],
    members: ["Josh"],
  });
  assert.deepEqual(extra, {
    title: "Saturday lifts",
    date: "2026-10-24",
    town: "Riverview",
  });
  assert.equal(extra && "host" in extra, false);
  assert.equal(extra && "going" in extra, false);
  assert.equal(extra && "posts" in extra, false);
  const page = publicGatheringHtml(extra);
  assert.equal(page.body.includes("Josh"), false);
  assert.equal(page.body.includes("Pete"), false);
  assert.equal(page.body.includes("1010"), false);
  assert.equal(page.body.includes("plates"), false);
});

test("the public route is noindex and the other pages stay behind the door", () => {
  const route = readFileSync(new URL("../../routes/e/$id.tsx", import.meta.url), "utf8");
  const http = readFileSync(new URL("../../../server/http.ts", import.meta.url), "utf8");
  assert.match(route, /noindex/);
  assert.match(route, /notFound\(\)/);
  assert.equal(route.includes("sharePublic"), false);
  assert.equal(/\bgoing\b|\.place\b|\bposts\b/.test(route), false);
  assert.match(http, /handlePublicGathering/);
  assert.match(http, /Sign in first/);
});
