import type { Metadata } from "next";
import Link from "next/link";
import { FinderCallout, GuideHead, GuideTuneCard, MoreGuides, OpenAsTunebook } from "@/components/guide-parts";
import { FIRST_SESSION, FIRST_SESSION_IDS, FIRST_SESSION_SOURCES } from "@/lib/guides/first-session";
import { count, guide, guideData, theSessionUrl, tuneName } from "@/lib/guides";

const SLUG = "first-session-tunes";
const g = guide(SLUG);

export const metadata: Metadata = {
  title: { absolute: g.title },
  description: g.description,
  alternates: { canonical: `/guides/${SLUG}` },
  openGraph: { title: g.title, description: g.description, type: "article", siteName: "Tune Companion", modifiedTime: g.updated },
  twitter: { card: "summary_large_image", title: g.title, description: g.description },
};

export default function FirstSessionTunes() {
  let rank = 0;
  return <div className="guide-wrap">
    <GuideHead slug={SLUG} list={FIRST_SESSION_IDS.map((id) => ({ name: tuneName(id), url: theSessionUrl(id) }))}>
      <p>Every session has its own tunes, but some turn up almost everywhere. These {FIRST_SESSION_IDS.length} are the ones players recommend most to someone heading to their first session, grouped in the order most teachers suggest learning them.</p>
      <p>Learn them in the pairs they&rsquo;re played in. When someone starts The Kesh, you&rsquo;ll know Morrison&rsquo;s is probably coming next.</p>
      <OpenAsTunebook slug={SLUG} label="Open all 20 as a tunebook" />
    </GuideHead>

    <nav className="guide-toc" aria-label="Tune types">{FIRST_SESSION.map((group) => <a key={group.kind} href={`#${group.kind.replace(" ", "-")}`}>{group.title}</a>)}</nav>

    {FIRST_SESSION.map((group) => <section key={group.kind} className="guide-section" id={group.kind.replace(" ", "-")}>
      <h2>{group.title}</h2>
      <p className="guide-section-intro">{group.intro}</p>
      {group.tunes.map((t) => {
        const next = guideData.followers[t.tuneId];
        return <GuideTuneCard key={t.tuneId} id={t.tuneId} rank={++rank}>
          <p className="guide-note">{t.note}</p>
          {next && <p className="guide-follow">Most often followed by <strong>{tuneName(next.tuneId)}</strong> ({count(next.members)} members play them as a set)</p>}
        </GuideTuneCard>;
      })}
    </section>)}

    <FinderCallout />

    <section className="guide-section guide-method">
      <h2>How this list was made</h2>
      <p>Three signals, then judgement. We read {FIRST_SESSION_SOURCES.threads} beginner and first-session threads on <a href="https://thesession.org/discussions" target="_blank" rel="noreferrer">The Session&rsquo;s forum</a> ({count(FIRST_SESSION_SOURCES.posts)} posts) and counted how many different people named each tune. We checked those against published beginner lists, and against how many of The Session&rsquo;s members keep each tune in their tunebook. The Kesh came top of the forum count, named by 30 different people.</p>
      <p>From the tunes that scored well, we kept the ones that are easy to get under the fingers and that turn up in common sets, with a few of each type, so you can join in whatever comes next. The &ldquo;followed by&rdquo; counts come from the {count(guideData.sets)} sets saved by {count(guideData.members)} members of The Session.</p>
      <ul>{FIRST_SESSION_SOURCES.lists.map((list) => <li key={list.url}><a href={list.url} target="_blank" rel="noreferrer">{list.name}</a></li>)}</ul>
      <p>Know which tunes go together next: <Link href="/guides/popular-session-sets">the most popular session sets</Link>.</p>
    </section>

    <MoreGuides current={SLUG} />
  </div>;
}
