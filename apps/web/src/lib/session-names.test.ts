import { describe, expect, it } from "vitest";
import { partOfDay, sessionMonth, sessionName } from "./session-names";

// Local times, so the tests read the same in any time zone.
const at = (day: number, hour: number, month = 10, year = 2026) => new Date(year, month, day, hour, 30);
const now = at(4, 22); // Wednesday 4 November 2026, 10:30 pm

describe("partOfDay", () => {
  it("splits the day at 5, 12, 17 and 21", () => {
    expect([4, 5, 11, 12, 16, 17, 20, 21].map((hour) => partOfDay(at(4, hour)))).toEqual(
      ["night", "morning", "morning", "afternoon", "afternoon", "evening", "evening", "night"]);
  });
});

describe("sessionName", () => {
  it("names today's sessions by the part of the day", () => {
    expect(sessionName(at(4, 9), now)).toBe("This morning");
    expect(sessionName(at(4, 19), now)).toBe("This evening");
    expect(sessionName(at(4, 21), now)).toBe("Tonight");
  });

  it("says yesterday, and last night", () => {
    expect(sessionName(at(3, 14), now)).toBe("Yesterday afternoon");
    expect(sessionName(at(3, 23), now)).toBe("Last night");
  });

  it("counts the small hours as the night before", () => {
    expect(sessionName(at(4, 1), now)).toBe("Last night");
    expect(sessionName(at(5, 1), at(5, 2))).toBe("Tonight");
  });

  it("names older sessions by weekday", () => {
    expect(sessionName(at(31, 20, 9), now)).toBe("Saturday evening");
  });
});

describe("sessionMonth", () => {
  it("gives the year only for other years", () => {
    expect(sessionMonth(at(4, 20), now)).toBe("November");
    expect(sessionMonth(at(4, 20, 10, 2025), now)).toBe("November 2025");
  });
});
