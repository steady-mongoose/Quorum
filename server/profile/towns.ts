/**
 * Fixed towns for the three counties Avouch covers, plus Elsewhere.
 * A member picks one of these. The list is not a ranking.
 */

export type CountyId = "hillsborough" | "manatee" | "pinellas";

export type Town = { id: string; name: string; county: CountyId };

export const COUNTIES: { id: CountyId; name: string }[] = [
  { id: "hillsborough", name: "Hillsborough" },
  { id: "manatee", name: "Manatee" },
  { id: "pinellas", name: "Pinellas" },
];

export const ELSEWHERE_ID = "elsewhere";

export const TOWNS: Town[] = [
  { id: "tampa", name: "Tampa", county: "hillsborough" },
  { id: "temple-terrace", name: "Temple Terrace", county: "hillsborough" },
  { id: "plant-city", name: "Plant City", county: "hillsborough" },
  { id: "brandon", name: "Brandon", county: "hillsborough" },
  { id: "riverview", name: "Riverview", county: "hillsborough" },
  { id: "valrico", name: "Valrico", county: "hillsborough" },
  { id: "seffner", name: "Seffner", county: "hillsborough" },
  { id: "lutz", name: "Lutz", county: "hillsborough" },
  { id: "ruskin", name: "Ruskin", county: "hillsborough" },
  { id: "apollo-beach", name: "Apollo Beach", county: "hillsborough" },
  { id: "sun-city-center", name: "Sun City Center", county: "hillsborough" },
  { id: "wimauma", name: "Wimauma", county: "hillsborough" },
  { id: "gibsonton", name: "Gibsonton", county: "hillsborough" },
  { id: "thonotosassa", name: "Thonotosassa", county: "hillsborough" },
  { id: "fishhawk", name: "FishHawk", county: "hillsborough" },
  { id: "town-n-country", name: "Town 'n' Country", county: "hillsborough" },
  { id: "westchase", name: "Westchase", county: "hillsborough" },
  { id: "carrollwood", name: "Carrollwood", county: "hillsborough" },
  { id: "citrus-park", name: "Citrus Park", county: "hillsborough" },
  { id: "dover", name: "Dover", county: "hillsborough" },
  { id: "lithia", name: "Lithia", county: "hillsborough" },
  { id: "mango", name: "Mango", county: "hillsborough" },
  { id: "odessa", name: "Odessa", county: "hillsborough" },
  { id: "bradenton", name: "Bradenton", county: "manatee" },
  { id: "palmetto", name: "Palmetto", county: "manatee" },
  { id: "anna-maria", name: "Anna Maria", county: "manatee" },
  { id: "holmes-beach", name: "Holmes Beach", county: "manatee" },
  { id: "bradenton-beach", name: "Bradenton Beach", county: "manatee" },
  { id: "ellenton", name: "Ellenton", county: "manatee" },
  { id: "parrish", name: "Parrish", county: "manatee" },
  { id: "lakewood-ranch", name: "Lakewood Ranch", county: "manatee" },
  { id: "myakka-city", name: "Myakka City", county: "manatee" },
  { id: "cortez", name: "Cortez", county: "manatee" },
  { id: "longboat-key", name: "Longboat Key", county: "manatee" },
  { id: "samoset", name: "Samoset", county: "manatee" },
  { id: "bayshore-gardens", name: "Bayshore Gardens", county: "manatee" },
  { id: "st-petersburg", name: "St. Petersburg", county: "pinellas" },
  { id: "clearwater", name: "Clearwater", county: "pinellas" },
  { id: "largo", name: "Largo", county: "pinellas" },
  { id: "pinellas-park", name: "Pinellas Park", county: "pinellas" },
  { id: "dunedin", name: "Dunedin", county: "pinellas" },
  { id: "safety-harbor", name: "Safety Harbor", county: "pinellas" },
  { id: "tarpon-springs", name: "Tarpon Springs", county: "pinellas" },
  { id: "oldsmar", name: "Oldsmar", county: "pinellas" },
  { id: "seminole", name: "Seminole", county: "pinellas" },
  { id: "gulfport", name: "Gulfport", county: "pinellas" },
  { id: "kenneth-city", name: "Kenneth City", county: "pinellas" },
  { id: "belleair", name: "Belleair", county: "pinellas" },
  { id: "belleair-beach", name: "Belleair Beach", county: "pinellas" },
  { id: "belleair-bluffs", name: "Belleair Bluffs", county: "pinellas" },
  { id: "st-pete-beach", name: "St. Pete Beach", county: "pinellas" },
  { id: "treasure-island", name: "Treasure Island", county: "pinellas" },
  { id: "indian-rocks-beach", name: "Indian Rocks Beach", county: "pinellas" },
  { id: "indian-shores", name: "Indian Shores", county: "pinellas" },
  { id: "madeira-beach", name: "Madeira Beach", county: "pinellas" },
  { id: "redington-beach", name: "Redington Beach", county: "pinellas" },
  { id: "redington-shores", name: "Redington Shores", county: "pinellas" },
  { id: "north-redington-beach", name: "North Redington Beach", county: "pinellas" },
  { id: "south-pasadena", name: "South Pasadena", county: "pinellas" },
  { id: "palm-harbor", name: "Palm Harbor", county: "pinellas" },
  { id: "east-lake", name: "East Lake", county: "pinellas" },
  { id: "lealman", name: "Lealman", county: "pinellas" },
  { id: "tierra-verde", name: "Tierra Verde", county: "pinellas" },
];

export type StoredLocation = {
  town: string;
  county: string;
  townName: string;
  countyName: string;
};

export function countyName(id: string): string {
  return COUNTIES.find((county) => county.id === id)?.name ?? "";
}

/** A stored pair, Elsewhere, or null when the pair is not on the list. */
export function storedLocation(county: string, town: string): StoredLocation | null {
  if (town === ELSEWHERE_ID && county === "") {
    return { town: ELSEWHERE_ID, county: "", townName: "Elsewhere", countyName: "" };
  }
  const found = TOWNS.find((item) => item.id === town && item.county === county);
  if (!found) return null;
  return {
    town: found.id,
    county: found.county,
    townName: found.name,
    countyName: countyName(found.county),
  };
}

export function parseLocation(
  value: unknown,
): { ok: true; county: string; town: string } | { ok: false; error: string } {
  if (value === null) return { ok: true, county: "", town: "" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Choose a town." };
  }
  const body = value as { county?: unknown; town?: unknown };
  const town = typeof body.town === "string" ? body.town.trim() : "";
  const county = typeof body.county === "string" ? body.county.trim() : "";
  if (town === ELSEWHERE_ID) return { ok: true, county: "", town: ELSEWHERE_ID };
  if (!storedLocation(county, town)) return { ok: false, error: "Choose a town from the list." };
  return { ok: true, county, town };
}
