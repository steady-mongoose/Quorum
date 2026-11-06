import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  acceptPublicGathering,
  GATHERING_OG_IMAGE,
  isGatheringId,
  PUBLIC_TIME_NOTE,
  publicClock,
  publicDateLabel,
  publicGatheringHtml,
  publicGatheringJson,
  publicGatheringMeta,
  readPublicGathering,
  shareAccess,
} from "./public-gathering.ts";

const ID = "3f2a9c1e-8241-4c3e-9a11-8241abcd1234";
const SHARED = {
  title: "Saturday lifts",
  date: "2026-10-24",
  time: "07:00",
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
  assert.match(page.body, /07:00/);
  assert.match(page.body, /Riverview/);
  assert.match(
    page.body,
    /Avouch Social is a community you join by invitation\. Ask the person who shared this for an invite code\./,
  );
  assert.doesNotMatch(page.body, /invite-only/);
  assert.match(page.body, /the title, the date, the time, and the town/);
  assert.match(page.body, /class="plate-ground door-ground"/);
  assert.match(page.body, /<link rel="stylesheet" href="\/door\.css">/);
  assert.doesNotMatch(page.body, /hero-band/);
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
  assert.match(tags, /property="og:description" content="October 24, 2026 · 07:00 · Riverview"/);
  assert.match(tags, /property="og:type" content="website"/);
  assert.match(tags, /property="og:url" content="https:\/\/avouchsocial\.com\/e\/3f2a9c1e-8241-4c3e-9a11-8241abcd1234"/);
  assert.match(tags, /property="og:image" content="https:\/\/avouchsocial\.com\/art\/dore-og\.jpg"/);
  assert.match(tags, /property="og:image:alt" content="Gustave Doré, Jacob’s Dream, 1866"/);
  assert.match(tags, /property="og:image:width" content="1200"/);
  assert.match(tags, /property="og:image:height" content="630"/);
  assert.equal(GATHERING_OG_IMAGE.includes(SHARED.title), false);
  assert.equal(GATHERING_OG_IMAGE.includes(ID), false);
  assert.match(tags, /name="twitter:card" content="summary_large_image"/);
  assert.match(tags, /name="twitter:image" content="https:\/\/avouchsocial\.com\/art\/dore-og\.jpg"/);
  assert.match(tags, /name="twitter:title" content="Saturday lifts"/);
  assert.match(tags, /name="twitter:description" content="October 24, 2026 · 07:00 · Riverview"/);
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
  assert.match(page.body, /class="plate-ground door-ground"/);
  assert.match(page.body, /<link rel="stylesheet" href="\/door\.css">/);
  assert.doesNotMatch(page.body, /hero-band/);
  assert.match(page.body, /gathering-kicker/);
  assert.equal(page.body.includes("Saturday"), false);
  assert.equal(page.body.includes('property="og:title"'), false);
  assert.equal(page.body.includes("og:image"), false);
  const payload = publicGatheringJson(null);
  assert.equal(payload.status, 404);
  assert.deepEqual(payload.body, { error: "Not found." });
});

