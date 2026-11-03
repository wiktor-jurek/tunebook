import { describe, expect, it } from "vitest";
import { playedSets } from "./played-sets";

const tune = (id: string, startS: number, endS: number) => ({ id, startMs: startS * 1000, endMs: endS * 1000 });

describe("playedSets", () => {
  it("keeps tunes played back to back together, and breaks on a long pause", () => {
    const sets = playedSets([tune("a", 0, 120), tune("b", 125, 240), tune("c", 400, 500), tune("d", 505, 600)]);
    expect(sets.map((set) => set.map((t) => t.id))).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("measures the pause from the latest end, so an overlapping tune does not split a set", () => {
    const sets = playedSets([tune("a", 0, 300), tune("b", 100, 150), tune("c", 310, 400)]);
    expect(sets.map((set) => set.map((t) => t.id))).toEqual([["a", "b", "c"]]);
  });
  it("returns nothing for an empty setlist and one set for a lone tune", () => {
    expect(playedSets([])).toEqual([]);
    expect(playedSets([tune("a", 0, 10)]).length).toBe(1);
  });
});
