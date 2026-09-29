import { describe, expect, it } from "vitest";
import abcjs from "abcjs";
import { abcForScore, abcForTune, noteNames } from "./notation";
import type { savedTunes } from "@/db/schema";

const tune = {
  title: "Example jig", kind: "jig", meter: "6/8", mode: "Gmajor", abc: "|: G3 GAB | A3 AGA :|",
} as typeof savedTunes.$inferSelect;

describe("notation preparation", () => {
  it("builds playable ABC from a setting body", () => {
    const abc = abcForTune(tune);
    const parsed = abcjs.parseOnly(abc);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].lines.length).toBeGreaterThan(0);
  });
  it("preserves complete ABC and formats concurrent notes", () => {
    expect(abcForTune({ ...tune, abc: "X:1\nT:Existing\nK:D\nDEFG|" })).toContain("T:Existing");
    expect(noteNames([{ pitch: 60 }, { pitch: 62 }])).toBe("C4, D4");
  });
  it("omits the duplicate visual title without changing the music or source ABC", () => {
    const source = abcForTune(tune);
    const visual = abcForScore(tune);
    expect(visual).not.toMatch(/^T:/m);
    expect(source).toContain("T:Example jig");
    const music = (abc: string) => JSON.parse(JSON.stringify(abcjs.parseOnly(abc)[0].lines, (key, value) => key === "startChar" || key === "endChar" ? undefined : value));
    expect(music(visual)).toEqual(music(source));
  });
});
