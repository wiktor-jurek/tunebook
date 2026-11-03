import { describe, expect, it } from "vitest";
import { suggestTuneEmoji } from "./smart-emoji";
import { isSingleEmoji } from "./emoji";

describe("smart tune emojis", () => {
  it("supports concurrent searches during model initialization", async () => {
    expect(await Promise.all(["The Stallion", "The Seamstress", "The Tempest"].map(suggestTuneEmoji))).toEqual(["🐎", "🪡", "⛈️"]);
  });

  it.each([
    ["Calliope House", "🏠"], ["A tailor I am", "👔"], ["Father O'Flynn", "👴"],
    ["Hag at the churn, The", "🧙‍♀️"], ["The Butterfly", "🦋"],
    ["The Silver Spear", "⚔️"], ["The Cat in the Corner", "🐈"],
    ["Flowers of Edinburgh", "💐"], ["The Boys of Bluehill", "👦"],
  ])("suggests a related icon for %s", async (title, emoji) => expect(await suggestTuneEmoji(title)).toBe(emoji));

  // These concepts occur in neither emojilib nor our explicit related-word hints.
  // Exercise the bundled real model, offline, rather than mocking vector outputs.
  it.each([
    ["The Seamstress", "🪡"], ["The Stallion", "🐎"],
    ["The Tempest", "⛈️"], ["A Winter Blizzard", "☃️"], ["The Voyage", "🛳️"],
  ])("finds a semantic match beyond the keyword vocabulary for %s", async (title, emoji) => {
    expect(await suggestTuneEmoji(title)).toBe(emoji);
  });

  it("normalizes punctuation, plurals, casing, and accents", async () => {
    expect(await suggestTuneEmoji("THE HÁG AT THE CHURN (JIG)")).toBe("🧙‍♀️");
    expect(await suggestTuneEmoji("Father O’Flynn")).toBe("👴");
    expect(await suggestTuneEmoji("Butterflies")).toBe("🦋");
    expect(await suggestTuneEmoji("The Houses")).toBe("🏠");
  });

  it("ignores articles and tune types and uses a stable fallback for opaque names", async () => {
    for (const title of ["", "The Jig", "Garrett Barry's", "Qzxvnt", "Wholesale"]) expect(await suggestTuneEmoji(title)).toBe("🎵");
    expect(await suggestTuneEmoji("Calliope House")).toBe(await suggestTuneEmoji("Calliope House"));
  });

  it.each(["🏠", "🧙‍♀️", "👨‍👩‍👧‍👦", "👍🏽", "🇮🇪", "1️⃣", "❤️"])("accepts the single emoji %s", (emoji) => expect(isSingleEmoji(emoji)).toBe(true));
  it.each(["", "x", "hello", "1", "🏠🏠", " 🏠", "🏠 ", "🏠hello", "<script>", null, 12])("rejects non-emoji or multiple glyphs: %s", (emoji) => expect(isSingleEmoji(emoji)).toBe(false));
});
