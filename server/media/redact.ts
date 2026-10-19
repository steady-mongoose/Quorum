/** Signed URLs are bearer tokens. They do not belong in logs. */

export function redactSecrets(text: string): string {
  return text
    .replace(/X-Amz-Signature=[A-Za-z0-9%]+/gi, "X-Amz-Signature=redacted")
    .replace(/https?:\/\/[^\s"]+/gi, (url) => (url.includes("X-Amz-") ? "[signed-url]" : url));
}
