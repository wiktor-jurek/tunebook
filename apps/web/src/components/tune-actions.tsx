"use client";

import { trackLibraryAction } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, BookPlus, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Book = { id: string; name: string; emoji: string | null; inBook: boolean };
// One "more" menu per tune: which tunebooks it is in, and deleting it from the library.
export function TuneActions({ tuneId, title, currentBookId, labelled = false }: { tuneId: string; title: string; currentBookId?: string; labelled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
      trackLibraryAction(operation, "success", { book: books.find((book) => book.id === bookId)?.name });
      if (bookId) setBooks((current) => current.map((book) => book.id === bookId ? { ...book, inBook: operation === "addToBook" } : book));
      router.refresh();
      if (operation === "deleteSavedTune") router.push("/");
    } catch (cause) { trackLibraryAction(operation, "error", { book: books.find((book) => book.id === bookId)?.name }); setError(cause instanceof Error ? cause.message : "Request failed"); }
    finally { setBusy(false); }
  }
  return <div className="tune-actions">
    <DropdownMenu open={open} onOpenChange={(value) => { setOpen(value); if (value) void loadBooks(); }}>
      <DropdownMenuTrigger asChild>{labelled ? <Button size="sm" variant="ghost" disabled={busy}><BookPlus size={15} /> Tunebooks</Button> : <Button size="icon" variant="ghost" disabled={busy} aria-label={`More for ${title}`} title="More"><MoreHorizontal size={17} /></Button>}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12}><DropdownMenuLabel>In tunebooks</DropdownMenuLabel>{loading ? <p className="dropdown-message" role="status">Loading tunebooks</p> : books.length ? books.map((book) => <DropdownMenuCheckboxItem key={book.id} textValue={book.name} checked={book.inBook} disabled={busy} onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => void action(checked ? "addToBook" : "removeFromBook", book.id)}>{book.emoji ? <span aria-hidden="true">{book.emoji}</span> : <BookOpen size={14} />}<span>{book.name}</span></DropdownMenuCheckboxItem>) : !error && <p className="dropdown-message">Create a tunebook in the sidebar first.</p>}{error && <p role="alert" className="dropdown-message form-error">{error}</p>}
        {!currentBookId && <><DropdownMenuSeparator /><DropdownMenuItem className="dropdown-danger" onSelect={() => setConfirming(true)}><Trash2 size={15} /><span>Delete from library</span></DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
    {!open && error && <span role="alert" className="inline-error">{error}</span>}
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} busy={busy} title={`Delete ${title}?`} description="It is removed from your library and from every tunebook." action={busy ? "Deleting" : "Delete"} onConfirm={() => void action("deleteSavedTune").then(() => setConfirming(false))} />
  </div>;
}
