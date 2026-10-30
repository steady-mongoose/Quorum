/**
 * Move focus to `el` from script and show the team ring there, even when the browser
 * would not match :focus-visible (after a mouse click, say). The mark is
 * `data-focus-ring`, styled on `[data-focus-ring]:focus` in styles.css, and it comes
 * off on blur, so a later mouse click on the same element (a <summary>, say) draws
 * no ring.
 */
export function focusWithRing(el: HTMLElement | null | undefined): void {
  if (!el) return;
  el.setAttribute("data-focus-ring", "");
  el.addEventListener("blur", () => el.removeAttribute("data-focus-ring"), { once: true });
  el.focus();
}
