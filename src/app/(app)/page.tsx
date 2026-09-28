import Link from "next/link";
import { Music2, Plus } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getLibrary } from "@/lib/library";
import { TuneActions } from "@/components/tune-actions";
import { InlineTuneImport } from "@/components/inline-tune-import";

export default async function Home() {
  const user = await requireUser();
  const { tunes, books } = await getLibrary(user.id);
  return <div className="page-wrap"><header className="page-head"><div><p className="eyebrow">YOUR LIBRARY</p><h1>All tunes<span className="heading-count">{tunes.length}</span></h1><p className="page-subtitle">Every setting you have saved, in one place.</p></div><Link href="/import" className="button button-primary button-default"><Plus size={16} /> Import tune</Link></header>
    {!tunes.length && <div className="empty-state"><div className="empty-icon"><Music2 size={26} /></div><h2>Your library starts with a tune.</h2><p>Paste a tune link or search by title below to save your first setting.</p></div>}
    <div className="tune-list">{tunes.map((tune) => <article className="tune-list-row" key={tune.id}><div className="tune-list-icon"><Music2 size={18} /></div><div className="tune-list-main"><Link href={`/tunes/${tune.id}`} className="tune-list-title">{tune.title}</Link><span className="tune-list-meta">{[tune.kind, tune.mode, tune.meter].filter(Boolean).join(" · ")}</span></div><TuneActions tuneId={tune.id} books={books} /></article>)}<InlineTuneImport /></div>
  </div>;
}
