import { emailRateKey } from "./rate-limit.ts";

/**
 * Prints the normalized email used as the rate-limit key.
 * scripts/clear-email-limit.sh deletes the rows for that key.
 */
const email = process.argv[2] ?? "";
const key = emailRateKey(email);
if (!key) {
  console.error("Enter an email address.");
  process.exit(1);
}
process.stdout.write(key);
