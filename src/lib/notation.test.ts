import { describe, expect, it } from "vitest";
import abcjs from "abcjs";
import { abcForScore, abcForTune, keyName, noteNames, openingPhrase } from "./notation";
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

describe("keyName", () => {
  it("spaces the tonic from the mode", () => {
    expect(keyName("Dmajor")).toBe("D major");
    expect(keyName("F#minor")).toBe("F# minor");
    expect(keyName("Bbmixolydian")).toBe("Bb mixolydian");
  });
  it("leaves other text alone", () => {
    expect(keyName("D major")).toBe("D major");
    expect(keyName(null)).toBe(null);
  });
});

describe("openingPhrase", () => {
  const tune = (abc: string) => ({ title: "Test", kind: "jig", meter: "6/8", mode: "Dmajor", abc });
  it("keeps the first two bars and the headers", () => {
    const abc = openingPhrase(tune("|:ABA cBA|dfe dBA|ABA cBA|d2e f3:|"));
    expect(abc).toContain("K:Dmajor");
    expect(abc.split("\n").at(-1)).toBe("ABA cBA | dfe dBA |]");
  });
  it("keeps a pickup before the first full bar", () => {
    expect(openingPhrase(tune("A|dfe dBA|ABA cBA|d2e f3|]")).split("\n").at(-1)).toBe("A | dfe dBA | ABA cBA |]");
  });
  it("drops the tempo and rhythm headings", () => {
    expect(openingPhrase(tune("ABA cBA|dfe dBA|"))).not.toMatch(/^[QR]:/m);
  });
});
