import { describe, expect, it } from "vitest";
import { lockTime, mcnemar, median, wilson } from "@/lib/finder/benchmark";

describe("benchmark statistics", () => {
  it("gives the Wilson interval", () => {
    const [low, high] = wilson(81, 100);
    expect(low).toBeCloseTo(0.7222, 3);
    expect(high).toBeCloseTo(0.8751, 3);
    expect(wilson(0, 0)).toEqual([0, 0]);
  });

  it("gives the exact McNemar p-value", () => {
    expect(mcnemar(0, 0)).toBe(1);
    expect(mcnemar(5, 5)).toBe(1);
    expect(mcnemar(1, 9)).toBeCloseTo(0.0215, 4); // 2 × 11/1024
    expect(mcnemar(17, 1)).toBeCloseTo(0.000145, 5);
  });

  it("finds when an engine locks on", () => {
    const prefixes = [2, 4, 6, 8];
    expect(lockTime("0111", prefixes)).toBe(4);
    expect(lockTime("1011", prefixes)).toBe(6);
    expect(lockTime("--11", prefixes)).toBe(6);
    expect(lockTime("1110", prefixes)).toBeNull();
    expect(lockTime(undefined, prefixes)).toBeNull();
    expect(median([8, 2, 4])).toBe(4);
    expect(median([2, 4])).toBe(3);
  });
});
