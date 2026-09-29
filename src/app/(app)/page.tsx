import Link from "next/link";
import { Music2 } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getLibrary } from "@/lib/library";
import { TuneActions } from "@/components/tune-actions";
import { InlineTuneImport } from "@/components/inline-tune-import";
import { TuneAbility } from "@/components/tune-ability";
import { TuneIcon } from "@/components/tune-icon";

export default async function Tunes() {
  const user = await requireUser();
  const { tunes } = await getLibrary(user.id);
  return <div className="page-wrap"><header className="page-head"><div><p className="eyebrow">YOUR LIBRARY</p><h1>Tunes<span className="heading-count">{tunes.length}</span></h1><p className="page-subtitle">Every setting you have saved, in one place.</p></div></header>
    {!tunes.length && <div className="empty-state"><div className="empty-icon"><Music2 size={26} /></div><h2>Your library starts with a tune.</h2><p>Paste a tune link or search by title below to save your first setting.</p></div>}
    <div className="tune-list">{tunes.map((tune) => <article className="tune-list-row" key={tune.id}><TuneIcon tune={tune} /><div className="tune-list-main"><Link href={`/tunes/${tune.id}`} className="tune-list-title">{tune.title}</Link><span className="tune-list-meta">{[tune.kind, tune.mode, tune.meter].filter(Boolean).join(" · ")}</span></div><TuneAbility tune={tune} /><TuneActions tuneId={tune.id} /></article>)}<InlineTuneImport /></div>
  </div>;
}