test("a free-text time never appears on the public page", () => {
  const sentence = "Meet behind the old mill on Route 9";
  assert.equal(publicClock(sentence), "");
  assert.equal(publicClock("Saturdays 7 a.m."), "");
  assert.equal(publicClock("Saturday, 9:00 AM"), "");
  assert.equal(publicClock("7:00"), "");
  assert.equal(publicClock("24:00"), "");
  assert.equal(publicClock("07:00"), "07:00");
  assert.equal(publicClock("19:05"), "19:05");
  assert.equal(publicClock("7 a.m."), "7:00 a.m.");
  assert.equal(publicClock("7am"), "7:00 a.m.");
  assert.equal(publicClock("7 AM"), "7:00 a.m.");
  assert.equal(publicClock("9:00 AM"), "9:00 a.m.");
  assert.equal(publicClock("7:00 am"), "7:00 a.m.");
  assert.equal(publicClock("7:00 AM"), "7:00 a.m.");
  assert.equal(publicClock("07:00 pm"), "7:00 p.m.");
  assert.equal(publicClock("12:30 p.m."), "12:30 p.m.");
  for (const hidden of ["Saturdays 7 a.m.", "Saturday, 9:00 AM"]) {
    const hiddenPage = publicGatheringHtml({ ...SHARED, time: hidden }, ID);
    assert.equal(hiddenPage.body.includes(hidden), false);
    assert.equal(hiddenPage.body.includes("7:00"), false);
    assert.equal(hiddenPage.body.includes("9:00"), false);
    const hiddenJson = JSON.stringify(publicGatheringJson({ ...SHARED, time: hidden }));
    assert.equal(hiddenJson.includes(hidden), false);
    assert.equal(hiddenJson.includes("7:00"), false);
  }
  const bare = publicGatheringHtml({ ...SHARED, time: "7 a.m." }, ID);
  assert.match(bare.body, /7:00 a\.m\./);
  assert.equal(bare.body.includes("7 a.m."), false);
  const gathering = { ...SHARED, time: sentence };
  const page = publicGatheringHtml(gathering, ID);
  assert.equal(page.body.includes(sentence), false);
  assert.equal(page.body.includes("Route"), false);
  assert.match(page.body, /Saturday lifts/);
  assert.match(page.body, /Riverview/);
  const payload = publicGatheringJson(gathering);
  assert.equal(payload.status, 200);
  assert.equal(JSON.stringify(payload.body).includes(sentence), false);
  assert.equal("time" in payload.body, false);
  const tags = metaContents(page.body).join("\n");
  assert.equal(tags.includes(sentence), false);
  assert.equal(tags.includes("Route"), false);
  assert.match(tags, /property="og:description" content="October 24, 2026 · Riverview"/);
  const read = readPublicGathering({ ...gathering, host: "Dale" });
  assert.equal(read?.time, "");
  assert.equal(JSON.stringify(read).includes(sentence), false);
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
    time: "07:00",
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
    time: "07:00",
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

test("the server page links its CSS, and the preview image is a 1200 by 630 plate", () => {
  const page = publicGatheringHtml(SHARED, ID);
  const head = page.body.slice(0, page.body.indexOf("</head>"));
  assert.match(head, /<link rel="stylesheet" href="\/backgrounds\.css">/);
  assert.match(head, /<link rel="stylesheet" href="\/fluid\.css">/);
  assert.match(head, /<link rel="stylesheet" href="\/gathering\.css">/);
  const sheet = readFileSync(new URL("../../../public/gathering.css", import.meta.url), "utf8");
  assert.match(sheet, /\*,\*::before,\*::after\{box-sizing:border-box\}/);
  assert.match(sheet, /body\{margin:0\}/);
  assert.match(sheet, /\.gathering-plate p,\.gathering-plate h1,\.gathering-plate h2\{margin:0\}/);
  assert.match(sheet, /\.gathering-links a\s*\{[^}]*min-height:\s*44px/);
  assert.match(sheet, /\.gathering-links a\s*\{[^}]*padding:\s*12px 4px/);
  assert.match(sheet, /body:has\(\.gathering-page\)::after\s*\{[^}]*content:\s*none/);
  assert.match(sheet, /\.gathering-page::after\s*\{[^}]*position:\s*absolute/);
  const image = readFileSync(new URL("../../../public/art/dore-og.jpg", import.meta.url));
  assert.ok(image.length <= 150 * 1024, `preview is ${image.length} bytes`);
  assert.equal(image[0], 0xff);
  assert.equal(image[1], 0xd8);
  let offset = 2;
  let width = 0;
  let height = 0;
  while (offset + 8 < image.length && image[offset] === 0xff) {
    const marker = image[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = image.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      height = image.readUInt16BE(offset + 5);
      width = image.readUInt16BE(offset + 7);
      break;
    }
    offset += 2 + length;
  }
  assert.equal(width, 1200);
  assert.equal(height, 630);
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
  assert.match(view, /className="plate-ground door-ground"/);
  assert.doesNotMatch(view, /hero-band/);
  assert.match(view, /gathering-kicker/);
  assert.match(view, /Loading\./);
  assert.match(client, /AbortSignal\.timeout/);
  assert.match(client, /JSON\.stringify\(\{ shared: input\.shared \}\)/);
  assert.match(share, /loadGathering/);
  assert.equal(PUBLIC_TIME_NOTE, "Only a plain time like 7:00 a.m. appears on the shared page.");
  assert.match(share, /PUBLIC_TIME_NOTE/);
  assert.match(share, /publicClock\(card\.time\)/);
  assert.match(http, /handlePublicGathering/);
  assert.match(http, /Sign in first/);
});

test("QA #130: Save-Data: on gets the /e page flagged, so door.css never fetches the plate", () => {
  const plain = publicGatheringHtml(SHARED, ID);
  assert.match(plain.body, /<html lang="en">/);
  for (const page of [publicGatheringHtml(SHARED, ID, { saveData: true }), publicGatheringHtml(null, ID, { saveData: true })]) {
    assert.match(page.body, /<html lang="en" data-save-data="1">/);
    assert.match(page.body, /class="plate-ground door-ground"/);
  }
  const door = readFileSync(new URL("../../../public/door.css", import.meta.url), "utf8");
  assert.ok(door.includes("[data-save-data] .plate-ground{background-image:none;animation:none}"));
  assert.ok(door.includes("[data-save-data] .plate-ground::before,[data-save-data] .plate-ground::after,"));
});

test("QA N8: the share control asks for share state only as the host or a real steward, never as a plain admin", () => {
  const room = "shop";
  // A plain admin: no host role and no steward seat in this room. The admin grant is not an input.
  for (const shared of [false, true]) {
    assert.deepEqual(shareAccess({ host: false, stewardRooms: [], room, shared }), { mayRead: false, allowed: false });
    assert.deepEqual(shareAccess({ host: false, stewardRooms: ["county"], room, shared }), { mayRead: false, allowed: false });
    assert.deepEqual(shareAccess({ host: true, stewardRooms: [], room, shared }), { mayRead: true, allowed: true });
    assert.deepEqual(shareAccess({ host: false, stewardRooms: [room], room, shared }), { mayRead: true, allowed: shared });
  }
  assert.deepEqual(shareAccess({ host: false, stewardRooms: [""], room: "", shared: true }), { mayRead: false, allowed: false });
  const share = readFileSync(new URL("../../components/board/gathering-share.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(share, /state\.admin|\badmin \|\||const admin\b/, "the share control never reads the admin grant");
  assert.match(share, /const \{ mayRead, allowed \} = shareAccess\(\{ host, stewardRooms, room: card\.room, shared \}\)/);
  assert.match(share, /if \(!remote \|\| !mayRead\) return;\n\s*let live = true;\n\s*void loadGathering\(card\.id\)/);
});
