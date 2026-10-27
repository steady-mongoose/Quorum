const SEVERITY = ["csam", "porn", "threat", "doxxing", "blasphemy"];

/** Highest severity first; the same severity keeps the older report first. */
export function compareReasons<T extends { reason: string; at: number }>(a: T, b: T): number {
  const rank = (reason: string) => {
    const index = SEVERITY.indexOf(reason);
    return index === -1 ? SEVERITY.length : index;
  };
  return rank(a.reason) - rank(b.reason) || a.at - b.at;
}
