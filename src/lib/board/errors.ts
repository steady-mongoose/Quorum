export { userFacingError } from "../user-facing-error.ts";

export function removalFailedCopy(name: string | readonly string[]): string {
  const names = (Array.isArray(name) ? name : [name]).map((item) => item.trim()).filter(Boolean);
  if (names.length === 0) {
    return "We couldn't remove that gathering just now. It's back in the list. Please try again in a moment.";
  }
  if (names.length === 1) {
    return `We couldn't remove ${names[0]} just now. It's back in the list. Please try again in a moment.`;
  }
  const list =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  return `We couldn't remove ${list} just now. They're back in the list. Please try again in a moment.`;
}
