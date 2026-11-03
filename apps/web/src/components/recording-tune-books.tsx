"use client";

import { trackLibraryAction } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, BookPlus } from "lucide-react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { BookMembership } from "@/lib/recordings";

type Book = { id: string; name: string; emoji: string | null };

async function post(url: string, body: object) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not update the tunebook");
  return result;
}

/** Which of the person's tunebooks hold a tune heard in a recording, and a tick to add or remove it. */
export function RecordingTuneBooks({ title, settingId, savedId, inBooks, books }: { title: string; settingId: number; savedId: string | null; inBooks: BookMembership[]; books: Book[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const member = new Map(inBooks.map((book) => [book.id, book]));

  async function toggle(book: Book, add: boolean) {
    setBusy(true); setError("");
    try {
      if (add) {
        // A tune heard but never saved joins the library first; tunebooks hold saved tunes.
        const tuneId = savedId ?? (await post("/api/catalog", { settingId })).tuneId as string;
        await post("/api/library", { operation: "addToBook", bookId: book.id, tuneId });
      } else await post("/api/library", { operation: "removeFromBook", bookId: book.id, tuneId: member.get(book.id)!.copyId });
      trackLibraryAction(add ? "addToBook" : "removeFromBook", "success", { book: book.name, tune: title });
      router.refresh();
    } catch (cause) {
      trackLibraryAction(add ? "addToBook" : "removeFromBook", "error", { book: book.name, tune: title });
      setError(cause instanceof Error ? cause.message : "Could not update the tunebook");
    } finally { setBusy(false); }
  }

  const label = inBooks.length === 1 ? inBooks[0].name : inBooks.length ? `${inBooks.length} tunebooks` : "Add to tunebook";
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><button type="button" className={`recording-books ${inBooks.length ? "is-in" : ""}`} disabled={busy} aria-label={inBooks.length ? `${title} is in ${inBooks.map((b) => b.name).join(", ")}. Change tunebooks` : `Add ${title} to a tunebook`}>
      {inBooks.length ? <BookOpen size={13} aria-hidden="true" /> : <BookPlus size={13} aria-hidden="true" />}<span>{busy ? "Saving" : label}</span>
    </button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" collisionPadding={12}><DropdownMenuLabel>Tunebooks</DropdownMenuLabel>
      {books.length ? books.map((book) => {
        const membership = member.get(book.id);
        return <DropdownMenuCheckboxItem key={book.id} textValue={book.name} checked={!!membership} disabled={busy || membership?.viaSet} onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => void toggle(book, checked === true)}>
          {book.emoji ? <span aria-hidden="true">{book.emoji}</span> : <BookOpen size={14} />}<span>{book.name}</span>{membership?.viaSet && <span className="dropdown-hint">in a set</span>}
        </DropdownMenuCheckboxItem>;
      }) : <p className="dropdown-message">Make a tunebook first, from the sidebar.</p>}
      {error && <p role="alert" className="dropdown-message form-error">{error}</p>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
