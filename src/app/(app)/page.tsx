import { Music2 } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getLibrary } from "@/lib/library";
import { InlineTuneImport } from "@/components/inline-tune-import";
import { TunesTable } from "@/components/tunes-table";

export default async function Tunes() {
  const user = await requireUser();
  const { tunes } = await getLibrary(user.id);
  return <div className="page-wrap"><header className="page-head"><div><p className="eyebrow">YOUR LIBRARY</p><h1>Tunes<span className="heading-count">{tunes.length}</span></h1><p className="page-subtitle">Every setting you have saved, in one place.</p></div></header>
    {!tunes.length && <div className="empty-state"><div className="empty-icon"><Music2 size={26} /></div><h2>Your library starts with a tune.</h2><p>Paste a tune link or search by title below to save your first setting.</p></div>}
    {tunes.length > 0 && <TunesTable tunes={tunes} />}<InlineTuneImport />
  </div>;
}
