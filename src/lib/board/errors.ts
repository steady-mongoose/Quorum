export { userFacingError } from "../user-facing-error.ts";

export function removalFailedCopy(name: string): string {
  return `We couldn't remove ${name} just now. It's back in the list. Please try again in a moment.`;
}
