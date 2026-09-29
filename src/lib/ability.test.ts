import { describe, expect, it } from "vitest";
import { abilityFromTempo, practiceSummary, resolvePractice } from "./ability";

describe("tune ability", () => {
  it.each([[null, "unlearned"], [0, "unlearned"], [50, "learning"], [99, "learning"], [100, "learned"], [124, "learned"], [125, "mastered"], [150, "mastered"]] as const)("maps %s%% to %s", (tempo, level) => {
    expect(abilityFromTempo(tempo)).toBe(level);
  });
  it("respects manual levels without losing the recorded speed", () => {
    expect(resolvePractice(150, "learning")).toEqual({ playableTempo: 150, levelOverride: "learning", level: "learning" });
    expect(resolvePractice(null, "mastered").level).toBe("mastered");
    expect(resolvePractice(150, "unlearned").level).toBe("unlearned");
  });
  it("counts unique catalog tunes and includes overrides in playable totals", () => {
    const learned = { tuneId: 1, practice: resolvePractice(100) };
    expect(practiceSummary([learned, learned, { tuneId: 2, practice: resolvePractice(50) }, { tuneId: 3, practice: resolvePractice(null, "mastered") }, { tuneId: 4, practice: resolvePractice() }])).toEqual({
      total: 4, playable: 2, percent: 50, counts: { unlearned: 1, learning: 1, learned: 1, mastered: 1 },
    });
    expect(practiceSummary([])).toMatchObject({ total: 0, playable: 0, percent: 0 });
  });
});
