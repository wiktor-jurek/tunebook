import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { getBook, getLibrary, isBookId } from "@/lib/library";
import { BookTuneControls } from "@/components/book-tune-controls";
import { BookScores } from "@/components/book-scores";
import { PrintButton } from "@/components/print-button";
import { getDefaultSound } from "@/lib/preferences";
import { DEFAULT_SOUND } from "@/lib/sounds";
import { BookIcon } from "@/components/book-icon";
import { Sidebar } from "@/components/sidebar";
import { ShareBookDialog } from "@/components/share-book-dialog";
import { SaveSharedBook } from "@/components/save-shared-book";
import { BookAnalytics } from "@/components/book-analytics";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isBookId(id)) notFound();
  const user = await currentUser();
  const data = await getBook(user?.id ?? null, id);
  if (!data) {
    if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/books/${id}`)}`);
    notFound();
  }
  const isOwner = user?.id === data.book.userId;
  const [library, defaultSound] = user ? await Promise.all([getLibrary(user.id), getDefaultSound(user.id)])
    : [{ folders: [], books: [], tunes: [], sharedBooks: [], sets: [] }, DEFAULT_SOUND];
  const sharedBook = { id: data.book.id, name: data.book.name, emoji: data.book.emoji };
  // A guest sees only this book; signed-in link visitors can also find the current book in the sidebar.
  if (!isOwner && !library.sharedBooks.some((book) => book.id === id)) library.sharedBooks.push(sharedBook);
  const available = isOwner ? library.tunes.filter((tune) => !data.tunes.some((row) => row.tune.id === tune.id)) : [];
  return <div className="app-shell"><Sidebar library={library} userName={user?.name} defaultSound={defaultSound} /><main className="main-content">
    <BookAnalytics key={id} isOwner={isOwner} signedIn={!!user} tuneCount={data.tunes.length} setCount={data.sections.filter((section) => section.kind === "set").length} />
    <div className="page-wrap book-page"><header className="page-head"><div><BookIcon size="page" bookId={id} emoji={data.book.emoji} label={isOwner ? `Change icon for ${data.book.name}` : "Tunebook icon"} readOnly={!isOwner} /><p className="eyebrow">{isOwner ? "TUNEBOOK" : "SHARED TUNEBOOK"} · {data.tunes.length} {data.tunes.length === 1 ? "TUNE" : "TUNES"}</p><h1>{data.book.name}</h1><p className="page-subtitle">Scores in playing order.{!isOwner && " View-only access."}</p></div><div className="book-page-actions">{isOwner && user && <ShareBookDialog bookId={id} name={data.book.name} ownerName={user.name} ownerEmail={user.email} />}{!isOwner && <SaveSharedBook bookId={id} signedIn={!!user} />}<PrintButton /></div></header>
      {isOwner && <BookTuneControls bookId={id} available={available} sets={library.sets.filter((set) => !data.sections.some((section) => section.kind === "set" && section.setId === set.id))} />}
      {data.tunes.length ? <BookScores key={id} bookId={id} sections={data.sections} defaultSound={defaultSound} readOnly={!isOwner} signedIn={!!user} libraryTunes={library.tunes} mySets={library.sets} /> : <div className="empty-state"><h2>No tunes in this book yet.</h2><p>{isOwner ? "Use the selectors above to add a tune or set, or save a new tune from Tunes." : "Tunes will appear here when the owner adds them."}</p></div>}
    </div>
  </main></div>;
}
