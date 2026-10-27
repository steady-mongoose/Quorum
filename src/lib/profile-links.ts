/** The real host is always shown, so a label cannot hide where a link goes. */
export function linkText(link: { url: string; label: string }): string {
  let host = "";
  try {
    host = new URL(link.url).hostname;
  } catch {
    host = "";
  }
  const label = link.label.trim();
  if (!label) return host || link.url;
  return host ? `${label} (${host})` : label;
}
