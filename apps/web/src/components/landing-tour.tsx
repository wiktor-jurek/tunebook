"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Disc3, Headphones, MicOff, Music, Sparkles, X } from "lucide-react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useMotionValue, useSpring, type MotionStyle } from "motion/react";
import { AbilityMark } from "@/components/ability-mark";
import { RepeatMark } from "@/components/repeat-mark";
import { Button } from "@/components/ui/button";
import { BookDemo, ProgressDemo, RecordDemo, type DemoTrack } from "@/components/landing-sections";
import { MicShape } from "@/components/listen-tray";
import { FinderAnswer, FinderScore, finderPrompt, type FinderContext } from "@/components/finder-parts";
import { resolvePractice } from "@/lib/ability";
import { useTuneListener } from "@/lib/finder/use-listener";
import type { FinderTune } from "@/lib/library";

const rise = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.35 },
  transition: { type: "spring", stiffness: 120, damping: 22 },
} as const;
type Spot = "hero" | "end" | "dock";
type StepId = "listen" | "learn" | "track";

const STEPS: { id: StepId; label: string; short: string; icon: typeof Disc3 }[] = [
  { id: "listen", label: "1. Listen & record", short: "Listen", icon: Disc3 },
  { id: "learn", label: "2. Learn the tunes", short: "Learn", icon: Headphones },
  { id: "track", label: "3. Play & track", short: "Play", icon: Sparkles },
];

/**
 * The one microphone on the page. It sits inside the phone in the hero; once the hero scrolls away it flies down into a
 * small dock at the bottom of the screen and rides along, and it lands again beside the closing call to action. Tapping it
 * anywhere really listens. Where it sits is decided by two IntersectionObservers, never by measuring on scroll.
 */
