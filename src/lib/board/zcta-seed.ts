// National ZIP seed. Imported by the app only. Tests read the JSON with fs
// so the node test runner does not have to load a JSON module.

import seed from "./zcta-towns.json";
import type { ZipDirectory } from "./zcta.ts";

export const ZCTA_SEED = seed as unknown as ZipDirectory;
