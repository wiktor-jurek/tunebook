"use client";

import { trackLibraryAction } from "@/lib/analytics";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { BookOpen, X } from "lucide-react";

const EmojiPicker = dynamic(() => import("@/components/emoji-picker"), {
  ssr: false,
  loading: () => <p className="emoji-loading">Loading emojis</p>,
});

type Props = { emoji: string | null; label: string; size?: "nav" | "page" | "draft" } & (
  { bookId: string; onChange?: never; readOnly?: boolean } | { bookId?: never; onChange: (emoji: string | null) => void; readOnly?: never }
);

export function BookIcon({ emoji, label, size = "nav", bookId, onChange, readOnly }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(nextEmoji: string | null) {
    if (busy) return;
    setError("");
    if (onChange) { onChange(nextEmoji); setOpen(false); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/library", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "setBookEmoji", bookId, emoji: nextEmoji }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update icon");
      trackLibraryAction("setBookEmoji", "success");
      setOpen(false);
      router.refresh();
    } catch (cause) { trackLibraryAction("setBookEmoji", "error"); setError(cause instanceof Error ? cause.message : "Could not update icon"); }
    finally { setBusy(false); }
  }

  if (readOnly) return <span className={`book-icon book-icon-${size}`} role="img" aria-label={label}>{emoji ? <span aria-hidden="true">{emoji}</span> : <BookOpen aria-hidden="true" />}</span>;

  return <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); setError(""); }}>
    <Popover.Trigger asChild>
      <button type="button" className={`book-icon book-icon-${size}`} aria-label={label} title={label}>
        {emoji ? <span aria-hidden="true">{emoji}</span> : <BookOpen aria-hidden="true" />}
      </button>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content className="emoji-popover" align="start" sideOffset={6} collisionPadding={12} aria-label="Choose a tunebook icon">
      <div className="emoji-popover-head"><span>Choose an icon</span><Popover.Close asChild><button type="button" className="icon-button" aria-label="Close emoji picker"><X size={15} /></button></Popover.Close></div>
      <div className="emoji-popover-picker" aria-busy={busy} inert={busy || undefined}><EmojiPicker onSelect={(next) => void choose(next)} /></div>
      <div className="emoji-popover-footer"><button type="button" className="emoji-reset" disabled={busy || !emoji} onClick={() => void choose(null)}><BookOpen size={14} /> Use default icon</button>{busy && <span role="status">Saving</span>}</div>
      {error && <p role="alert" className="form-error">{error}</p>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
