import type { Metadata } from "next";
import Link from "next/link";
import { FinderCallout, GuideHead, MoreGuides, OpenAsTunebook } from "@/components/guide-parts";
import { GuideScore } from "@/components/guide-score";
import { count, guide, guideData, theSessionUrl, tune, tuneMeta, tuneName } from "@/lib/guides";

const SLUG = "popular-session-sets";
const g = guide(SLUG);
const TITLES: Record<string, string> = { reel: "Reels", jig: "Jigs", polka: "Polkas", "slip jig": "Slip jigs", hornpipe: "Hornpipes", slide: "Slides" };
const anchor = (kind: string) => kind.replace(" ", "-");
const setName = (tunes: number[]) => tunes.map(tuneName).join(" / ");

export const metadata: Metadata = {
  title: { absolute: g.title },
  description: g.description,
  alternates: { canonical: `/guides/${SLUG}` },
  openGraph: { title: g.title, description: g.description, type: "article", siteName: "Tune Companion", modifiedTime: g.updated },
  twitter: { card: "summary_large_image", title: g.title, description: g.description },
};

export default function PopularSessionSets() {
  const top = guideData.popularSets.flatMap((group) => group.sets.slice(0, 3));
  return <div className="guide-wrap">
    <GuideHead slug={SLUG} list={guideData.popularSets.flatMap((group) => group.sets).map((set) => ({ name: setName(set.tunes) }))}>
      <p>At a session, tunes come in sets: two or three of the same kind, played one into the next. Which tunes go together is mostly habit, and habits can be counted. The {count(guideData.members)} members of <a href="https://thesession.org" target="_blank" rel="noreferrer">The Session</a> have saved {count(guideData.sets)} sets between them. These are the ones they save most.</p>
      <p>Each count is the number of different members who saved those tunes together, in any order. A set is shown in the order most of them play it.</p>
      <OpenAsTunebook slug={SLUG} label="Open the top sets as a tunebook" />
    </GuideHead>

    <section className="guide-section">
      <h2>The top set of each kind</h2>
      <ol className="guide-podium">{guideData.popularSets.map((group) => <li key={group.kind}><span className="guide-podium-kind">{TITLES[group.kind]}</span><a href={`#${anchor(group.kind)}`}>{setName(group.sets[0].tunes)}</a><span className="guide-podium-count">{count(group.sets[0].members)} members</span></li>)}</ol>
    </section>

    {guideData.popularSets.map((group) => <section key={group.kind} className="guide-section" id={anchor(group.kind)}>
      <h2>{TITLES[group.kind]}</h2>
      <ol className="guide-sets">{group.sets.map((set, i) => <li key={set.tunes.join()} className="guide-set">
        <div className="guide-set-head"><span className="guide-rank">{i + 1}</span><div><h3>{setName(set.tunes)}</h3><p className="guide-tune-meta">Saved together by {count(set.members)} members</p></div></div>
        {/* The top three of each kind show their tunes' opening bars; the rest link through to The Session. */}
        {top.includes(set) ? <div className="guide-set-tunes">{set.tunes.map((id) => {
          const t = tune(id);
          return <div key={id} className="guide-set-tune"><p className="guide-set-tune-name"><a href={theSessionUrl(id)} target="_blank" rel="noreferrer">{tuneName(id)}</a> <span>{tuneMeta(id)}</span></p>
            <GuideScore tune={{ tuneId: id, settingId: t.settingId, title: t.title, kind: t.kind, meter: t.meter, mode: t.mode, abc: t.abc, sourceUrl: theSessionUrl(id) }} /></div>;
        })}</div> : <p className="guide-set-links">{set.tunes.map((id, j) => <span key={id}>{j > 0 && " / "}<a href={theSessionUrl(id)} target="_blank" rel="noreferrer">{tuneName(id)}</a> <span className="guide-tune-meta">{tuneMeta(id)}</span></span>)}</p>}
      </li>)}</ol>
    </section>)}

    <FinderCallout />

    <section className="guide-section guide-method">
      <h2>How the sets were counted</h2>
      <p>The Session publishes every member&rsquo;s saved sets as <a href="https://github.com/adactio/TheSession-data" target="_blank" rel="noreferrer">open data</a>. We took the sets of two to four tunes, treated the same tunes in a different order as the same set, and counted each member once, so one keen member saving a set ten times counts as one. A set counts towards a kind when all its tunes are that kind. The data was last read on {new Date(guideData.generated).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.</p>
      <p>Some sets that do well here come from Scottish and Shetland music, or from classes whose students all saved the same sets. They&rsquo;re left in: the count is what members save, not what any one session plays. Where a name repeats, as with the three Ballydesmond polkas, the tunes are different tunes that share a name; the key tells them apart.</p>
      <p>New to sessions? Start with <Link href="/guides/first-session-tunes">the 20 tunes to learn for your first session</Link>.</p>
    </section>

    <MoreGuides current={SLUG} />
  </div>;
}
