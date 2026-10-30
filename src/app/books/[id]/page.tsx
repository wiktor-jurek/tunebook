import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/session";
import { getBook, getBookPreview, getLibrary, isBookId } from "@/lib/library";
import { BookTuneControls } from "@/components/book-tune-controls";
import { BookScores } from "@/components/book-scores";
import { PrintButton } from "@/components/print-button";
import { getDefaultSound } from "@/lib/preferences";
import { getPlayalongsBySetting } from "@/lib/playalongs";
import { DEFAULT_SOUND } from "@/lib/sounds";
import { BookIcon } from "@/components/book-icon";
import { Sidebar } from "@/components/sidebar";
import { ShareBookDialog } from "@/components/share-book-dialog";
import { SaveSharedBook } from "@/components/save-shared-book";
import { BookAnalytics } from "@/components/book-analytics";
import { AnalyticsIdentity } from "@/components/analytics-identity";
import { getMode } from "@/lib/mode";
import { SessionShell } from "@/components/session-shell";
import { SessionBook } from "@/components/session-book";
import { PublicHeader } from "@/components/public-header";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const preview = await getBookPreview((await params).id);
  if (!preview) return { title: { absolute: "Tune Companion" }, robots: { index: false } };
  const counts = [`${preview.tunes} ${preview.tunes === 1 ? "tune" : "tunes"}`, ...(preview.sets ? [`${preview.sets} ${preview.sets === 1 ? "set" : "sets"}`] : [])].join(", ");
  const description = `${counts} from ${preview.owner}. Read the scores, play along, and see which ones you can play.`;
  return { title: preview.name, description, robots: { index: false }, openGraph: { title: preview.name, description, type: "website", siteName: "Tune Companion" }, twitter: { card: "summary_large_image", title: preview.name, description } };
}

export default async function BookPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const [{ id }, { edit }] = await Promise.all([params, searchParams]);
  if (!isBookId(id)) notFound();
  const user = await currentUser();
  const data = await getBook(user?.id ?? null, id);
  if (!data) {
    if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/books/${id}`)}`);
    notFound();
  }
  const isOwner = user?.id === data.book.userId;
  const { mode, switchable } = await getMode();
  if (mode === "session") {
    const analytics = <BookAnalytics key={id} bookName={data.book.name} isOwner={isOwner} signedIn={!!user} tuneCount={data.tunes.length} setCount={data.sections.filter((section) => section.kind === "set").length} />;
    const reader = <div className="session-screen"><h1 className="session-title">{data.book.name}</h1>{analytics}{data.tunes.length ? <SessionBook name={data.book.name} sections={data.sections} /> : <p className="session-empty">No tunes in this book yet.</p>}</div>;
    return user ? <SessionShell switchable={switchable} userName={user.name}>{reader}<AnalyticsIdentity user={{ id: user.id, name: user.name, email: user.email }} /></SessionShell> : <div className="landing"><PublicHeader next={`/books/${id}`} />{reader}</div>;
  }
  // Owners read a book like anyone else until they choose Edit, which brings out the reordering and adding controls.
  const editing = isOwner && edit === "1";
  const [library, defaultSound] = user ? await Promise.all([getLibrary(user.id), getDefaultSound(user.id)])
    : [{ folders: [], books: [], tunes: [], sharedBooks: [], sets: [] }, DEFAULT_SOUND];
  const playalongs = await getPlayalongsBySetting(data.tunes.map((row) => row.tune.settingId));
  const sharedBook = { id: data.book.id, name: data.book.name, emoji: data.book.emoji };
  // A guest sees only this book; signed-in link visitors can also find the current book in the sidebar.
  if (!isOwner && !library.sharedBooks.some((book) => book.id === id)) library.sharedBooks.push(sharedBook);
  const available = isOwner ? library.tunes.filter((tune) => !data.tunes.some((row) => row.tune.id === tune.id)) : [];
  return <div className="app-shell"><Sidebar library={library} userName={user?.name} defaultSound={defaultSound} /><main className="main-content">
    {user && <AnalyticsIdentity user={{ id: user.id, name: user.name, email: user.email }} />}
    <BookAnalytics key={id} bookName={data.book.name} isOwner={isOwner} signedIn={!!user} tuneCount={data.tunes.length} setCount={data.sections.filter((section) => section.kind === "set").length} />
    <div className="page-wrap book-page"><header className="page-head"><div><BookIcon size="page" bookId={id} emoji={data.book.emoji} label={isOwner ? `Change icon for ${data.book.name}` : "Tunebook icon"} readOnly={!isOwner} /><h1>{data.book.name}<span className="heading-count">{data.tunes.length}</span></h1>{!isOwner && user && <p className="page-subtitle">Shared with you, view only</p>}</div><div className="book-page-actions">{isOwner && <Button asChild variant={editing ? "default" : "outline"}><Link href={editing ? `/books/${id}` : `/books/${id}?edit=1`} replace scroll={false}>{editing ? "Done" : "Edit"}</Link></Button>}{isOwner && user && <ShareBookDialog bookId={id} name={data.book.name} ownerName={user.name} ownerEmail={user.email} />}{!isOwner && <SaveSharedBook bookId={id} signedIn={!!user} />}<PrintButton /></div></header>
      {editing && <BookTuneControls bookId={id} available={available} sets={library.sets.filter((set) => !data.sections.some((section) => section.kind === "set" && section.setId === set.id))} />}
      {data.tunes.length ? <BookScores key={id} bookId={id} sections={data.sections} defaultSound={defaultSound} readOnly={!isOwner} editing={editing} signedIn={!!user} libraryTunes={library.tunes} mySets={library.sets} playalongs={playalongs} /> : <div className="empty-state"><h2>No tunes in this book yet.</h2><p>{isOwner ? (editing ? "Use the selectors above to add a tune or set." : "Choose Edit to add tunes and sets.") : "Tunes will appear here when the owner adds them."}</p></div>}
    </div>
  </main></div>;
}
