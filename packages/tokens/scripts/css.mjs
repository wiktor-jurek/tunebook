// Reads the design tokens out of apps/web/src/app/globals.css, the hand-edited source for the web.
// Shared by the drift test and by `npm run extract`, which rewrites tokens.json from the CSS.
import { readFileSync } from "node:fs";

export const GLOBALS_CSS = new URL("../../../apps/web/src/app/globals.css", import.meta.url);

function declarations(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`globals.css has no ${selector} block`);
  const from = css.indexOf("--", start);
  return Object.fromEntries([...css.slice(from, css.indexOf("}", from)).matchAll(/--([\w-]+):([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));
}

// "#fff" and "var(--brand-dot)" are colours; "{brand-dot}" is how tokens.json writes an alias.
const colour = (value) => value.startsWith("#") ? value.toLowerCase() : value.replace(/^var\(--([\w-]+)\)$/, "{$1}");
const isColour = (value) => value.startsWith("#") || /^var\(--[\w-]+\)$/.test(value);

/** The tokens as globals.css defines them, in tokens.json's shape. */
export function tokensFromCss(css = readFileSync(GLOBALS_CSS, "utf8")) {
  const light = declarations(css, ":root{color-scheme:light dark;");
  const dark = declarations(css, "@media screen and (prefers-color-scheme:dark)");
  const color = {};
  for (const [name, value] of Object.entries(light)) {
    if (!isColour(value)) continue;
    color[name] = { light: colour(value), dark: colour(dark[name] ?? value) };
  }
  const radius = Object.fromEntries(Object.entries(light).filter(([name]) => name.startsWith("radius")).map(([name, value]) => [name, Number.parseFloat(value)]));
  const ease = light.ease.match(/cubic-bezier\(([^)]+)\)/)[1].split(",").map(Number);
  const duration = Number.parseFloat(light.duration) * (light.duration.endsWith("ms") ? 1 : 1000);
  return { color, radius, motion: { ease, durationMs: duration } };
}
