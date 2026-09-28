import { describe, expect, it } from "vitest";
import { suggestTuneEmoji } from "./smart-emoji";
import { isSingleEmoji } from "./emoji";

describe("smart tune emojis", () => {
  it.each([
    ["Calliope House", "🏠"], ["A tailor I am", "👔"], ["Father O'Flynn", "👴"],
    ["Hag at the churn, The", "🧙‍♀️"], ["The Butterfly", "🦋"],
    ["The Silver Spear", "⚔️"], ["The Cat in the Corner", "🐈"],
    ["Flowers of Edinburgh", "💐"], ["The Boys of Bluehill", "👦"],
  ])("suggests a related icon for %s", (title, emoji) => expect(suggestTuneEmoji(title)).toBe(emoji));

  it("normalizes punctuation, plurals, casing, and accents", () => {
    expect(suggestTuneEmoji("THE HÁG AT THE CHURN (JIG)")).toBe("🧙‍♀️");
    expect(suggestTuneEmoji("Father O’Flynn")).toBe("👴");
    expect(suggestTuneEmoji("Butterflies")).toBe("🦋");
    expect(suggestTuneEmoji("The Houses")).toBe("🏘️");
  });

  it("ignores articles and tune types and uses a stable fallback for opaque names", () => {
    for (const title of ["", "The Jig", "Garrett Barry's", "Qzxvnt", "Wholesale"]) expect(suggestTuneEmoji(title)).toBe("🎵");
    expect(suggestTuneEmoji("Calliope House")).toBe(suggestTuneEmoji("Calliope House"));
  });

  it.each(["🏠", "🧙‍♀️", "👨‍👩‍👧‍👦", "👍🏽", "🇮🇪", "1️⃣", "❤️"])("accepts the single emoji %s", (emoji) => expect(isSingleEmoji(emoji)).toBe(true));
  it.each(["", "x", "hello", "1", "🏠🏠", " 🏠", "🏠 ", "🏠hello", "<script>", null, 12])("rejects non-emoji or multiple glyphs: %s", (emoji) => expect(isSingleEmoji(emoji)).toBe(false));
});
