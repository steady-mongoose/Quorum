import { spawnSync } from "node:child_process";

function commandOnPath(name) {
  const found = spawnSync("sh", ["-c", 'command -v "$1"', "sh", name], { encoding: "utf8" });
  return found.status === 0 && found.stdout.trim().length > 0;
}

/** True when both age tools are executable. Tests that encrypt a dump need them. */
export function ageInstalled() {
  return commandOnPath("age-keygen") && commandOnPath("age");
}
