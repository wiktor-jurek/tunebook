import { describe, expect, it } from "vitest";
import { timeAgo } from "@/components/local-time";

const now = new Date(2026, 10, 1, 10, 0);
describe("timeAgo", () => {
  it("counts calendar days, not 24-hour spans", () => {
    expect(timeAgo(new Date(2026, 10, 1, 8, 0), now)).toBe("today");
    expect(timeAgo(new Date(2026, 9, 31, 23, 30), now)).toBe("yesterday");
    expect(timeAgo(new Date(2026, 9, 29, 21, 0), now)).toBe("3 days ago");
  });
  it("moves to weeks, months and years", () => {
    expect(timeAgo(new Date(2026, 9, 20), now)).toBe("last week");
    expect(timeAgo(new Date(2026, 9, 10), now)).toBe("3 weeks ago");
    expect(timeAgo(new Date(2026, 8, 1), now)).toBe("2 months ago");
    expect(timeAgo(new Date(2025, 9, 1), now)).toBe("last year");
    expect(timeAgo(new Date(2023, 5, 1), now)).toBe("3 years ago");
  });
});
