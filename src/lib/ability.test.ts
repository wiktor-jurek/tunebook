import { describe, expect, it } from "vitest";
import { ABILITY_LABELS, abilityFromTempo, playAlongSentence, practiceSummary, resolvePractice } from "./ability";

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
      total: 4, playable: 2, percent: 50, counts: { unlearned: 1, wanted: 0, learning: 1, learned: 1, mastered: 1 },
    });
    expect(practiceSummary([])).toMatchObject({ total: 0, playable: 0, percent: 0 });
  });
  it("keeps Want to learn apart from Not assessed and out of the play-along count", () => {
    expect(resolvePractice(null, "wanted").level).toBe("wanted");
    expect(practiceSummary([{ tuneId: 1, practice: resolvePractice(null, "wanted") }, { tuneId: 2, practice: resolvePractice() }])).toMatchObject({ total: 2, playable: 0, counts: { wanted: 1, unlearned: 1 } });
    expect(ABILITY_LABELS.unlearned).toBe("Not assessed");
    expect(ABILITY_LABELS.learned).toBe("Can play along");
  });
  it("says how many tunes can be played along with", () => {
    expect(playAlongSentence(3, 4)).toBe("You can play along with 3 of these 4 tunes.");
    expect(playAlongSentence(4, 4)).toBe("You can play along with all 4 of these tunes.");
    expect(playAlongSentence(0, 1)).toBe("You can't play along with this tune yet.");
  });
});
