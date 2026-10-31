"use client";

import { trackEvent } from "@/lib/analytics";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ListMusic, Pencil, Trash2, Ungroup } from "lucide-react";
import { RepeatMark } from "@/components/repeat-mark";
import { defaultSetName } from "@/lib/set-name";
import { displayTitle } from "@/lib/titles";
import { Button } from "@/components/ui/button";
import { SetDialog, type SetChoice, type SetDetails } from "@/components/set-dialog";
import type { BookSection } from "@/lib/library";

export function SetControls({ set, choices }: { set: SetDetails; choices: SetChoice[] }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="outline" size="sm" onClick={() => setOpen(true)}><Pencil size={14} />Edit set</Button>{open && <SetDialog set={set} choices={choices} onClose={() => setOpen(false)} />}</>;
}

/** Shown while tunes are ticked in an edited tunebook: groups them, in the order ticked, into a set named after them. */
export function GroupBar({ bookId, entryIds, titles, onDone }: { bookId: string; entryIds: string[]; titles: string[]; onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!entryIds.length) return null;
  async function group() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "group", bookId, entryIds }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not group the tunes");
      trackEvent("set_created", { outcome: "success", tune_count: entryIds.length, name: defaultSetName(titles.map((title) => ({ title }))) });
      onDone(); router.refresh();
    } catch (cause) { trackEvent("set_created", { outcome: "error", tune_count: entryIds.length }); setError(cause instanceof Error ? cause.message : "Could not group the tunes"); }
    finally { setBusy(false); }
  }
  return <div className="group-bar" role="region" aria-label="Group into a set">
    <p><RepeatMark />{entryIds.length < 2 ? `${displayTitle(titles[0] ?? "")}. Tick the tune played after it.` : titles.map(displayTitle).join(" / ")}</p>
    {error && <span className="inline-error" role="alert">{error}</span>}
    <Button variant="ghost" size="sm" disabled={busy} onClick={onDone}>Cancel</Button>
    <Button size="sm" disabled={busy || entryIds.length < 2} onClick={() => void group()}><ListMusic size={15} />{busy ? "Grouping" : "Group as a set"}</Button>
  </div>;
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
  return <div className="entry-controls"><Button variant="ghost" size="icon" disabled={busy || first} aria-label={`Move ${noun} up`} onClick={() => void update("up")}><ArrowUp size={15} /></Button><Button variant="ghost" size="icon" disabled={busy || last} aria-label={`Move ${noun} down`} onClick={() => void update("down")}><ArrowDown size={15} /></Button>{section.kind === "set" && <Button variant="ghost" size="sm" disabled={busy} title="Split the set back into single tunes" onClick={() => void update("ungroup")}><Ungroup size={14} />Ungroup</Button>}<Button variant="ghost" size="icon" disabled={busy} aria-label={section.kind === "set" ? "Remove the set and its tunes from this tunebook" : "Remove tune from this tunebook"} onClick={() => void update("remove")}><Trash2 size={15} /></Button>{error && <span className="inline-error" role="alert">{error}</span>}</div>;
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
