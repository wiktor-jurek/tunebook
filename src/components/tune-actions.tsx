"use client";

import { trackLibraryAction } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Book = { id: string; name: string; emoji: string | null; inBook: boolean };
export function TuneActions({ tuneId, currentBookId }: { tuneId: string; currentBookId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function loadBooks() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/library?tuneId=${encodeURIComponent(tuneId)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load tunebooks");
      setBooks(result.books);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load tunebooks"); }
    finally { setLoading(false); }
  }
  async function action(operation: "addToBook" | "removeFromBook" | "deleteSavedTune", bookId?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, bookId, tuneId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update tune");
      trackLibraryAction(operation, "success");
      if (bookId) setBooks((current) => current.map((book) => book.id === bookId ? { ...book, inBook: operation === "addToBook" } : book));
      router.refresh();
      if (operation === "deleteSavedTune") router.push("/");
    } catch (cause) { trackLibraryAction(operation, "error"); setError(cause instanceof Error ? cause.message : "Request failed"); }
    finally { setBusy(false); }
  }
  return <div className="tune-actions">
    <DropdownMenu open={open} onOpenChange={(value) => { setOpen(value); if (value) void loadBooks(); }}>
      <DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={busy} aria-label="Add or remove from tunebooks"><Plus size={14} /> Add to book <ChevronDown size={13} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12}><DropdownMenuLabel>Tunebooks</DropdownMenuLabel>{loading ? <p className="dropdown-message" role="status">Loading tunebooks</p> : books.length ? books.map((book) => <DropdownMenuCheckboxItem key={book.id} textValue={book.name} checked={book.inBook} disabled={busy} onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => void action(checked ? "addToBook" : "removeFromBook", book.id)}>{book.emoji ? <span aria-hidden="true">{book.emoji}</span> : <BookOpen size={14} />}<span>{book.name}</span></DropdownMenuCheckboxItem>) : !error && <p className="dropdown-message">Create a tunebook in the sidebar first.</p>}{error && <p role="alert" className="dropdown-message form-error">{error}</p>}</DropdownMenuContent>
    </DropdownMenu>
    {!currentBookId && <Button size="icon" variant="ghost" title="Delete saved tune" aria-label="Delete saved tune" disabled={busy} onClick={() => { if (window.confirm("Delete this saved tune from your library and all tunebooks?")) void action("deleteSavedTune"); }}><Trash2 size={15} /></Button>}
    {!open && error && <span role="alert" className="inline-error">{error}</span>}
  </div>;
}
