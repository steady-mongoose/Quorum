import type { ThemeId } from "@/lib/board/themes";

/** The theme's emblem, drawn in the current text and signal colors. */
export function Emblem({ theme, className }: { theme: ThemeId; className?: string }) {
  if (theme === "appeal") return <PineTree className={className} />;
  if (theme === "jerusalem") return <JerusalemCross className={className} />;
  if (theme === "gadsden") return <Rattlesnake className={className} />;
  return null;
}

/** The pine tree of the Pine Tree Flag (1775). */
function PineTree({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" fill="currentColor">
      <path d="M32 4 L42 20 H37 L46 34 H40 L50 48 H35 V60 H29 V48 H14 L24 34 H18 L27 20 H22 Z" />
    </svg>
  );
}

/** A cross potent with four crosslets. */
function JerusalemCross({ className }: { className?: string }) {
  const bar = (x: number, y: number, w: number, h: number) => <rect key={`${x}-${y}-${w}-${h}`} x={x} y={y} width={w} height={h} />;
  const small = (cx: number, cy: number) => [bar(cx - 1.5, cy - 5, 3, 10), bar(cx - 5, cy - 1.5, 10, 3)];
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" fill="currentColor">
      {bar(29, 8, 6, 48)}
      {bar(8, 29, 48, 6)}
      {bar(24, 8, 16, 4)}
      {bar(24, 52, 16, 4)}
      {bar(8, 24, 4, 16)}
      {bar(52, 24, 4, 16)}
      {small(17, 17)}
      {small(47, 17)}
      {small(17, 47)}
      {small(47, 47)}
    </svg>
  );
}

/** The coiled rattlesnake of the Gadsden flag, simplified. */
function Rattlesnake({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      {/* Three stacked coils, tail at the lower left. */}
      <path
        d="M14 52 H42 C51 52 51 38 42 38 H22 C13 38 13 24 22 24 H44"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Wedge head, raised, facing right. */}
      <path d="M43 20 C52 19 58 17 59 13 C59 10 55 8 50 9 C46 10 43 14 42 20 Z" fill="currentColor" />
      <circle cx="52" cy="13" r="1.4" fill="var(--color-bg)" />
      {/* Forked tongue. */}
      <path d="M59 12 L64 10 M59 12 L64 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Rattle. */}
      <rect x="2" y="50" width="3" height="4" rx="1" fill="currentColor" />
      <rect x="6" y="49" width="4" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}
