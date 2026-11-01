import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GuideScore } from "@/components/guide-score";
import { GUIDES, GUIDE_BOOKS, count, guide, jsonLd, theSessionUrl, tune, tuneMeta, tuneName, type Guide } from "@/lib/guides";

const SITE = "https://tunecompanion.com";

/** A guide's title, standfirst and structured data. */
export function GuideHead({ slug, children, list }: { slug: string; children: React.ReactNode; list?: { name: string; url?: string }[] }) {
  const g = guide(slug);
  const url = `${SITE}/guides/${slug}`;
  const article = { "@context": "https://schema.org", "@type": "Article", headline: g.title, description: g.description, dateModified: g.updated, datePublished: g.updated, mainEntityOfPage: url,
    author: { "@type": "Organization", name: "Tune Companion", url: SITE }, publisher: { "@type": "Organization", name: "Tune Companion", url: SITE } };
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Guides", item: `${SITE}/guides` }, { "@type": "ListItem", position: 2, name: g.title, item: url }] };
  const items = list && { "@context": "https://schema.org", "@type": "ItemList", name: g.title, numberOfItems: list.length,
    itemListElement: list.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, ...(item.url ? { url: item.url } : {}) })) };
  return <header className="guide-head">
    {[article, crumbs, items].filter(Boolean).map((value, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={jsonLd(value!)} />)}
    <Link className="back-link" href="/guides"><ArrowLeft size={15} /> Guides</Link>
    <h1>{g.title}</h1>
    <div className="guide-standfirst">{children}</div>
    <p className="guide-updated">Updated <time dateTime={g.updated}>{new Date(g.updated).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</time></p>
  </header>;
}

/** The official tunebook behind a guide, once it exists. */
export function OpenAsTunebook({ slug, label = "Open as a tunebook" }: { slug: string; label?: string }) {
  const id = GUIDE_BOOKS[slug];
  if (!id) return null;
  return <Button asChild><Link href={`/books/${id}`}><BookOpen size={15} /> {label}</Link></Button>;
}

/** One tune: name, kind and key, its opening bars, and its whole score to read and play on request. */
export function GuideTuneCard({ id, rank, children }: { id: number; rank?: number; children?: React.ReactNode }) {
  const t = tune(id);
  return <article className="guide-tune" id={`tune-${id}`}>
    <div className="guide-tune-head">
      {rank != null && <span className="guide-rank">{rank}</span>}
      <div><h3>{tuneName(id)}</h3><p className="guide-tune-meta">{tuneMeta(id)} · in {count(t.tunebooks)} tunebooks on <a href={theSessionUrl(id)} target="_blank" rel="noreferrer">The Session</a></p></div>
    </div>
    {children}
    <GuideScore tune={{ tuneId: id, settingId: t.settingId, title: t.title, kind: t.kind, meter: t.meter, mode: t.mode, abc: t.abc, sourceUrl: theSessionUrl(id) }} />
  </article>;
}

/** The other guides, at the foot of each. */
export function MoreGuides({ current }: { current: string }) {
  return <nav className="guide-more" aria-label="More guides"><h2>More guides</h2>
    <ul>{GUIDES.filter((g) => g.slug !== current).map((g) => <li key={g.slug}><GuideLink g={g} /></li>)}</ul>
  </nav>;
}

export function GuideLink({ g }: { g: Guide }) {
  return <Link href={`/guides/${g.slug}`} className="guide-link"><strong>{g.title}</strong><span>{g.summary}</span></Link>;
}

/** The finder pitch, where a guide hands over to the app. */
export function FinderCallout() {
  return <aside className="guide-callout">
    <h2>Heard a tune you can&rsquo;t name?</h2>
    <p>Hold up your phone and Tune Companion names it in a few seconds, from 23,000 tunes. Then save it to your tunebook and learn it.</p>
    <div className="guide-callout-actions"><Button asChild><Link href="/">Try the tune finder</Link></Button><Button asChild variant="outline"><Link href="/sign-up">Sign up free</Link></Button></div>
  </aside>;
}
