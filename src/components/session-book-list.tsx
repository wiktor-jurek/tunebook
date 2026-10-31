import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { getLibrary } from "@/lib/library";
import { SessionBook } from "@/components/session-book";

type BookRow = { id: string; name: string; emoji: string | null };

function BookRows({ books, sharedBooks }: { books: BookRow[]; sharedBooks: BookRow[] }) {
  const row = (book: BookRow) => <li key={book.id}><Link className="session-row" href={`/books/${book.id}`}>
    <span className="session-row-emoji" aria-hidden="true">{book.emoji ?? <BookOpen size={18} />}</span><span className="session-row-text"><span className="session-row-title">{book.name}</span></span><ChevronRight size={18} className="session-chevron" />
  </Link></li>;
  if (!books.length && !sharedBooks.length) return <p className="session-empty">Make a tunebook at home, or open one someone shared with you, and it appears here for the session.</p>;
  return <>
    {books.length > 0 && <ul className="session-group">{books.map(row)}</ul>}
    {sharedBooks.length > 0 && <section><h2 className="session-group-title">Shared with you</h2><ul className="session-group">{sharedBooks.map(row)}</ul></section>}
  </>;
}

/** The session's tunebooks, yours and those shared with you. */
export async function SessionBookList({ userId }: { userId: string }) {
  const { books, sharedBooks } = await getLibrary(userId);
  return <div className="session-screen"><h1 className="session-title">Tunebooks</h1><BookRows books={books} sharedBooks={sharedBooks} /></div>;
}

/** Session mode's home: every tune you have, each opening to its score, or the same tunes as your tunebooks. */
export async function SessionTunes({ userId, view }: { userId: string; view: "tunes" | "books" }) {
  const { tunes, books, sharedBooks } = await getLibrary(userId);
  const tab = (value: typeof view, href: string, label: string) => <Link href={href} replace className="appearance-option" aria-current={view === value ? "page" : undefined}>{label}</Link>;
  return <div className="session-screen"><h1 className="session-title">Tunes</h1>
    <nav className="appearance-picker session-switch" aria-label="Show">{tab("tunes", "/", "All tunes")}{tab("books", "/?view=books", "Tunebooks")}</nav>
    {view === "books" ? <BookRows books={books} sharedBooks={sharedBooks} />
      : tunes.length ? <SessionBook name="Tunes" searchable sections={tunes.map((tune) => ({ kind: "tune", entryId: tune.id, tune: { ...tune, oftenPlayed: false } }))} />
      : <p className="session-empty">Save tunes at home, or name one that&apos;s playing with the microphone below, and they appear here.</p>}
  </div>;
}
