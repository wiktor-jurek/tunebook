// tokens.json must match globals.css, and the generated native tokens must match tokens.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tokensFromCss } from "../scripts/css.mjs";
import { OUTPUTS, kotlin, load, swift } from "../scripts/generate.mjs";

test("tokens.json matches globals.css (run npm run extract -w packages/tokens)", () => {
  const { $comment, ...tokens } = load();
  assert.deepEqual(tokens, tokensFromCss());
});

test("Tokens.swift and Tokens.kt are up to date (run npm run generate -w packages/tokens)", () => {
  assert.equal(readFileSync(OUTPUTS.swift, "utf8"), swift(load()));
  assert.equal(readFileSync(OUTPUTS.kotlin, "utf8"), kotlin(load()));
});
