/**
 * Rule ids stored on a bar or a hard removal.
 * Doxxing and blasphemy stay their own ids. The moderation change adds them
 * to the form and the database check. This file does not rename them to threat.
 */
export const RULE_IDS = ["threat", "porn", "csam", "doxxing", "blasphemy"] as const;

export type RuleId = (typeof RULE_IDS)[number];

export function ruleId(value: string): RuleId {
  if (
    value === "threat" ||
    value === "porn" ||
    value === "csam" ||
    value === "doxxing" ||
    value === "blasphemy"
  ) {
    return value;
  }
  return "threat";
}
