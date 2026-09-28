"use client";

import { trackEvent } from "@/lib/analytics";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ListMusic, Pencil, Trash2, Ungroup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SetDialog, type SetChoice, type SetTask } from "@/components/set-dialog";
import type { BookSection } from "@/lib/library";

export function SetControls({ task, choices, label, variant = "outline" }: { task: SetTask; choices: SetChoice[]; label?: string; variant?: "outline" | "ghost" }) {
  const [open, setOpen] = useState(false);
  return <><Button variant={variant} size="sm" onClick={() => setOpen(true)} disabled={task.mode === "group" && choices.length < 2}>{task.mode === "group" ? <ListMusic size={15} /> : task.mode === "delete" ? <Trash2 size={14} /> : <Pencil size={14} />}{label ?? (task.mode === "group" ? "Group tunes into a set" : task.mode === "delete" ? "Delete set" : "Edit set")}</Button>{open && <SetDialog task={task} choices={choices} onClose={() => setOpen(false)} />}</>;
}

export function EntryControls({ bookId, section, first, last }: { bookId: string; section: BookSection; first: boolean; last: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const noun = section.kind === "set" ? "set" : "tune";
  async function update(action: "up" | "down" | "ungroup" | "remove") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "entry", bookId, entryId: section.entryId, action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update tunebook");
      trackEvent("book_entry_changed", { outcome: "success", kind: section.kind, action });
      router.refresh();
    } catch (cause) { trackEvent("book_entry_changed", { outcome: "error", kind: section.kind, action }); setError(cause instanceof Error ? cause.message : "Could not update tunebook"); }
    finally { setBusy(false); }
  }
  return <div className="entry-controls"><Button variant="ghost" size="icon" disabled={busy || first} aria-label={`Move ${noun} up`} onClick={() => void update("up")}><ArrowUp size={15} /></Button><Button variant="ghost" size="icon" disabled={busy || last} aria-label={`Move ${noun} down`} onClick={() => void update("down")}><ArrowDown size={15} /></Button>{section.kind === "set" && <Button variant="ghost" size="sm" disabled={busy} title="Keep the tunes here as individual tunes; the set stays in My sets" onClick={() => void update("ungroup")}><Ungroup size={14} />Ungroup</Button>}<Button variant="ghost" size="icon" disabled={busy} aria-label={`Remove ${noun} from this tunebook`} onClick={() => void update("remove")}><Trash2 size={15} /></Button>{error && <span className="inline-error" role="alert">{error}</span>}</div>;
}

export function SetTuneOrder({ setId, tuneId, first, last }: { setId: string; tuneId: string; first: boolean; last: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function move(direction: "up" | "down") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "moveTune", setId, tuneId, direction }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not change set order");
      trackEvent("set_tune_reordered", { outcome: "success", direction });
      router.refresh();
    } catch (cause) { trackEvent("set_tune_reordered", { outcome: "error", direction }); setError(cause instanceof Error ? cause.message : "Could not change set order"); }
    finally { setBusy(false); }
  }
  return <div className="entry-controls"><Button variant="ghost" size="icon" disabled={busy || first} aria-label="Move tune up within set" onClick={() => void move("up")}><ArrowUp size={15} /></Button><Button variant="ghost" size="icon" disabled={busy || last} aria-label="Move tune down within set" onClick={() => void move("down")}><ArrowDown size={15} /></Button>{error && <span className="inline-error" role="alert">{error}</span>}</div>;
}
