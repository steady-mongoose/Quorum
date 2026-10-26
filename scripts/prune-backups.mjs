#!/usr/bin/env node
/**
 * Delete Avouch dumps that `dumpsToDelete` says are past retention.
 * Usage: node scripts/prune-backups.mjs <directory> <retention-days>
 */
import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { dumpsToDelete } from "./backup-retention.mjs";

const dir = process.argv[2];
const days = Number(process.argv[3] ?? "14");
if (!dir) {
  console.error("Usage: node scripts/prune-backups.mjs <directory> <retention-days>");
  process.exit(1);
}
const stale = dumpsToDelete(readdirSync(dir), Date.now(), days);
for (const name of stale) {
  unlinkSync(join(dir, name));
  console.log(`Deleted ${name}`);
}
console.log(stale.length ? `Pruned ${stale.length} dump(s).` : "No dumps past retention.");
