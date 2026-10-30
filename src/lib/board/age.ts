/** Copy and the server rule for the 18+ check. The checkbox starts unticked. */

export const AGE_SIGNUP_LABEL = "I confirm I am 18 or older.";
export const AGE_INVITE_LABEL = "I confirm this person is 18 or older.";
export const AGE_SIGNUP_ERROR = "Confirm you are 18 or older.";
export const AGE_INVITE_ERROR = "Confirm this person is 18 or older.";

/** Only a real boolean true counts. A missing field, "true", or 1 does not. */
export function confirmedAdult(value: unknown): boolean {
  return value === true;
}

/** The one-time step for a member whose account predates the 18+ check. */
export const AGE_STEP_TITLE = "One thing before you go in";
export const AGE_STEP_BODY = "Avouch Social is for adults. Please confirm your age.";
