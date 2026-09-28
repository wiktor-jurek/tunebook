import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getBook, getLibrary } from "@/lib/library";
import { BookTuneControls } from "@/components/book-tune-controls";
import { BookScores } from "@/components/book-scores";
import { PrintButton } from "@/components/print-button";
import { getDefaultSound } from "@/lib/preferences";
import { BookIcon } from "@/components/book-icon";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [data, library, defaultSound] = await Promise.all([getBook(user.id, id), getLibrary(user.id), getDefaultSound(user.id)]);
  if (!data) notFound();
  const available = library.tunes.filter((tune) => !data.tunes.some((row) => row.tune.id === tune.id));
  return <div className="page-wrap book-page"><header className="page-head"><div><BookIcon size="page" bookId={id} emoji={data.book.emoji} label={`Change icon for ${data.book.name}`} /><p className="eyebrow">TUNEBOOK · {data.tunes.length} {data.tunes.length === 1 ? "TUNE" : "TUNES"}</p><h1>{data.book.name}</h1><p className="page-subtitle">Scores in playing order.</p></div><PrintButton /></header>
    <BookTuneControls bookId={id} available={available} />
    {data.tunes.length ? <BookScores key={id} bookId={id} tunes={data.tunes.map(({ tune }) => tune)} defaultSound={defaultSound} /> : <div className="empty-state"><h2>No tunes in this book yet.</h2><p>Use the selector above to add a saved tune, or add a new tune from Tunes.</p></div>}
  </div>;
}
