import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getBook, getLibrary } from "@/lib/library";
import { Score } from "@/components/score";
import { BookTuneControls } from "@/components/book-tune-controls";
import { TuneActions } from "@/components/tune-actions";
import { PrintButton } from "@/components/print-button";
import { getDefaultSound } from "@/lib/preferences";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [data, library, defaultSound] = await Promise.all([getBook(user.id, id), getLibrary(user.id), getDefaultSound(user.id)]);
  if (!data) notFound();
  const available = library.tunes.filter((tune) => !data.tunes.some((row) => row.tune.id === tune.id));
  return <div className="page-wrap book-page"><header className="page-head"><div><p className="eyebrow">TUNEBOOK · {data.tunes.length} {data.tunes.length === 1 ? "TUNE" : "TUNES"}</p><h1>{data.book.name}</h1><p className="page-subtitle">Scores in playing order.</p></div><PrintButton /></header>
    <BookTuneControls bookId={id} available={available} />
    {data.tunes.length ? <div className="book-scores">{data.tunes.map(({ tune }, index) => <section className="book-score" key={tune.id}><div className="score-order"><span>{String(index + 1).padStart(2, "0")}</span><div><BookTuneControls bookId={id} tuneId={tune.id} direction={index ? "up" : undefined} icon={<ArrowUp size={16} />} /><BookTuneControls bookId={id} tuneId={tune.id} direction={index < data.tunes.length - 1 ? "down" : undefined} icon={<ArrowDown size={16} />} /></div></div><div className="book-score-content"><Score tune={tune} defaultSound={defaultSound} /><TuneActions tuneId={tune.id} books={library.books} currentBookId={id} /></div></section>)}</div> : <div className="empty-state"><h2>No tunes in this book yet.</h2><p>Use the selector above to add a saved tune, or import one first.</p></div>}
  </div>;
}
