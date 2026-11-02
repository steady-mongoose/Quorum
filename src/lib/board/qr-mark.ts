/** The QR spec asks for four light modules on every side, or a scanner can miss the code. */
export const QR_QUIET_ZONE = 4;

/** One path for the dark modules, so no seams show between them at any scale. */
export function qrMark(modules: number[][]): { size: number; path: string } | null {
  const size = modules.length;
  if (size < 21 || size > 177) return null;
  let path = "";
  for (let y = 0; y < size; y += 1) {
    const row = modules[y];
    if (!row || row.length !== size) return null;
    for (let x = 0; x < size; x += 1) {
      if (row[x] === 1) path += `M${x + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { size: size + QR_QUIET_ZONE * 2, path };
}
