"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MicOff, X } from "lucide-react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useMotionValue, useSpring, type MotionStyle } from "motion/react";
import { Button } from "@/components/ui/button";
import { BookDemo, ProgressDemo, RecordDemo, type DemoTrack } from "@/components/landing-sections";
import { MicShape } from "@/components/listen-tray";
import { FinderAnswer, FinderScore, finderPrompt, type FinderContext } from "@/components/finder-parts";
import { useTuneListener } from "@/lib/finder/use-listener";
import type { FinderTune } from "@/lib/library";

const rise = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.35 },
  transition: { type: "spring", stiffness: 120, damping: 22 },
} as const;
type Spot = "hero" | "end" | "dock";

/**
 * The one microphone on the page. It sits in the hero; once the hero scrolls away it flies down into a small dock at the
 * bottom of the screen and rides along, and it lands again beside the closing call to action. Tapping it anywhere
 * really listens. Where it sits is decided by two IntersectionObservers, never by measuring on scroll.
 */
export function LandingInteractive({ tracks }: { tracks: Record<number, DemoTrack[]> }) {
  const listener = useTuneListener();
  const { phase, status, leader, certainty, progress, stop } = listener;
  const heroSlot = useRef<HTMLDivElement>(null);
  const endSlot = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState({ hero: true, end: false });
  const [sheet, setSheet] = useState<FinderTune | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);

  useEffect(() => {
    const watch = (el: HTMLElement | null, key: "hero" | "end") => {
      if (!el) return null;
      const observer = new IntersectionObserver(([entry]) => setInView((prev) => (prev[key] === entry.isIntersecting ? prev : { ...prev, [key]: entry.isIntersecting })), { rootMargin: "-64px 0px -96px 0px" });
      observer.observe(el);
      return observer;
    };
    const observers = [watch(heroSlot.current, "hero"), watch(endSlot.current, "end")];
    return () => observers.forEach((o) => o?.disconnect());
  }, []);

  // Like the app's finder on the landing page, a confident answer ends the listening.
  useEffect(() => {
    if (phase === "listening" && status === "match" && leader) stop();
  }, [phase, status, leader, stop]);

  const spot: Spot = inView.hero ? "hero" : inView.end ? "end" : "dock";
  const listening = phase === "listening";
  const busy = phase === "starting" || phase === "loading";
  const answer = leader && (status === "match" || status === "unsure") ? leader : null;
  const sure = status === "match";
  const context: FinderContext = { listener, signedIn: false, next: "/", onScore: setSheet };

  function press() {
    setDismissed(null);
    setSlowStart(false);
    if (listening) stop();
    else void listener.start();
  }

  const square = useSpring(useMotionValue(0), { stiffness: 280, damping: 26 });
  useEffect(() => square.set(listening ? 1 : 0), [listening, square]);
  const dot = useMotionValue(0);
  const arc = answer ? (sure ? 1 : certainty) : listening ? certainty : 0;
  const loaded = progress?.total ? progress.loaded / progress.total : 0;

  // The microphone and a cached model usually answer at once; only say we're asking for the microphone or loading the
  // model if it takes longer than half a second.
  const [slowStart, setSlowStart] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const id = window.setTimeout(() => setSlowStart(true), 500);
    return () => window.clearTimeout(id);
  }, [busy]);
  const idleText = "Try it now: tap and play a tune.";
  const prompt = busy && !slowStart ? idleText : finderPrompt(listener, idleText);
  const dial = (size: "hero" | "dock") => (
    <motion.div
      layoutId="landing-mic"
      layout
      layoutCrossfade={false}
      transition={{ type: "spring", stiffness: 210, damping: 26 }}
      className={`finder-dial lp-dial is-${size}`}
      data-phase={phase}
      data-matched={sure && answer ? "" : undefined}
      style={{ "--level": listener.level, "--loaded": loaded } as unknown as MotionStyle}
    >
      {listening && <><span className="finder-ripple" aria-hidden="true" /><span className="finder-ripple" aria-hidden="true" /></>}
      <svg className="finder-arc" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="finder-arc-track" cx="50" cy="50" r="48" />
        <circle className="finder-arc-fill" data-empty={arc <= 0 ? "" : undefined} cx="50" cy="50" r="48" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - 100 * arc} />
      </svg>
      <button type="button" className="finder-button" data-phase={phase} disabled={busy} onClick={press} aria-label={listening ? "Stop listening" : "Name the tune that's playing"}>
        <span className="finder-icon">{phase === "denied" ? <MicOff size={size === "hero" ? 34 : 18} /> : <MicShape dot={dot} square={square} size={size === "hero" ? 34 : 18} />}</span>
      </button>
    </motion.div>
  );
  const dots = listening && status !== "quiet" && <span className="finder-dots" aria-hidden="true"><i /><i /></span>;

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <section className="lp-hero" aria-labelledby="lp-title">
          <motion.h1 id="lp-title" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}>
            <span>Learn it at home.</span> <span>Play it at the session.</span>
          </motion.h1>
          <motion.p className="lp-lede" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.08, ease: [0.2, 0.8, 0.2, 1] }}>
            Name tunes by ear, practise with play-alongs at your own speed, and carry every tunebook in your pocket.
          </motion.p>
          <div ref={heroSlot} className="lp-slot is-hero">{spot === "hero" && dial("hero")}</div>
          <div className="lp-hero-stage" aria-live="polite">
            {answer && spot === "hero" ? (
              <FinderAnswer tune={answer} sure={sure} context={context} />
            ) : (
              <p className="lp-prompt" role={phase === "error" ? "alert" : undefined}>{prompt}{dots}</p>
            )}
          </div>
        </section>

        {/* The loop, in order: practise at home, play out at the session, then see what you can play. */}
        <Feature title="Practise at your own pace." body="Every tune has its score and play-along recordings. Slow them down until your fingers catch up, then share the tunebook with your session.">
          <BookDemo tracks={tracks} />
        </Feature>

        <Feature title="Record the whole night." body="Leave your phone on the table. Every tune is named as it's played, set by set.">
          <RecordDemo />
        </Feature>

        <Feature title="See what you can play." body="Find out how much of the night you could join in on. Tap the rest to start learning.">
          <ProgressDemo />
        </Feature>

        <section className="lp-end" aria-labelledby="lp-end-title">
          <div ref={endSlot} className="lp-slot is-hero">{spot === "end" && dial("hero")}</div>
          <h2 id="lp-end-title">See you at the session.</h2>
          <div className="lp-end-actions">
            <Button asChild size="lg"><Link href="/sign-up">Get started free</Link></Button>
          </div>
        </section>

        {/* The dock: the microphone riding along at the bottom of the screen. The bar has no exit fade, so when the hero
            or the closing section takes the microphone back it flies there at full colour instead of fading out. */}
        <aside className="lp-dock" aria-label="Tune finder">
          <AnimatePresence>
            {spot !== "hero" && answer && dismissed !== answer.tuneId && (
              <motion.div
                key={answer.tuneId}
                className="lp-dock-answer"
                aria-live="polite"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
              >
                <Button variant="ghost" size="icon-sm" className="lp-dock-close" aria-label="Close this tune" onClick={() => setDismissed(answer.tuneId)}><X size={16} /></Button>
                <FinderAnswer tune={answer} sure={sure} context={context} />
              </motion.div>
            )}
          </AnimatePresence>
          {spot === "dock" && (
            <div className="lp-dock-bar">
              {dial("dock")}
              <button type="button" className="lp-dock-label" onClick={press} disabled={busy}>
                {phase === "idle" || (busy && !slowStart) ? "Name a tune" : prompt}{dots}
              </button>
            </div>
          )}
        </aside>
      </LayoutGroup>

      {sheet && <FinderScore tune={listener.tunes[sheet.tuneId] ?? sheet} context={context} onClose={() => setSheet(null)} />}
    </MotionConfig>
  );
}

function Feature({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <section className="lp-feature">
      <motion.div className="lp-copy" {...rise}>
        <h2>{title}</h2>
        <p>{body}</p>
      </motion.div>
      <motion.div className="lp-visual" {...rise} transition={{ ...rise.transition, delay: 0.1 }}>
        {children}
      </motion.div>
    </section>
  );
}
