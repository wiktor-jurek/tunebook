import { Music2 } from "lucide-react";
import { currentUser } from "@/lib/session";
import { getLibrary } from "@/lib/library";
import { getMode } from "@/lib/mode";
import { InlineTuneImport } from "@/components/inline-tune-import";
import { TunesTable } from "@/components/tunes-table";
import { SessionBookList } from "@/components/session-book-list";
import { Landing } from "@/components/landing";

export default async function Tunes() {
  const user = await currentUser();
  if (!user) return <Landing />;
  // In the session the home screen is tonight's tunebooks; the listen tray names tunes on top of any screen.
  if ((await getMode()).mode === "session") return <SessionBookList userId={user.id} />;
  const { tunes } = await getLibrary(user.id);
  return <div className="page-wrap"><header className="page-head"><h1>Tunes<span className="heading-count">{tunes.length}</span></h1></header>
    {!tunes.length && <div className="empty-state"><div className="empty-icon"><Music2 size={26} /></div><h2>Your library starts with a tune.</h2><p>Paste a tune link or search by title below to save your first setting.</p></div>}
    {tunes.length > 0 && <TunesTable tunes={tunes} />}<InlineTuneImport />
  </div>;
}
