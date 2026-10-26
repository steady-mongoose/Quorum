import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { injectGrokPwaHead } from "../../../scripts/grok-pwa-shared.mjs";
import { publicGatheringMeta } from "./public-gathering.ts";
import {
  categoryPageMeta,
  homeMeta,
  renderedOgTitles,
  roomsIndexMeta,
  rootMeta,
} from "./route-heads.ts";

const GATHERING = {
  title: "Saturday lifts",
  date: "2026-10-24",
  time: "07:00",
  town: "Riverview",
};
const GATHERING_ID = "3f2a9c1e-8241-4c3e-9a11-8241abcd1234";

test("each route renders exactly one og:title, and a child replaces the root", () => {
  const root = rootMeta();
  const cases: Array<[string, string]> = [
    ["/", renderedOgTitles([root, homeMeta()])[0] ?? ""],
    ["/rooms", renderedOgTitles([root, roomsIndexMeta()])[0] ?? ""],
    ["/rooms/churches", renderedOgTitles([root, categoryPageMeta("churches")])[0] ?? ""],
    [
      "/e/id",
      renderedOgTitles([root, publicGatheringMeta(GATHERING, GATHERING_ID)])[0] ?? "",
    ],
  ];
  assert.deepEqual(
    cases.map(([, title]) => title),
    ["Avouch Social", "Rooms", "Churches", "Saturday lifts"],
  );
  for (const [path, title] of cases) {
    const layers =
      path === "/"
        ? [root, homeMeta()]
        : path === "/rooms"
          ? [root, roomsIndexMeta()]
          : path === "/rooms/churches"
            ? [root, categoryPageMeta("churches")]
            : [root, publicGatheringMeta(GATHERING, GATHERING_ID)];
    assert.deepEqual(renderedOgTitles(layers), [title], path);
  }
  assert.equal(renderedOgTitles([root, publicGatheringMeta(null, GATHERING_ID)]).length, 1);
});

test("the shell does not stamp a second og:title of Quorum", () => {
  const site = JSON.parse(
    readFileSync(new URL("../og/site.json", import.meta.url), "utf8"),
  ) as { title?: string; card?: string };
  assert.equal(site.title, undefined);
  assert.equal(site.card, "custom");
  const html = `<html><head><title>Churches · Avouch Social</title><meta property="og:title" content="Avouch Social"><meta property="og:title" content="Churches"></head><body></body></html>`;
  const out = injectGrokPwaHead(html);
  assert.equal(out.split('property="og:title"').length - 1, 1);
  assert.match(out, /property="og:title" content="Churches · Avouch Social"/);
  assert.equal(out.includes('content="Quorum"'), false);
});
