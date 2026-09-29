"use client";

import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import { useEffect, useRef } from "react";

export default function TunebookEmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    // The picker exposes a grid whose children are native headings/buttons, not gridcells.
    // Keep its keyboard handlers and expose categories as groups of native buttons.
    const normalizeSemantics = () => {
      root.querySelectorAll('[role="grid"], [role="rowgroup"], [role="row"]').forEach((element) => element.setAttribute("role", "group"));
      root.querySelectorAll("input").forEach((element) => {
        if (element.getAttribute("role") !== "searchbox") element.setAttribute("role", "searchbox");
        for (const attribute of ["aria-controls", "aria-expanded", "aria-haspopup", "aria-activedescendant", "aria-autocomplete"]) element.removeAttribute(attribute);
      });
    };
    normalizeSemantics();
    const observer = new MutationObserver(normalizeSemantics);
    observer.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["role", "aria-controls", "aria-expanded", "aria-haspopup", "aria-activedescendant", "aria-autocomplete"] });
    return () => observer.disconnect();
  }, []);
  return <div ref={container}><EmojiPicker
    width="100%"
    height="min(340px, calc(var(--radix-popover-content-available-height) - 96px))"
    emojiStyle={EmojiStyle.NATIVE}
    theme={Theme.LIGHT}
    searchPlaceholder="Search emojis"
    previewConfig={{ showPreview: false }}
    lazyLoadEmojis
    onEmojiClick={({ emoji }) => onSelect(emoji)}
  /></div>;
}
