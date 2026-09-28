import Link from "next/link";
import { ListMusic } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getLibrary } from "@/lib/library";
import { SetControls } from "@/components/set-controls";

export default async function MySets() {
  const user = await requireUser();
  const { sets, tunes } = await getLibrary(user.id);
  const choices = tunes.map((tune) => ({ id: tune.id, title: tune.title }));
  return <div className="page-wrap"><header className="page-head"><div><p className="eyebrow">YOUR LIBRARY</p><h1>My sets<span className="heading-count">{sets.length}</span></h1><p className="page-subtitle">Create sets by grouping tunes in a tunebook. Add them to other tunebooks with Add set.</p></div></header>
    {!sets.length ? <div className="empty-state"><div className="empty-icon"><ListMusic size={26} /></div><h2>A set starts in a tunebook.</h2><p>Add at least two tunes to a tunebook, then choose Group tunes into a set. Your ordered sets will appear here.</p><Link className="button button-outline button-default" href="/">Go to your tunes</Link></div> : <div className="my-sets-list">{sets.map((set) => <article className="my-set-card" key={set.id}><header><div><p className="eyebrow">{set.tunes.length} TUNES</p><h2>{set.name}</h2></div><div className="my-set-actions"><SetControls task={{ mode: "edit", setId: set.id, name: set.name, autoName: set.autoName, tuneIds: set.tunes.map((tune) => tune.id), bookCount: set.books.length }} choices={choices} /><SetControls task={{ mode: "delete", setId: set.id, name: set.name, autoName: set.autoName, tuneIds: set.tunes.map((tune) => tune.id), bookCount: set.books.length }} choices={choices} variant="ghost" /></div></header><ol>{set.tunes.map((tune) => <li key={tune.id}><Link href={`/tunes/${tune.id}`}><span className="contents-emoji" aria-hidden="true">{tune.emoji}</span> {tune.title}</Link><span>{[tune.kind, tune.mode].filter(Boolean).join(" · ")}</span></li>)}</ol><footer>{set.books.length ? <><span>In </span>{set.books.map((book, index) => <span key={book.id}>{index > 0 && ", "}<Link href={`/books/${book.id}`}>{book.name}</Link></span>)}</> : "Not currently in a tunebook. Use Add set to reuse it."}</footer></article>)}</div>}
  </div>;
}