export function LandingInteractive({ tracks }: { tracks: Record<number, DemoTrack[]> }) {
  const listener = useTuneListener();
  const { phase, status, leader, certainty, progress, stop } = listener;
  const heroSlot = useRef<HTMLDivElement>(null);
  const endSlot = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState({ hero: true, end: false });
  const [sheet, setSheet] = useState<FinderTune | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [activeStep, setActiveStep] = useState<StepId>("listen");

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
  const idleText = "Try it live: tap and play or hum a tune.";
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
        <span className="finder-icon">{phase === "denied" ? <MicOff size={size === "hero" ? 32 : 18} /> : <MicShape dot={dot} square={square} size={size === "hero" ? 32 : 18} />}</span>
      </button>
    </motion.div>
  );
  const dots = listening && status !== "quiet" && <span className="finder-dots" aria-hidden="true"><i /><i /></span>;

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <section className="lp-hero" aria-labelledby="lp-title">
          <motion.h1 id="lp-title" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}>
            <span>Listen to the session.</span>{" "}
            <span>Learn the tunes.</span>{" "}
            <span>Play them back.</span>
          </motion.h1>
          <motion.p className="lp-lede" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.08, ease: [0.2, 0.8, 0.2, 1] }}>
            Upload or record a session to automatically build its tunebook, practise with real backing tracks, and track every tune in your repertoire.
          </motion.p>

          <motion.div
            className="lp-stage"
            data-active-step={activeStep}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {/* Ambient whisper cards around the pocket companion, highlighting each chapter of the story. */}
            <div className="lp-whispers is-left" aria-hidden="true">
              <div
                className="lp-whisper"
                data-step="listen"
                data-active={activeStep === "listen" ? "" : undefined}
                onMouseEnter={() => setActiveStep("listen")}
              >
                <span className="lp-whisper-badge is-live"><span className="finder-rec-dot" /> Live or uploaded</span>
                <strong>Friday Session · 4 tunes named</strong>
                <span className="lp-whisper-sub"><RepeatMark /> The Kesh · Morrison&apos;s · Out on the Ocean</span>
              </div>

              <div
                className="lp-whisper"
                data-step="listen"
                data-active={activeStep === "listen" ? "" : undefined}
                onMouseEnter={() => setActiveStep("listen")}
              >
                <span className="lp-whisper-icon">🎻</span>
                <div>
                  <strong>Session tunebook ready</strong>
                  <span className="lp-whisper-sub">Grouped into sets automatically</span>
                </div>
              </div>
            </div>

            {/* The pocket session companion: a phone frame holding the live working tune finder. */}
            <div className="lp-phone">
              <div className="lp-phone-bezel">
                <div className="lp-phone-statusbar" aria-hidden="true">
                  <span>21:42</span>
                  <span className="lp-phone-island" />
                  <span className="lp-phone-pill">In the pub</span>
                </div>

                <div className="lp-phone-screen">
                  <div className="lp-phone-book" aria-hidden="true">
                    <span className="lp-phone-book-emoji">🎻</span>
                    <div className="lp-phone-book-text">
                      <strong>Friday Session</strong>
                      <small>Set 1 · 3 jigs named</small>
                    </div>
                    <span className="lp-phone-book-tag">Tunebook</span>
                  </div>

                  <div className="lp-phone-finder">
                    <div ref={heroSlot} className="lp-slot is-hero">{spot === "hero" && dial("hero")}</div>
                    <div className="lp-hero-stage" aria-live="polite">
                      {answer && spot === "hero" ? (
                        <FinderAnswer tune={answer} sure={sure} context={context} />
                      ) : (
                        <p className="lp-prompt" role={phase === "error" ? "alert" : undefined}>{prompt}{dots}</p>
                      )}
                    </div>
                  </div>

                  <div className="lp-phone-tabs" aria-hidden="true">
                    <span className="lp-phone-tab is-active"><Music size={14} /> Tunes</span>
                    <span className="lp-phone-tab"><Disc3 size={14} /> Sessions</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="lp-whispers is-right" aria-hidden="true">
              <div
                className="lp-whisper"
                data-step="learn"
                data-active={activeStep === "learn" ? "" : undefined}
                onMouseEnter={() => setActiveStep("learn")}
              >
                <span className="lp-whisper-icon">🎸</span>
                <div>
                  <strong>Play along with guitar · 85%</strong>
                  <span className="lp-whisper-sub">Fiddle, flute &amp; whistle backing tracks</span>
                </div>
              </div>

              <div
                className="lp-whisper"
                data-step="track"
                data-active={activeStep === "track" ? "" : undefined}
                onMouseEnter={() => setActiveStep("track")}
              >
                <div className="lp-whisper-row">
                  <strong>3 of 4 tunes you can play</strong>
                  <AbilityMark practice={resolvePractice(null, "mastered")} label />
                </div>
                <span className="lp-whisper-sub">75% of tonight&apos;s session in your fingers</span>
              </div>
            </div>
          </motion.div>

          {/* Flighty-style pill bar anchoring the 3-part story under the phone. */}
          <nav className="lp-steps" aria-label="How Tune Companion works">
            {STEPS.map((step) => {
              const Icon = step.icon;
              const active = activeStep === step.id;
              return (
                <a
                  key={step.id}
                  href={`#${step.id}`}
                  className="lp-step-pill"
                  data-active={active ? "" : undefined}
                  onMouseEnter={() => setActiveStep(step.id)}
                  onFocus={() => setActiveStep(step.id)}
                  onClick={() => setActiveStep(step.id)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span className="lp-step-full">{step.label}</span>
                  <span className="lp-step-short">{step.short}</span>
                </a>
              );
            })}
          </nav>
        </section>

        {/* The 3-part loop: 1. Listen/upload -> session tunebook, 2. Full training interface, 3. Repertoire tracking. */}
        <Feature
          id="listen"
          eyebrow="01 · Listen to the session"
          title="Record or upload a session. Get the tunebook."
          body="Leave your phone on the table at the pub, or upload a recording of a session or tune from earlier. Every tune is named by ear as it’s played, grouped into sets, and turned into a neat tunebook for the night."
        >
          <RecordDemo />
        </Feature>

        <Feature
          id="learn"
          eyebrow="02 · Learn the tunes"
          title="Practise with accurate backing and play-along tracks."
          body="Open any tune from your sessions or tunebooks in a full training interface. Follow the score as notes light up, switch between fiddle, flute, or whistle with guitar, and slow the tempo down until your fingers catch up."
        >
          <BookDemo tracks={tracks} />
        </Feature>

        <Feature
          id="track"
          eyebrow="03 · Play the tunes"
          title="Track everything you can play."
          body="Revisit your sessions and tunelists to see how much of the night you could join in on. Move tunes from learning to mastered as they settle in, and carry your whole repertoire in your pocket."
        >
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

function Feature({ id, eyebrow, title, body, children }: { id: string; eyebrow: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <section id={id} className="lp-feature">
      <motion.div className="lp-copy" {...rise}>
        <p className="eyebrow lp-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{body}</p>
      </motion.div>
      <motion.div className="lp-visual" {...rise} transition={{ ...rise.transition, delay: 0.1 }}>
        {children}
      </motion.div>
    </section>
  );
}
