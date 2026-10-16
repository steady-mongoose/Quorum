// Build src/lib/board/zcta-towns.json from the Census 2020 ZCTA-to-Place
// relationship file (public domain). One ZIP maps to the place with the
// largest land overlap. The class word (city, CDP, town, …) is dropped.
// Download the source first:
//   curl -fsSL -o /tmp/zcta_place.txt \
//     https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt
//   node scripts/build-zcta-towns.mjs /tmp/zcta_place.txt

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FIPS = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
  "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
  "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
  "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
  "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
  "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP", "72": "PR", "78": "VI",
};

const SUFFIXES = [
  " unified government (balance)",
  " consolidated government (balance)",
  " metropolitan government (balance)",
  " metro government (balance)",
  " city (balance)",
  " unified government",
  " consolidated government",
  " metropolitan government",
  " metro government",
  " urban county",
  " metro township",
  " zona urbana",
  " city",
  " CDP",
  " town",
  " village",
  " borough",
  " municipality",
  " comunidad",
  " corporation",
  " township",
];

export function placeName(raw) {
  let name = raw.trim();
  for (const suffix of SUFFIXES) {
    // Case-sensitive so "Carson City" stays intact and "Tampa city" / "Riverview CDP" lose the class word.
    if (name.endsWith(suffix) && name.length > suffix.length) {
      name = name.slice(0, -suffix.length).trim();
      break;
    }
  }
  return name;
}

export function townSlug(name, state) {
  const base = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const st = state.trim().toLowerCase();
  return base && st ? `${base}-${st}` : "";
}

export function dominantPlaces(text) {
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const header = headerLine.split("|");
  const col = Object.fromEntries(header.map((name, i) => [name, i]));
  /** @type {Map<string, { area: number, name: string, state: string, tie: boolean }>} */
  const best = new Map();
  for (const line of lines) {
    if (!line) continue;
    const p = line.split("|");
    const zip = p[col.GEOID_ZCTA5_20];
    const raw = (p[col.NAMELSAD_PLACE_20] ?? "").trim();
    if (!/^\d{5}$/.test(zip) || !raw) continue;
    const name = placeName(raw);
    const fips = (p[col.GEOID_PLACE_20] ?? "").slice(0, 2);
    const state = FIPS[fips] ?? "";
    const area = Number(p[col.AREALAND_PART] ?? 0);
    if (!name || !state || !Number.isFinite(area)) continue;
    const prev = best.get(zip);
    if (!prev || area > prev.area) best.set(zip, { area, name, state, tie: false });
    else if (area === prev.area && (name !== prev.name || state !== prev.state)) prev.tie = true;
  }
  /** @type {Record<string, [string, string, string]>} */
  const out = {};
  for (const [zip, row] of best) {
    if (row.tie) continue;
    const id = townSlug(row.name, row.state);
    if (!id) continue;
    out[zip] = [id, row.name, row.state];
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.argv[2];
  if (!source) {
    console.error("Pass the Census relationship file path.");
    process.exit(1);
  }
  const out = dominantPlaces(readFileSync(source, "utf8"));
  const dest = new URL("../src/lib/board/zcta-towns.json", import.meta.url);
  writeFileSync(dest, JSON.stringify(out));
  console.error(`wrote ${Object.keys(out).length} ZIPs`);
}
