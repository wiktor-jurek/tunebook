import { describe, expect, it } from "vitest";
import { resolvePractice, type AbilityLevel } from "./ability";
import { groupTunes } from "./tune-groups";

const tune = (title: string, kind: string | null, mode: string | null, level: AbilityLevel) => ({ title, kind, mode, practice: resolvePractice(null, level) });
const tunes = [tune("A", "reel", "Dmajor", "learning"), tune("B", "jig", "Ador", "mastered"), tune("C", "waltz", null, "unlearned"), tune("D", null, "Dmajor", "learning")];
const shape = (by: Parameters<typeof groupTunes>[1]) => groupTunes(tunes, by).map((group) => [group.label, group.tunes.map((t) => t.title).join("")]);

describe("groupTunes", () => {
  it("groups by stage of learning, what you can play first", () => {
    expect(shape("stage")).toEqual([["Can lead", "B"], ["Learning", "AD"], ["Not assessed", "C"]]);
  });
  it("groups by key and by type alphabetically, with tunes lacking one last", () => {
    expect(shape("key")).toEqual([["A dor", "B"], ["D major", "AD"], ["No key", "C"]]);
    expect(shape("type")).toEqual([["Jig", "B"], ["Reel", "A"], ["Waltz", "C"], ["Other", "D"]]);
  });
  it("keeps one unlabelled group when not grouping, and none for no tunes", () => {
    expect(shape("none")).toEqual([["", "ABCD"]]);
    expect(groupTunes([], "stage")).toEqual([]);
  });
});
