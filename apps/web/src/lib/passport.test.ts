import { describe, expect, it, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
import { bandForRank, lastMonths, markStandards, passportHeadline, pluralKind, popularityPersona, rankFavourites, stampsFor, typeBreakdown, typePersona } from "./passport";

describe("player passport", () => {
  it.each([[1, 1], [100, 1], [101, 2], [500, 2], [2000, 3], [8000, 4], [8001, 5], [40000, 5]])("puts catalogue rank %s in band %s", (rank, band) => {
    expect(bandForRank(rank)).toBe(band);
  });

  it("counts tunes per type, most first, ignoring case and untyped tunes", () => {
    expect(typeBreakdown([
      { kind: "Jig", level: "learned" }, { kind: "jig", level: "learning" }, { kind: "reel", level: "mastered" }, { kind: null, level: "mastered" },
    ])).toEqual([{ kind: "jig", total: 2, playable: 1 }, { kind: "reel", total: 1, playable: 1 }]);
  });

  it("says what kind of player you are from what you can play", () => {
    expect(typePersona([{ kind: "jig", total: 10, playable: 2 }, { kind: "waltz", total: 3, playable: 3 }]))
      .toEqual({ title: "Waltz person", line: "60% of what you can play are waltzes." });
    expect(typePersona([{ kind: "slip jig", total: 4, playable: 4 }])?.title).toBe("Slip jig person");
    expect(typePersona([{ kind: "air", total: 1, playable: 1 }])?.title).toBe("Slow air soul");
  });

  it("falls back to every tune before any can be played, and to nothing with no tunes", () => {
    expect(typePersona([{ kind: "reel", total: 3, playable: 0 }, { kind: "jig", total: 1, playable: 0 }]))
      .toEqual({ title: "Reel person", line: "75% of your tunes are reels." });
    expect(typePersona([])).toBeNull();
  });

  it("pluralises tune types", () => {
    expect(["jig", "waltz", "march", "slip jig", "barndance"].map(pluralKind)).toEqual(["jigs", "waltzes", "marches", "slip jigs", "barndances"]);
  });

  it("places you between the standards and the rarities by your median band", () => {
    expect(popularityPersona([1, 1, 2])?.title).toBe("Crowd-pleaser");
    expect(popularityPersona([1, 4, 4, 5])?.title).toBe("Deep cut digger");
    expect(popularityPersona([5])?.title).toBe("Collector of rarities");
    expect(popularityPersona([])).toBeNull();
  });

  it("ranks favourites by stars, sessions heard and level, leaving out tunes with no signal", () => {
    const tune = (title: string, level: "learning" | "learned" | "mastered", starred: number, heard: number) => ({ tuneId: title.length, title, level, starred, heard });
    const ranked = rankFavourites([
      tune("Kesh", "learned", 0, 0), tune("Banshee", "learning", 2, 0), tune("Silver Spear", "mastered", 0, 0), tune("Merry Blacksmith", "learned", 1, 3),
    ]);
    expect(ranked.map((t) => t.title)).toEqual(["Merry Blacksmith", "Banshee", "Silver Spear"]);
    expect(rankFavourites(ranked, 1)).toHaveLength(1);
  });

  it("sums you up in a line", () => {
    expect(passportHeadline({ title: "Jig person", line: "" }, { title: "Deep cut digger", line: "" })).toBe("A jig person who digs deep cuts.");
    expect(passportHeadline({ title: "Air person", line: "" }, null)).toBe("An air person.");
    expect(passportHeadline(null, null)).toBe("Your passport starts with your first tune.");
  });

  describe("stamps", () => {
    const day = (n: number) => new Date(Date.UTC(2026, 0, n));
    const tune = (tuneId: number, kind: string, level: "learned" | "mastered" | "learning", n: number, band = 1) =>
      ({ tuneId, kind, level, band, addedAt: day(n), levelAt: day(n + 1) });

    it("dates each earned stamp and lists them first, in the order earned", () => {
      const stamps = stampsFor([tune(1, "jig", "learning", 1), tune(2, "reel", "mastered", 5, 5)],
        [{ recordedAt: day(3), durationMs: 3 * 3_600_000, tunes: 25 }]);
      expect(stamps.filter((stamp) => stamp.earned).map((stamp) => [stamp.id, stamp.at?.slice(0, 10)])).toEqual([
        ["first-tune", "2026-01-01"], ["first-session", "2026-01-03"], ["big-night", "2026-01-03"], ["marathon", "2026-01-03"],
        ["lead", "2026-01-06"], ["deep-cut", "2026-01-06"],
      ]);
    });

    it("shows how far there is to go for the ones still to earn", () => {
      const stamps = stampsFor([tune(1, "jig", "learned", 1), tune(2, "reel", "learned", 2)], []);
      expect(stamps.find((stamp) => stamp.id === "play-10")).toMatchObject({ earned: false, at: null, progress: { have: 2, need: 10 } });
      expect(stamps.find((stamp) => stamp.id === "all-rounder")?.progress).toEqual({ have: 2, need: 5 });
    });

    it("earns the all-rounder when the last of the five types becomes playable", () => {
      const five = ["jig", "reel", "hornpipe", "polka", "slide"].map((kind, i) => tune(i + 1, kind, "learned", i + 1));
      expect(stampsFor(five, []).find((stamp) => stamp.id === "all-rounder")?.at?.slice(0, 10)).toBe("2026-01-06");
    });
  });

  it("counts sessions over the last twelve months, oldest first, with empty months as zeros", () => {
    const months = lastMonths([{ recordedAt: new Date("2026-11-03T20:00:00Z"), durationMs: 90 * 60000 }, { recordedAt: new Date("2025-01-01T20:00:00Z"), durationMs: 1 }],
      new Date("2026-11-04T12:00:00Z"));
    expect(months).toHaveLength(12);
    expect(months[0].month).toBe("2025-12");
    expect(months.at(-1)).toEqual({ month: "2026-11", sessions: 1, minutes: 90 });
    expect(months.slice(0, -1).every((month) => month.sessions === 0)).toBe(true);
  });

  it("marks the standards with where you stand", () => {
    const marked = markStandards([{ tuneId: 1, title: "The Kesh", kind: "jig" }, { tuneId: 2, title: "Drowsy Maggie", kind: "reel" }, { tuneId: 3, title: "Out On The Ocean", kind: "jig" }],
      new Map([[1, { id: "a", level: "mastered" as const }], [2, { id: "b", level: "learning" as const }]]));
    expect(marked).toMatchObject({ total: 3, playable: 1, learning: 1, wanted: 0 });
    expect(marked.tunes[2]).toEqual({ tuneId: 3, title: "Out On The Ocean", kind: "jig", level: null, savedId: null });
  });
});
