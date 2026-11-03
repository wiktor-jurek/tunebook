import emojiRegex from "emoji-regex";

export function isSingleEmoji(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 32) return false;
  const match = emojiRegex().exec(value);
  return match?.[0] === value && [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length === 1;
}
