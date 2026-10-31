"use client";

import { Select } from "@/components/ui/select";
import { trackEvent, trackLibraryAction } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { getLibrary } from "@/lib/library";
import { displayTitle, displaySetTitle } from "@/lib/titles";

type Library = Awaited<ReturnType<typeof getLibrary>>;
export function BookTuneControls({ bookId, available, sets }: { bookId: string; available: Library["tunes"]; sets: Library["sets"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function add(kind: "tune" | "set", id: string) {
    if (!id || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(kind === "set" ? "/api/sets" : "/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "set" ? { operation: "copy", bookId, setId: id } : { operation: "addToBook", bookId, tuneId: id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update tunebook");
      if (kind === "set") trackEvent("set_added_to_book", { outcome: "success", name: sets.find((set) => set.id === id)?.name });
      else trackLibraryAction("addToBook", "success", { tune: available.find((tune) => tune.id === id)?.title });
      router.refresh();
    } catch (cause) { if (kind === "set") trackEvent("set_added_to_book", { outcome: "error", name: sets.find((set) => set.id === id)?.name }); else trackLibraryAction("addToBook", "error", { tune: available.find((tune) => tune.id === id)?.title }); setError(cause instanceof Error ? cause.message : "Could not update tunebook"); }
    finally { setBusy(false); }
  }
  return <div className="book-add book-add-items"><label className="field-label">Add tune<Select className="input" value="" disabled={busy} onValueChange={(value) => void add("tune", value)} placeholder="Choose a saved tune" options={available.map((tune) => ({ value: tune.id, label: `${tune.emoji ?? ""} ${displayTitle(tune.title)}`.trim(), text: displayTitle(tune.title) }))} /></label>{sets.length > 0 && <label className="field-label">Copy a set from another tunebook<Select className="input" value="" disabled={busy} onValueChange={(value) => void add("set", value)} placeholder="Choose a set" options={sets.map((set) => ({ value: set.id, label: `${displaySetTitle(set.name)}${set.books[0] ? `, from ${set.books[0].name}` : ""}`, text: displaySetTitle(set.name) }))} /></label>}{error && <span role="alert" className="inline-error">{error}</span>}</div>;
}
