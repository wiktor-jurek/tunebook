"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { getLibrary } from "@/lib/library";

type Books = Awaited<ReturnType<typeof getLibrary>>["books"];
export function TuneActions({ tuneId, books, currentBookId }: { tuneId: string; books: Books; currentBookId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function action(operation: string, bookId?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, bookId, tuneId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update tune");
      router.refresh();
      if (operation === "deleteSavedTune") router.push("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed"); }
    finally { setBusy(false); }
  }
  return <div className="tune-actions">
    {books.length > 0 && <label className="add-book"><Plus size={15} /><span className="sr-only">Add to tunebook</span><select disabled={busy} value="" aria-label="Add to tunebook" onChange={(event) => { if (event.target.value) void action("addToBook", event.target.value); }}><option value="">Add to book</option>{books.map((book) => <option value={book.id} key={book.id}>{book.name}</option>)}</select></label>}
    {currentBookId && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action("removeFromBook", currentBookId)}>Remove from book</Button>}
    {!currentBookId && <Button size="icon" variant="ghost" title="Delete saved tune" aria-label="Delete saved tune" disabled={busy} onClick={() => { if (window.confirm("Delete this saved tune from your library and all tunebooks?")) void action("deleteSavedTune"); }}><Trash2 size={15} /></Button>}
    {error && <span role="alert" className="inline-error">{error}</span>}
  </div>;
}
