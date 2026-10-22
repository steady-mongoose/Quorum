// One mark, set by the owner, on every screen. Ink and bone live in
// styles.css. The other marks stay for when the owner changes the emblem.

export type ThemeId = "appeal" | "jerusalem" | "gadsden";

/** The owner's choice. The council's pick: American, Christian, 1775, and no church room objects. */
export const OWNER_THEME: ThemeId = "appeal";

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
    id: "appeal",
    name: "An Appeal to Heaven",
    motto: "An Appeal to Heaven",
    colors: { bg: "#14100c", surface: "#1f1914", raised: "#241d16", fg: "#f0e7d3", muted: "#bcae94", line: "#3a3026", signal: "#f0e7d3", signalInk: "#14100c" },
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
