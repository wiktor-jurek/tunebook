"use client";

import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";

export default function TunebookEmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  return <EmojiPicker
    width="100%"
    height="min(340px, calc(var(--radix-popover-content-available-height) - 96px))"
    emojiStyle={EmojiStyle.NATIVE}
    theme={Theme.LIGHT}
    searchPlaceholder="Search emojis…"
    previewConfig={{ showPreview: false }}
    lazyLoadEmojis
    onEmojiClick={({ emoji }) => onSelect(emoji)}
  />;
}
