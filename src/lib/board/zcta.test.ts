import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolvedTown, townSlug, zipRowsForMember, type ZipCorrection, type ZipDirectory } from "./zcta.ts";

const seed = JSON.parse(readFileSync(new URL("./zcta-towns.json", import.meta.url), "utf8")) as ZipDirectory;

function correction(patch: Partial<ZipCorrection> & Pick<ZipCorrection, "id" | "at">): ZipCorrection {
  return { zip: "90210", townId: "beverly-hills-ca", name: "Beverly Hills", state: "CA", by: "Ada", ...patch };
}

describe("census ZIP seed", () => {
  it("maps sample and well-known ZIPs to the dominant census place", () => {
    assert.deepEqual(seed["33578"], ["riverview-fl", "Riverview", "FL"]);
    assert.deepEqual(seed["33511"], ["brandon-fl", "Brandon", "FL"]);
    assert.deepEqual(seed["33594"], ["valrico-fl", "Valrico", "FL"]);
    assert.deepEqual(seed["33602"], ["tampa-fl", "Tampa", "FL"]);
    assert.deepEqual(seed["33610"], ["east-lake-orient-park-fl", "East Lake-Orient Park", "FL"]);
    assert.deepEqual(seed["10001"], ["new-york-ny", "New York", "NY"]);
    assert.deepEqual(seed["90210"], ["los-angeles-ca", "Los Angeles", "CA"]);
    assert.deepEqual(seed["89701"], ["carson-city-nv", "Carson City", "NV"]);
    assert.equal(seed["00000"], undefined);
  });

  it("keeps Carson City intact and slugs a two-word town", () => {
    assert.equal(townSlug("Carson City", "NV"), "carson-city-nv");
    assert.equal(townSlug("Beverly Hills", "CA"), "beverly-hills-ca");
  });

  it("lets the newest admin correction replace or clear the seed, for one ZIP", () => {
    assert.equal(resolvedTown("90210", seed)?.townId, "los-angeles-ca");
    const fixed = resolvedTown("90210", seed, [correction({ id: "a", at: 1 })]);
    assert.equal(fixed?.name, "Beverly Hills");
    assert.deepEqual(zipRowsForMember("90210", seed, [correction({ id: "a", at: 1 })]), [{ zip: "90210", townId: "beverly-hills-ca" }]);
    const cleared = resolvedTown("33578", seed, [correction({ id: "b", at: 2, zip: "33578", townId: "", name: "", state: "" })]);
    assert.equal(cleared, null);
    const restored = resolvedTown("33578", seed, [
      correction({ id: "b", at: 2, zip: "33578", townId: "", name: "", state: "" }),
      correction({ id: "c", at: 3, zip: "33578", townId: "riverview-fl", name: "Riverview", state: "FL" }),
    ]);
    assert.equal(restored?.townId, "riverview-fl");
    assert.deepEqual(zipRowsForMember("nope", seed), []);
  });
});
