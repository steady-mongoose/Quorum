import { useState } from "react";
import { cn } from "@/lib/cn";
import type { ThemeId } from "@/lib/board/themes";

/** The real artwork, from public/flags (see SOURCES.md there). */
const ART: Partial<Record<ThemeId, { src: string; alt: string; square?: boolean }>> = {
  appeal: { src: "/flags/appeal-to-heaven.svg", alt: "An Appeal to Heaven flag" },
  jerusalem: { src: "/flags/jerusalem-cross.svg", alt: "Jerusalem cross", square: true },
  gadsden: { src: "/flags/gadsden.svg", alt: "Gadsden flag" },
};

const SIZE = {
  header: { flag: "h-14 w-21 sm:h-16 sm:w-24", square: "h-14 w-14 sm:h-16 sm:w-16" },
  pill: { flag: "h-6 w-9", square: "h-6 w-6" },
};

/**
 * The theme's emblem: the real flag file, or the drawn version below if
 * the file does not load.
 */
export function Emblem({ theme, size }: { theme: ThemeId; size: keyof typeof SIZE }) {
  const [failed, setFailed] = useState(false);
  const art = ART[theme];
  if (!art) return null;
  const className = cn("shrink-0 rounded-sm border border-line bg-[#f7f4ec] object-contain", SIZE[size][art.square ? "square" : "flag"]);
  if (failed) return <Drawn theme={theme} className={className} />;
  return <img src={art.src} alt={art.alt} className={className} onError={() => setFailed(true)} />;
}

function Drawn({ theme, className }: { theme: ThemeId; className?: string }) {
  if (theme === "appeal") return <AppealToHeaven className={className} />;
  if (theme === "jerusalem") return <JerusalemCross className={className} />;
  if (theme === "gadsden") return <Gadsden className={className} />;
  return null;
}

const LETTERING = { fontFamily: "Fraunces, Georgia, serif", fontWeight: 700, letterSpacing: 1.2 } as const;

/** The Pine Tree Flag, 1775: a white field, a green pine, the motto above. */
function AppealToHeaven({ className }: { className?: string }) {
  const bough = "#2b6a3c";
  const boughDark = "#1f5230";
  return (
    <svg viewBox="0 0 150 100" className={className} role="img" aria-label="An Appeal to Heaven flag">
      <rect width="150" height="100" fill="#f7f4ec" />
      <text x="75" y="17" textAnchor="middle" fontSize="9.5" fill="#1f3d2b" style={LETTERING}>
        AN APPEAL TO HEAVEN
      </text>
      {/* Trunk and roots */}
      <rect x="72" y="76" width="6" height="16" fill="#5a3a1c" />
      <path d="M62 93 Q75 89 88 93" stroke="#5a3a1c" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Boughs, bottom tier first so the upper tiers overlap */}
      <polygon points="75,46 90,66 85,65 97,82 53,82 65,65 60,66" fill={boughDark} />
      <polygon points="75,34 87,52 83,51 92,66 58,66 67,51 63,52" fill={bough} />
      <polygon points="75,22 83,36 80,35 87,48 63,48 70,35 67,36" fill={boughDark} />
      <polygon points="75,22 79,30 71,30" fill={bough} />
      {/* Grass */}
      <path d="M40 94 Q75 88 110 94" stroke={bough} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M48 92 l2 -5 M58 93 l1 -5 M93 93 l-1 -5 M102 92 l-2 -5" stroke={bough} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** The Gadsden flag: yellow field, coiled rattlesnake on grass, the motto below. */
function Gadsden({ className }: { className?: string }) {
  const body = "#4a4518";
  const belly = "#c9b86a";
  const coil = "M34 66 H98 C112 66 112 50 98 50 H58 C46 50 46 36 58 36 H88";
  return (
    <svg viewBox="0 0 150 100" className={className} role="img" aria-label="Gadsden flag">
      <rect width="150" height="100" fill="#f7d117" />
      {/* Grass */}
      <path d="M22 70 Q45 62 75 68 T128 70 L128 77 Q75 86 22 77 Z" fill="#5f8f2f" />
      <path d="M30 70 l3 -8 M44 68 l2 -8 M60 69 l3 -8 M90 69 l-2 -8 M106 70 l-3 -8 M120 71 l-2 -7" stroke="#4a7324" strokeWidth="1.6" strokeLinecap="round" />
      {/* Rattle */}
      <rect x="20" y="62" width="5" height="7" rx="1.5" fill={body} />
      <rect x="26" y="61" width="6" height="9" rx="2" fill={body} />
      {/* Body: dark outline, lighter belly stripe, diamond markings */}
      <path d={coil} fill="none" stroke={body} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      <path d={coil} fill="none" stroke={belly} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 7" />
      <g fill="#8a7a2e">
        <polygon points="46,62 50,66 46,70 42,66" />
        <polygon points="66,62 70,66 66,70 62,66" />
        <polygon points="86,62 90,66 86,70 82,66" />
        <polygon points="66,46 70,50 66,54 62,50" />
        <polygon points="86,46 90,50 86,54 82,50" />
        <polygon points="72,32 76,36 72,40 68,36" />
      </g>
      {/* Head, raised and open */}
      <path d="M86 30 C98 27 108 24 114 19 C117 16 114 11 108 12 C100 13 92 20 86 30 Z" fill={body} />
      <path d="M100 14 L112 17 L108 22 Z" fill="#b53a2a" />
      <circle cx="104" cy="17.5" r="2" fill="#f7f4ec" />
      <circle cx="104.6" cy="17.5" r="1" fill="#1a1a05" />
      <path d="M114 19 L122 15 M114 19 L122 20" stroke="#b53a2a" strokeWidth="1.6" strokeLinecap="round" />
      <text x="75" y="93" textAnchor="middle" fontSize="9.5" fill="#1a1a05" style={LETTERING}>
        DONT TREAD ON ME
      </text>
    </svg>
  );
}

/** The Jerusalem cross: a cross potent with four crosslets, red on white. */
function JerusalemCross({ className }: { className?: string }) {
  const red = "#c8322b";
  const bar = (x: number, y: number, w: number, h: number) => <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} fill={red} />;
  const crosslet = (cx: number, cy: number) => [bar(cx - 2, cy - 7, 4, 14), bar(cx - 7, cy - 2, 14, 4)];
  return (
    <svg viewBox="0 0 150 100" className={className} role="img" aria-label="Jerusalem cross">
      <rect width="150" height="100" fill="#f7f4ec" />
      {bar(71, 8, 8, 84)}
      {bar(33, 46, 84, 8)}
      {bar(58, 8, 34, 5)}
      {bar(58, 87, 34, 5)}
      {bar(33, 33, 5, 34)}
      {bar(112, 33, 5, 34)}
      {crosslet(53, 29)}
      {crosslet(97, 29)}
      {crosslet(53, 71)}
      {crosslet(97, 71)}
    </svg>
  );
}
