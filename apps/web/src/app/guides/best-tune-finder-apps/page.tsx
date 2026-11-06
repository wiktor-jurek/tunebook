import type { Metadata } from "next";
import Link from "next/link";
import { FinderCallout, GuideHead, MoreGuides } from "@/components/guide-parts";
import { ENGINES, SETS, scoreboard, type Benchmark, type EngineKey } from "@/lib/finder/benchmark";
import data from "@/lib/finder/benchmark.json";
import { count, guide, jsonLd } from "@/lib/guides";

const SLUG = "best-tune-finder-apps";
const g = guide(SLUG);
const benchmark = data as Benchmark;
const engines = ENGINES.filter((engine) => benchmark.engines[engine.key]);
const keys = engines.map((engine) => engine.key);
const pct = (x: number) => `${Math.round(100 * x)}%`;
// The share named correctly after this many seconds of listening, from each clip's timing curve.
const HEARD = 10;

export const metadata: Metadata = {
  title: { absolute: "Tune finder apps compared: JigRipper vs Tunepal vs FolkFriend vs Little Session" },
  description: g.description,
  alternates: { canonical: `/guides/${SLUG}` },
  openGraph: { title: g.title, description: g.description, type: "article", siteName: "Tune Companion", modifiedTime: g.updated },
  twitter: { card: "summary_large_image", title: g.title, description: g.description },
};

type App = { name: string; key?: EngineKey; url: string; price: string; platforms: string; how: string; verdict: string };

// Prices and platforms as each app's own store page or site gave them on the guide's update date.
const APPS: App[] = [
  { name: "Tune Companion", key: "tunebook", url: "/", price: "Free", platforms: "Web, on any phone, tablet or computer",
    how: "A transformer model trained on 23,000 tunes listens in the browser, on your device; nothing you play is uploaded.",
    verdict: "Ours. The most accurate once it has heard a whole clip, though FolkFriend names a few more in the first ten seconds. Then it helps you learn the tune: score, play-along and a tunebook." },
  { name: "JigRipper", key: "jigripper", url: "https://www.jigripper.com", price: "€7.99 on iPhone; free on the web", platforms: "iPhone, web",
    how: "A neural network on the device listens to 8-second windows.",
    verdict: "Close behind on most recordings and level on full band recordings. A strong, private, well-made app." },
  { name: "FolkFriend", key: "folkfriend", url: "https://folkfriend.app", price: "Free and open source (GPL-3.0)", platforms: "Web",
    how: "Transcribes the melody, then searches The Session's settings for it.",
    verdict: "Free and open, and good on a clear solo instrument. Backing and ensembles trip it up more." },
  { name: "Cadence", key: "cadence", url: "https://batpapa.github.io/Cadence/TuneAnalyser/", price: "Free and open source (AGPL-3.0)", platforms: "Web, Android",
    how: "A modified FolkFriend transcribes 10-second windows, and a Viterbi segmenter follows a whole session tune by tune.",
    verdict: "Close behind on YouTube clips and the best on full band recordings. In whole sessions it names each new tune within about ten seconds, though it shows a few wrong names along the way." },
  { name: "Tunepal", key: "tunepal", url: "https://tunepal.org", price: "Free", platforms: "iPhone, Android",
    how: "Turns about 10 seconds of playing into note letters and finds the closest tune by edit distance.",
    verdict: "The original trad tune finder, from Bryan Duggan's research at DIT (now TU Dublin). Its note-matching method struggles with anything but one clean instrument." },
  { name: "Little Session", url: "https://littlesession.triangulate.fr", price: "Free app; recognition needs Premium (€19.99, one-off)", platforms: "iPhone, iPad, Mac, Android, Windows",
    how: "Matches a few seconds of playing against its catalogue; the method is not published.",
    verdict: "Not benchmarked yet: recognition is a paid feature with no web version, so it needs playing through the real app. Its makers report 64% top-1 on their own clips." },
];

/** `rates`: each engine's top-1 on every clip, best first, as "Tune Companion on 76%, JigRipper on 72%, …". */
const faqs = (clips: number, rates: string) => [
  { q: "What is the best app to identify an Irish tune?", a: `On our benchmark of ${clips} real recordings, the right tune came first for ${rates}. On full band recordings, JigRipper is level with Tune Companion.` },
  { q: "Is there a Shazam for Irish traditional music?", a: "Yes. Tune Companion, JigRipper, FolkFriend, Tunepal and Little Session all name trad tunes by ear. Shazam itself only knows commercial recordings, so it can't name a tune played live at a session." },
  { q: "Which tune finder apps are free?", a: "Tune Companion, FolkFriend and Tunepal are free, and JigRipper has a free web version. Little Session's recognition is part of its paid Premium upgrade." },
  { q: "Does Tunepal still work?", a: "Yes, Tunepal is still on the App Store. Its method of matching note letters works best on one clean instrument; with backing or several players it often misses." },
];

