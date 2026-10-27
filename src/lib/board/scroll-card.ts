type ScrollTarget = {
  scrollIntoView?: (options: ScrollIntoViewOptions) => void;
};

/** Scroll the card Find just put back. Returns false when that card is not in the document yet. */
export function scrollRestoredCard(
  id: string,
  doc: { getElementById(elementId: string): ScrollTarget | null } | undefined = globalThis.document,
): boolean {
  const node = doc?.getElementById(`card-${id}`);
  if (!node?.scrollIntoView) return false;
  node.scrollIntoView({ block: "center" });
  return true;
}
