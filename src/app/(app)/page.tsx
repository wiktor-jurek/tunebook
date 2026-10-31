import { Music2 } from "lucide-react";
import { currentUser } from "@/lib/session";
import { getLibrary } from "@/lib/library";
import { getMode } from "@/lib/mode";
import { InlineTuneImport } from "@/components/inline-tune-import";
import { TunesTable } from "@/components/tunes-table";
import { SessionTunes } from "@/components/session-book-list";
import { Landing } from "@/components/landing";

export default async function Tunes({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await currentUser();
  if (!user) return <Landing />;
  // In the session the home screen is your tunes, or the same tunes as tunebooks; the listen deck names tunes on top of any screen.
  if ((await getMode()).mode === "session") return <SessionTunes userId={user.id} view={(await searchParams).view === "books" ? "books" : "tunes"} />;
  const { tunes } = await getLibrary(user.id);
  return <div className="page-wrap"><header className="page-head"><h1>Tunes<span className="heading-count">{tunes.length}</span></h1></header>
    {!tunes.length && <div className="empty-state"><div className="empty-icon"><Music2 size={26} /></div><h2>Your library starts with a tune.</h2><p>Paste a tune link or search by title below to save your first setting.</p></div>}
    {tunes.length > 0 && <TunesTable tunes={tunes} />}<InlineTuneImport />
  </div>;
}
