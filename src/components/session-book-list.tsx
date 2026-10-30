import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { getLibrary } from "@/lib/library";

/** Session mode's home: the tunebooks to play from tonight, yours and those shared with you. */
export async function SessionBookList({ userId }: { userId: string }) {
  const { books, sharedBooks } = await getLibrary(userId);
  const row = (book: { id: string; name: string; emoji: string | null }) => <li key={book.id}><Link className="session-row" href={`/books/${book.id}`}>
    <span className="session-row-emoji" aria-hidden="true">{book.emoji ?? <BookOpen size={18} />}</span><span className="session-row-text"><span className="session-row-title">{book.name}</span></span><ChevronRight size={18} className="session-chevron" />
  </Link></li>;
  return <div className="session-screen"><h1 className="session-title">Tunebooks</h1>
    {!books.length && !sharedBooks.length && <p className="session-empty">Make a tunebook at home, or open one someone shared with you, and it appears here for the session. To name a tune that&apos;s playing, tap the microphone below.</p>}
    {books.length > 0 && <ul className="session-group">{books.map(row)}</ul>}
    {sharedBooks.length > 0 && <section><h2 className="session-group-title">Shared with you</h2><ul className="session-group">{sharedBooks.map(row)}</ul></section>}
  </div>;
}
