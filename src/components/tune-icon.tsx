"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { RotateCcw, X } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

const EmojiPicker = dynamic(() => import("@/components/emoji-picker"), { ssr: false, loading: () => <p className="emoji-loading">Loading emojis…</p> });
type Tune = { id: string; title: string; emoji: string; suggestedEmoji: string; emojiOverride: string | null };

export function TuneIcon({ tune, readOnly = false, size = "list" }: { tune: Tune; readOnly?: boolean; size?: "list" | "page" | "book" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const className = `tune-icon tune-icon-${size}`;
  async function choose(emoji: string | null) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/tunes/${tune.id}/emoji`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update icon");
      trackEvent("tune_icon_changed", { outcome: "success", source: emoji === null ? "suggested" : "custom" });
      setOpen(false); router.refresh();
    } catch (cause) { trackEvent("tune_icon_changed", { outcome: "error", source: emoji === null ? "suggested" : "custom" }); setError(cause instanceof Error ? cause.message : "Could not update icon"); }
    finally { setBusy(false); }
  }
  if (readOnly) return <span className={className} role="img" aria-label="Tune icon"><span aria-hidden="true">{tune.emoji}</span></span>;
  return <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); setError(""); }}>
    <Popover.Trigger asChild><button type="button" className={className} aria-label={`Change icon for ${tune.title}`} title={`Change icon for ${tune.title}`}><span aria-hidden="true">{tune.emoji}</span></button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="emoji-popover tune-emoji-popover" align="start" sideOffset={6} collisionPadding={12} aria-label="Choose a tune icon">
      <div className="emoji-popover-head"><span>Choose a tune icon</span><Popover.Close asChild><button type="button" className="icon-button" aria-label="Close emoji picker"><X size={15} /></button></Popover.Close></div>
      <p className="tune-emoji-hint">Changes only your saved copy.</p>
      <div className="emoji-popover-picker" aria-busy={busy} inert={busy || undefined}><EmojiPicker onSelect={(emoji) => void choose(emoji)} /></div>
      <div className="emoji-popover-footer"><button type="button" className="emoji-reset" disabled={busy || tune.emojiOverride === null} onClick={() => void choose(null)}><RotateCcw size={14} />Use suggested icon <span aria-hidden="true">{tune.suggestedEmoji}</span></button>{busy && <span role="status">Saving…</span>}</div>
      {error && <p role="alert" className="form-error">{error}</p>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
