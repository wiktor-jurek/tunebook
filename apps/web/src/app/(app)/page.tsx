import { currentUser } from "@/lib/session";
import { getCatalogIndex, getLibrary, getTuneBooks } from "@/lib/library";
import { getMode } from "@/lib/mode";
import { TunesTable } from "@/components/tunes-table";
import { SessionTunes } from "@/components/session-book-list";
import { Landing } from "@/components/landing";

export default async function Tunes() {
  const user = await currentUser();
  if (!user) return <Landing />;
  // In the session the home screen is your tunes, grouped as you choose (tunebooks among the ways); the listen deck names
  // tunes on top of any screen.
  if ((await getMode()).mode === "session") return <SessionTunes userId={user.id} />;
  void getCatalogIndex().catch(() => undefined);
  const [{ tunes }, books] = await Promise.all([getLibrary(user.id), getTuneBooks(user.id)]);
  return <div className="page-wrap"><header className="page-head"><h1>Tunes<span className="heading-count">{tunes.length}</span></h1></header>
    <TunesTable tunes={tunes} books={books} />
  </div>;
}
