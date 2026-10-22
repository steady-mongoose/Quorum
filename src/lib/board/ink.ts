/** A post filed in this tab. Not stored. The settle plays once, on mount. */
let expecting = false;

export function expectFreshPost() {
  expecting = true;
}

export function cancelFreshPost() {
  expecting = false;
}

export function takeFreshPost(): boolean {
  if (!expecting) return false;
  expecting = false;
  return true;
}
