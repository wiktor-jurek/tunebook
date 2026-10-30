import Link from "next/link";
import { BookOpen, Mic, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicHeader } from "@/components/public-header";
import { TuneFinder } from "@/components/tune-finder";
import type { Benchmark } from "@/lib/finder/benchmark";
import benchmarkData from "@/lib/finder/benchmark.json";

const points = [
  { icon: Music2, title: "Your repertoire, counted.", body: "Mark what you can play, and watch every tunebook's count go up." },
  { icon: BookOpen, title: "One link for the session.", body: "Sets in playing order, scores and play-alongs for everyone." },
  { icon: Mic, title: "Name that tune.", body: "Hold up your phone. It hears the tune out of 23,000." },
];

// The finder's share of right answers on recordings it was never tuned on, from the benchmark page's data.
const holdout = (benchmarkData as Benchmark).clips.filter((clip) => clip.set === "holdout");
const named = holdout.filter((clip) => clip.results.tunebook?.top === clip.tuneId).length;

export function Landing() {
  return <div className="landing"><PublicHeader />
    <section className="landing-hero">
      <div className="landing-copy">
        <h1>Learn the tunes. Join the session.</h1>
        <p className="landing-lede">Practise the tunes your session plays, and name the ones you don&apos;t know the moment they start. Free, for every tune on The Session.</p>
        <div className="landing-actions"><Button asChild><Link href="/sign-up">Start practising</Link></Button><Button asChild variant="outline"><Link href="/tunes/finder">Identify a tune</Link></Button></div>
      </div>
      <div className="landing-demo"><TuneFinder signedIn={false} layout="hero" /><p className="landing-demo-note">Named {Math.round((100 * named) / holdout.length)}% of {holdout.length} real recordings it had never heard. <Link href="/tunes/finder/benchmark">See the benchmark</Link></p></div>
    </section>
    <section className="landing-points">{points.map(({ icon: Icon, title, body }) => <article key={title}><Icon size={18} aria-hidden="true" /><h2>{title}</h2><p>{body}</p></article>)}</section>
    <footer className="landing-footer"><p>Tunes come from <a href="https://thesession.org" target="_blank" rel="noreferrer">The Session</a> and its contributors, and every setting links back to its source.</p></footer>
  </div>;
}
