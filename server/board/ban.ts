import { ruleId } from "./rule.ts";

/**
 * Whether a bar is still in force at `now`.
 * A CSAM bar does not expire. A second strike does not expire.
 * A first strike of any other rule expires when its until time has passed,
 * including at that exact time.
 * openBan and the group list both use this. The list must not copy the rule into SQL.
 */
export function banOpen(
  row: { reason: string; strikes: number; until: number },
  now: number,
): boolean {
  const reason = ruleId(row.reason);
  return reason === "csam" || row.strikes >= 2 || row.until > now;
}