export default function BestTuneFinderApps() {
  const { clips } = benchmark;
  const all = scoreboard(clips, keys);
  const holdout = scoreboard(clips.filter((clip) => clip.set === "holdout"), keys);
  const heardIndex = benchmark.prefixes.indexOf(HEARD);
  const early = Object.fromEntries(keys.map((key) => {
    const timed = clips.filter((clip) => clip.results[key]?.curve);
    return [key, timed.length ? timed.filter((clip) => clip.results[key]!.curve![heardIndex] === "1").length / timed.length : null];
  }));
  const score = (key?: EngineKey) => all.scores.find((s) => s.key === key);
  const rates = [...all.scores].sort((a, b) => b.right - a.right).map((s) => `${engines.find((e) => e.key === s.key)!.name} on ${pct(s.right / s.clips)}`);
  const FAQ = faqs(clips.length, `${rates.slice(0, -1).join(", ")} and ${rates.at(-1)}`);
  const faq = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  return <div className="guide-wrap">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(faq)} />
    <GuideHead slug={SLUG} list={APPS.map((app) => ({ name: app.name, url: app.url.startsWith("http") ? app.url : undefined }))}>
      <p>Five apps promise to name an Irish tune by ear. We played the same {count(clips.length)} real recordings to each one we could test: YouTube performances, album tracks and full bands, with fiddle, flute, whistle, pipes, concertina, accordion and banjo. Then we counted how often each named the right tune.</p>
      <p>We make one of the apps, Tune Companion, so we&rsquo;ve published every clip and every answer on the <Link href="/tunes/finder/benchmark">full benchmark page</Link>. Check any of them.</p>
    </GuideHead>

    <section className="guide-section">
      <h2>The short answer</h2>
      <div className="table-container">
        <table className="table guide-compare">
          <thead><tr><th className="table-head">App</th><th className="table-head">Right first time</th><th className="table-head">Right after {HEARD} s</th><th className="table-head">Tunes it knows</th><th className="table-head">Price</th><th className="table-head">Runs on</th></tr></thead>
          <tbody>{APPS.map((app) => {
            const s = score(app.key), e = app.key && benchmark.engines[app.key];
            const colour = engines.find((engine) => engine.key === app.key)?.colour;
            return <tr key={app.name}>
              <td className="table-cell"><span className="guide-app">{colour && <span className="bench-dot" style={{ background: colour }} />}{app.url.startsWith("http") ? <a href={app.url} target="_blank" rel="noreferrer">{app.name}</a> : <Link href={app.url}>{app.name}</Link>}</span></td>
              <td className="table-cell">{s ? <><strong>{pct(s.right / s.clips)}</strong> <span className="table-meta">{pct(s.interval[0])}–{pct(s.interval[1])}</span></> : <span className="table-meta">Not tested yet</span>}</td>
              <td className="table-cell">{app.key && early[app.key] != null ? pct(early[app.key]!) : "–"}</td>
              <td className="table-cell">{e ? count(e.tunes) : "23,000+"}</td>
              <td className="table-cell">{app.price}</td>
              <td className="table-cell">{app.platforms}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="benchmark-note">&ldquo;Right first time&rdquo; is the share of all {count(clips.length)} recordings where the app&rsquo;s top answer was the right tune, with its 95% interval. &ldquo;Right after {HEARD} s&rdquo; is the share named correctly after hearing only the first {HEARD} seconds. Tunes it knows is the size of each app&rsquo;s tune index; Little Session&rsquo;s is as its makers state it.</p>
    </section>

    <section className="guide-section">
      <h2>On recordings no app had heard before</h2>
      <p>The fairest test is the {holdout.clips} YouTube performances we added after Tune Companion&rsquo;s settings were fixed, so it couldn&rsquo;t have been tuned to them.</p>
      <ol className="guide-bars">{[...holdout.scores].sort((a, b) => b.right - a.right).map((s) => {
        const engine = engines.find((e) => e.key === s.key)!;
        return <li key={s.key}><span className="guide-bar-name">{engine.name}</span><span className="guide-bar-track"><span style={{ width: `${(100 * s.right) / s.clips}%`, background: engine.colour }} /></span><span className="guide-bar-value">{pct(s.right / s.clips)}</span></li>;
      })}</ol>
      <p className="benchmark-note">{SETS.find((set) => set.key === "holdout")?.about} {engines.find((e) => e.key === holdout.leader)?.name}&rsquo;s lead over {engines.find((e) => e.key === holdout.runnerUp)?.name} here is {holdout.best ? "statistically clear" : "too small to call with this many clips"} (exact McNemar test, p = {holdout.p.toFixed(2)}).</p>
    </section>

    <section className="guide-section">
      <h2>App by app</h2>
      {APPS.map((app) => <article key={app.name} className="guide-app-card">
        <h3>{app.name}</h3>
        <dl><dt>Price</dt><dd>{app.price}</dd><dt>Runs on</dt><dd>{app.platforms}</dd><dt>How it listens</dt><dd>{app.how}</dd>{score(app.key) && <><dt>Our benchmark</dt><dd>{pct(score(app.key)!.right / score(app.key)!.clips)} right first time on {count(clips.length)} recordings</dd></>}</dl>
        <p>{app.verdict}</p>
      </article>)}
    </section>

    <FinderCallout />

    <section className="guide-section guide-method">
      <h2>How we tested</h2>
      <p>Every app heard exactly the same audio. JigRipper ran its own published web model and front end offline; FolkFriend ran its open-source command-line build; Cadence ran its own FolkFriend build and session segmenter from its open-source code; Tunepal ran its published search over its own tune index from its author&rsquo;s open-source rebuild. Tunepal&rsquo;s own pitch tracker isn&rsquo;t public, so a standard one stands in for it, which may make it look slightly better or worse than the app. Little Session will be added once we&rsquo;ve played the clips through the app itself.</p>
      <p>The YouTube clips&rsquo; tunes were checked by ear. A tune an app doesn&rsquo;t know counts against it, as it would at a session. Numbers are rounded; the <Link href="/tunes/finder/benchmark">benchmark page</Link> has every clip, the answers, and splits by instrument and by how popular the tune is.</p>
    </section>

    <section className="guide-section">
      <h2>Questions</h2>
      {FAQ.map(({ q, a }) => <div key={q} className="guide-faq"><h3>{q}</h3><p>{a}</p></div>)}
    </section>

    <MoreGuides current={SLUG} />
  </div>;
}
