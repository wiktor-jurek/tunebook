// Appearance is a per-device choice, like a phone's own setting: dark in the pub, light at a desk.
// It lives in a cookie so the server renders the right theme on the first paint.
export type Theme = "system" | "light" | "dark";
export const THEME_COOKIE = "theme";
export const THEMES: Theme[] = ["system", "light", "dark"];

export function parseTheme(value: string | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/** Browser chrome colours, matching --background in globals.css. */
export const THEME_COLORS = { light: "#fafaf8", dark: "#111110" };

/** Applies a theme in the browser straight away and remembers it for this device. */
export function applyTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}
