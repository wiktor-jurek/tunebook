// Rewrites tokens.json from globals.css. Run after changing a colour, radius or easing on the web.
import { writeFileSync } from "node:fs";
import { tokensFromCss } from "./css.mjs";

const tokens = { $comment: "Generated from apps/web/src/app/globals.css by `npm run extract -w packages/tokens`. Native apps are generated from this file.", ...tokensFromCss() };
writeFileSync(new URL("../tokens.json", import.meta.url), `${JSON.stringify(tokens, null, 2)}\n`);
console.log(`tokens.json: ${Object.keys(tokens.color).length} colours`);
