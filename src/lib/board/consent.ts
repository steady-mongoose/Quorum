/**
 * Copy and the server rule for the signup consent box. The box starts unticked.
 * Membership in a Christian community can reveal religious belief, a special
 * category of data, so the agreement names it.
 */
export const CONSENT_TEXT_BEFORE = "I agree to the ";
export const CONSENT_TERMS = "Terms";
export const CONSENT_AND = " and ";
export const CONSENT_PRIVACY = "Privacy Notice";
export const CONSENT_TEXT_AFTER = ", including that my membership may show my religious beliefs.";
export const CONSENT_LABEL = `${CONSENT_TEXT_BEFORE}${CONSENT_TERMS}${CONSENT_AND}${CONSENT_PRIVACY}${CONSENT_TEXT_AFTER}`;
export const CONSENT_ERROR = "Agree to the Terms and Privacy Notice to join.";
/**
 * /terms and /privacy do not exist yet, and the draft Terms and Privacy Notice are not
 * published. Until Josh approves them, both links open the existing About page.
 */
export const ABOUT_PATH = "/about";
export const TERMS_PATH = ABOUT_PATH;
export const PRIVACY_PATH = ABOUT_PATH;

/**
 * The version of the Terms and Privacy Notice a member agrees to. The drafts' effective
 * date is still a placeholder; set this to that date when Josh approves them.
 */
export const LEGAL_VERSION = "draft-2026-10-27";

/** Only a real boolean true counts. */
export function confirmedConsent(value: unknown): boolean {
  return value === true;
}
