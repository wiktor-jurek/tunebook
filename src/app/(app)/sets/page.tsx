import Link from "next/link";
import { ListMusic } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getLibrary } from "@/lib/library";
import { keyName } from "@/lib/notation";
import { AbilityMark, AbilitySummary } from "@/components/ability-mark";
import { SetMenu } from "@/components/set-menu";
import { RepeatMark } from "@/components/repeat-mark";
import { displayTitle, displaySetTitle } from "@/lib/titles";

export default async function MySets() {
  const user = await requireUser();
  const { sets, tunes } = await getLibrary(user.id);
  const choices = tunes.map((tune) => ({ id: tune.id, title: tune.title }));
  return <div className="page-wrap"><header className="page-head"><h1>Sets<span className="heading-count">{sets.length}</span></h1></header>
    {!sets.length ? <div className="empty-state"><div className="empty-icon"><ListMusic size={26} /></div><h2>A set starts in a tunebook.</h2><p>Add at least two tunes to a tunebook, then choose Group tunes into a set. Your ordered sets will appear here.</p><Link className="button button-outline button-default" href="/">Go to your tunes</Link></div> : <div className="my-sets-list">{sets.map((set) => <article className="my-set-card" key={set.id}><header><div><p className="my-set-count"><RepeatMark />{set.tunes.length} tunes</p><h2>{displaySetTitle(set.name)}</h2><AbilitySummary tunes={set.tunes} /></div><div className="my-set-actions">{set.books[0] && <Link className="button button-outline button-sm" href={`/books/${set.books[0].id}`}>Open in {set.books[0].name}</Link>}<SetMenu set={{ setId: set.id, name: set.name, autoName: set.autoName, tuneIds: set.tunes.map((tune) => tune.id), bookCount: set.books.length }} choices={choices} /></div></header><ol>{set.tunes.map((tune) => <li key={tune.id}><Link href={`/tunes/${tune.id}`}><span className="contents-emoji" aria-hidden="true">{tune.emoji}</span> {displayTitle(tune.title)}</Link><AbilityMark practice={tune.practice} /><span>{[tune.kind, keyName(tune.mode)].filter(Boolean).join(", ")}</span></li>)}</ol><footer>{set.books.length ? <><span>In </span>{set.books.map((book, index) => <span key={book.id}>{index > 0 && ", "}<Link href={`/books/${book.id}`}>{book.name}</Link></span>)}</> : "Not currently in a tunebook. Use Add set to reuse it."}</footer></article>)}</div>}
  </div>;
}
