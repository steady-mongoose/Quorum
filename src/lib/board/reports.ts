import { HARD_RULES, type HardRuleValue } from "./text.ts";

/**
 * Highest severity first. CSAM, then pornography, then calls for violence,
 * threats, and plans or instructions for an attack (stored as threat),
 * then doxxing, then blasphemy. The queue uses this order in every space.
 */
export const REPORT_SEVERITY: readonly HardRuleValue[] = [
  "csam",
  "porn",
  "threat",
  "doxxing",
  "blasphemy",
];

export const REPORT_REASONS: readonly HardRuleValue[] = HARD_RULES.filter((rule) =>
  REPORT_SEVERITY.includes(rule),
);

export function reportRank(reason: string): number {
  const index = REPORT_SEVERITY.indexOf(reason as HardRuleValue);
  return index === -1 ? REPORT_SEVERITY.length : index;
}

/** Highest severity first. The same severity keeps the older report first. */
export function compareReports<T extends { reason: string; at: number }>(a: T, b: T): number {
  return reportRank(a.reason) - reportRank(b.reason) || a.at - b.at;
}
