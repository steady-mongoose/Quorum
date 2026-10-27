/** A machine code has no spaces. A sentence written for a person does. */
export function userFacingError(error: string, fallback: string): string {
  const trimmed = error.trim();
  if (!trimmed || !/\s/.test(trimmed)) return fallback;
  return trimmed;
}
