"use client";

import { trackEvent } from "@/lib/analytics";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type SetTask = { mode: "group"; bookId: string } | { mode: "edit" | "delete"; setId: string; name: string; tuneIds: string[]; bookCount: number };
export type SetChoice = { id: string; title: string };

export function SetDialog({ task, choices, onClose }: { task: SetTask; choices: SetChoice[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(task.mode === "group" ? "" : task.name);
  const [ordered, setOrdered] = useState<string[]>(task.mode === "group" ? [] : task.tuneIds);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null), cancelRef = useRef<HTMLButtonElement>(null);
  const deleting = task.mode === "delete";
  function move(index: number, offset: number) {
    setOrdered((current) => { const next = [...current]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  }
  function trackResult(outcome: "success" | "error") {
    if (task.mode === "group") trackEvent("set_created", { outcome, tune_count: ordered.length });
    else if (task.mode === "edit") trackEvent("set_updated", { outcome, tune_count: ordered.length, book_count: task.bookCount });
    else trackEvent("set_deleted", { outcome, book_count: task.bookCount });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const body = task.mode === "group" ? { operation: "group", bookId: task.bookId, name, entryIds: ordered }
        : deleting ? { operation: "delete", setId: task.setId } : { operation: "edit", setId: task.setId, name, tuneIds: ordered };
      const response = await fetch("/api/sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the set");
      trackResult("success"); onClose(); router.refresh();
    } catch (cause) { trackResult("error"); setError(cause instanceof Error ? cause.message : "Could not save the set"); setBusy(false); }
  }
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content library-dialog set-dialog" onOpenAutoFocus={(event) => { event.preventDefault(); if (deleting) cancelRef.current?.focus(); else nameRef.current?.focus(); }} onPointerDownOutside={(event) => { if (busy || deleting) event.preventDefault(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
    <form onSubmit={submit}><header className="library-dialog-head"><div><Dialog.Title className="dialog-title">{deleting ? `Delete “${task.name}”?` : task.mode === "group" ? "Group tunes into a set" : "Edit set"}</Dialog.Title><Dialog.Description className="library-dialog-description">{deleting ? "Tunes stay in your library and are ungrouped in every linked tunebook." : task.mode === "group" ? "Choose tunes in playing order. Your set will also appear in My sets." : `Changes update this set in all ${task.bookCount} linked tunebooks.`}</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" disabled={busy} aria-label="Close set dialog"><X size={18} /></button></Dialog.Close></header>
      <div className="library-dialog-body">{!deleting && <>
        <label className="field-label">Set name<Input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} disabled={busy} /></label>
        <div className="set-order-head"><h2>Playing order</h2><span>{ordered.length} tunes · choose at least 2</span></div>
        <ol className="set-order">{ordered.map((id, index) => <li key={id}><span className="contents-number">{String(index + 1).padStart(2, "0")}</span><span>{choices.find((choice) => choice.id === id)?.title ?? "Tune"}</span><Button type="button" variant="ghost" size="icon" disabled={busy || index === 0} aria-label={`Move ${choices.find((choice) => choice.id === id)?.title ?? "tune"} up`} onClick={() => move(index, -1)}><ArrowUp size={15} /></Button><Button type="button" variant="ghost" size="icon" disabled={busy || index === ordered.length - 1} aria-label={`Move ${choices.find((choice) => choice.id === id)?.title ?? "tune"} down`} onClick={() => move(index, 1)}><ArrowDown size={15} /></Button><Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`Remove ${choices.find((choice) => choice.id === id)?.title ?? "tune"} from selection`} onClick={() => setOrdered((current) => current.filter((value) => value !== id))}><X size={15} /></Button></li>)}</ol>
        {!ordered.length && <p className="muted">Select tunes below to build your set.</p>}
        <div className="folder-search"><Search size={16} /><Input aria-label="Find tunes for the set" placeholder="Find a tune…" value={query} onChange={(event) => setQuery(event.target.value)} disabled={busy} /></div>
        <fieldset className="set-choices" disabled={busy}><legend className="sr-only">Choose tunes</legend>{choices.filter((choice) => choice.title.toLowerCase().includes(query.toLowerCase())).map((choice) => <label key={choice.id}><input type="checkbox" checked={ordered.includes(choice.id)} onChange={(event) => setOrdered((current) => event.target.checked ? [...current, choice.id] : current.filter((id) => id !== choice.id))} /><span>{choice.title}</span></label>)}</fieldset>
      </>}{error && <p className="form-error" role="alert">{error}</p>}</div>
      <footer className="library-dialog-footer"><Dialog.Close asChild><Button ref={cancelRef} type="button" variant="outline" disabled={busy}>Cancel</Button></Dialog.Close><Button variant={deleting ? "danger" : "default"} disabled={busy || (!deleting && (!name.trim() || ordered.length < 2 || ordered.length > 100))}>{busy ? "Saving…" : deleting ? "Delete set" : task.mode === "group" ? "Create set" : "Save changes"}</Button></footer>
    </form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
