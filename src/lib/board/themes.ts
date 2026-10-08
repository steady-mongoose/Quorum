// Looks for The Board. Each theme is a palette and an emblem. The emblems
// are historical flags and a cross drawn as inline SVG in emblem.tsx.

export type ThemeId = "plain" | "appeal" | "jerusalem" | "gadsden";

export type Theme = {
  id: ThemeId;
  name: string;
  /** Shown under the title. */
  motto: string;
  colors: {
    bg: string;
    surface: string;
    raised: string;
    fg: string;
    muted: string;
    line: string;
    signal: string;
    signalInk: string;
  };
};

export const THEMES: Theme[] = [
  {
    id: "plain",
    name: "Plain",
    motto: "",
    colors: { bg: "#0e0e0c", surface: "#171714", raised: "#221f1a", fg: "#f3efe6", muted: "#a39b8c", line: "#322e28", signal: "#e6a23c", signalInk: "#1a1206" },
  },
  {
    id: "appeal",
    name: "An Appeal to Heaven",
    motto: "An Appeal to Heaven",
    colors: { bg: "#0f1a14", surface: "#16241b", raised: "#1e3025", fg: "#f3efe6", muted: "#a6b5a4", line: "#2c4034", signal: "#e9e2c8", signalInk: "#14251a" },
  },
  {
    id: "jerusalem",
    name: "Jerusalem cross",
    motto: "",
    colors: { bg: "#140d0d", surface: "#1d1212", raised: "#281818", fg: "#f3efe6", muted: "#b39c93", line: "#3b2424", signal: "#c8322b", signalInk: "#fff3f0" },
  },
  {
    id: "gadsden",
    name: "Don't Tread on Me",
    motto: "Don't tread on me",
    colors: { bg: "#121208", surface: "#1a1a0d", raised: "#242413", fg: "#f3efd0", muted: "#aaa888", line: "#36361c", signal: "#e8c73a", signalInk: "#1a1a05" },
  },
];

export function themeById(id: ThemeId): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/** Inline CSS custom properties that override the Tailwind theme tokens. */
export function themeVars(theme: Theme): Record<string, string> {
  const c = theme.colors;
  return {
    "--color-bg": c.bg,
    "--color-surface": c.surface,
    "--color-raised": c.raised,
    "--color-fg": c.fg,
    "--color-muted": c.muted,
    "--color-line": c.line,
    "--color-signal": c.signal,
    "--color-signal-ink": c.signalInk,
  };
}
